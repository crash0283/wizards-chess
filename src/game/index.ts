/**
 * PIECE: game — the fight itself.
 *
 * Owns the turn loop, the pieces on the board, and everything that happens when one piece
 * takes another: the attacker commits, the blade lands, the victim is destroyed, the room
 * flashes, the camera reacts and the wreckage stays on the marble for the rest of the game.
 *
 * Two ways to run:
 *
 *   scripted   a verified DemoGame from src/chess is compiled to a timeline (timeline.ts)
 *              and replayed as a pure function of world.time. This is what the capture
 *              harness renders, which is why it must not depend on promise ordering or
 *              frame counts — see the note at the top of timeline.ts.
 *   interactive  the player clicks a piece and a destination; the engine answers. Same
 *              animation code, driven by real input instead of a schedule. All of it
 *              lives in interactive.ts and NONE of it is constructed under capture, so
 *              the scripted path cannot be perturbed by it.
 *
 * This file owns the model both paths share: which carved piece stands on which square,
 * and what happens to it when a blade lands. The chess itself lives entirely in
 * src/chess — legal move generation, search and mate detection are that module's
 * problem. Nothing here decides what is legal.
 */
import * as THREE from 'three';
import type { Game, GameDeps, GameState, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import { squareCentre, type PieceType, type Side } from '../core/constants';
import {
  Engine,
  START_FEN,
  buildDemoGame,
  parseFen,
  type DemoGame,
  type DemoMove,
} from '../chess';
import { buildTimeline, lastCaptureIndex, type TimedEvent, type Timeline } from './timeline';
import { createInteractive, type BoardModel, type Interactive } from './interactive';

/** FEN letter -> our piece type. */
const TYPE_OF: Record<string, PieceType> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

const key = (file: number, rank: number) => `${file},${rank}`;

export function createGame(world: World, deps: GameDeps): Game {
  const engine = new Engine(START_FEN);
  const bySquare = new Map<string, PieceInstance>();
  let serial = 0;

  const state: GameState = {
    fen: START_FEN,
    turn: 'white',
    inCheck: false,
    result: 'playing',
    lastMove: null,
    moveNumber: 1,
    thinking: false,
  };

  // --- scripted replay ------------------------------------------------------------------
  let demo: DemoGame | null = null;
  let timeline: Timeline | null = null;
  let fired = 0;
  /** Plies whose victim has already been destroyed, so a replay never double-shatters. */
  const resolved = new Set<number>();

  // --- board population -----------------------------------------------------------------

  function clearBoard() {
    for (const p of bySquare.values()) p.group.visible = false;
    bySquare.clear();
  }

  /** Build piece instances for every occupied square of a FEN. */
  function populate(fen: string) {
    clearBoard();
    const pos = parseFen(fen);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const ch = pos.board[(rank << 4) | file];
        if (!ch) continue;
        const side: Side = ch === ch.toUpperCase() ? 'white' : 'black';
        const type = TYPE_OF[ch.toLowerCase()];
        if (!type) continue;
        // Key by square AND a serial, so a piece keeps its own carved identity even if a
        // later staging call rebuilds the board.
        const inst = deps.pieces.make(type, side, `${side}-${type}-${file}${rank}-${serial++}`);
        inst.setSquare(file, rank);
        bySquare.set(key(file, rank), inst);
      }
    }
  }

  function pieceAt(file: number, rank: number): PieceInstance | undefined {
    return bySquare.get(key(file, rank));
  }

  function relocate(from: { file: number; rank: number }, to: { file: number; rank: number }) {
    const p = bySquare.get(key(from.file, from.rank));
    if (!p) return;
    bySquare.delete(key(from.file, from.rank));
    bySquare.set(key(to.file, to.rank), p);
  }

  // --- the violence ----------------------------------------------------------------------

  /**
   * Destroy the piece standing on a square: shatter it, flash the room, shake the camera
   * and scar the marble. Everything downstream of a blade landing goes through here so
   * scripted and interactive play produce identical consequences.
   */
  function destroyPiece(
    victim: PieceInstance | undefined,
    file: number, rank: number,
    fromFile: number, fromRank: number,
    force = 1,
  ) {
    if (!victim || victim.destroyed) return;

    const { x, z } = squareCentre(file, rank);
    const from = squareCentre(fromFile, fromRank);
    const impact = new THREE.Vector3(x - from.x, 0, z - from.z);
    if (impact.lengthSq() < 1e-6) impact.set(0, 0, 1);
    impact.normalize();

    deps.destruction.shatter(victim, impact, force);
    deps.lighting.flare(new THREE.Vector3(x, victim.height * 0.45, z), 1.15 * force, 0.55);
    deps.camera.shake(0.85 * force);
    deps.board.markImpact(x, z, 2.4, 1.0);

    bySquare.delete(key(file, rank));
  }

  /** The scripted path's form: the victim is whoever is standing there right now. */
  function destroyOn(file: number, rank: number, fromFile: number, fromRank: number, force = 1) {
    destroyPiece(pieceAt(file, rank), file, rank, fromFile, fromRank, force);
  }

  /** Replace whatever stands on a square with a freshly carved piece of `type`. */
  function promoteOn(file: number, rank: number, type: PieceType, side: Side) {
    const standing = pieceAt(file, rank);
    if (standing) standing.group.visible = false;
    bySquare.delete(key(file, rank));
    const inst = deps.pieces.make(type, side, `${side}-${type}-promo-${serial++}`);
    inst.setSquare(file, rank);
    bySquare.set(key(file, rank), inst);
  }

  /** Apply one scripted ply's board bookkeeping — capture, castle, promotion, relocation. */
  function settleMove(m: DemoMove) {
    if (m.capture && !resolved.has(m.ply)) {
      resolved.add(m.ply);
      destroyOn(m.capture.file, m.capture.rank, m.fromFile, m.fromRank);
    }
    relocate({ file: m.fromFile, rank: m.fromRank }, { file: m.toFile, rank: m.toRank });
    if (m.castle) {
      const rook = pieceAt(m.castle.rookFromFile, m.castle.rookFromRank);
      if (rook) {
        rook.walkTo(m.castle.rookToFile, m.castle.rookToRank, 0.9);
        relocate(
          { file: m.castle.rookFromFile, rank: m.castle.rookFromRank },
          { file: m.castle.rookToFile, rank: m.castle.rookToRank },
        );
      }
    }
    if (m.promotion) {
      // The pawn is consumed and the promoted piece takes its square.
      const pawn = pieceAt(m.toFile, m.toRank);
      if (pawn) pawn.group.visible = false;
      bySquare.delete(key(m.toFile, m.toRank));
      const inst = deps.pieces.make(m.promotion, m.side, `${m.side}-${m.promotion}-promo-${serial++}`);
      inst.setSquare(m.toFile, m.toRank);
      bySquare.set(key(m.toFile, m.toRank), inst);
    }
  }

  function fire(ev: TimedEvent) {
    const m = ev.move;
    if (!m) return;
    switch (ev.kind) {
      case 'walk-start': {
        const p = pieceAt(m.fromFile, m.fromRank);
        p?.walkTo(m.toFile, m.toRank, Math.max(0.85, 0.42 * Math.max(
          Math.abs(m.toFile - m.fromFile), Math.abs(m.toRank - m.fromRank))));
        break;
      }
      case 'strike-start': {
        const attacker = pieceAt(m.fromFile, m.fromRank);
        const victim = m.capture ? pieceAt(m.capture.file, m.capture.rank) : undefined;
        if (attacker && victim) attacker.strike(victim);
        break;
      }
      case 'contact': {
        if (m.capture && !resolved.has(m.ply)) {
          resolved.add(m.ply);
          destroyOn(m.capture.file, m.capture.rank, m.fromFile, m.fromRank);
        }
        break;
      }
      case 'arrive': {
        const p = pieceAt(m.fromFile, m.fromRank);
        if (p) p.walkTo(m.toFile, m.toRank, 0.45);
        settleMove(m);
        state.lastMove = m.san;
        state.moveNumber = m.moveNumber;
        state.fen = m.fenAfter;
        state.turn = m.side === 'white' ? 'black' : 'white';
        state.inCheck = m.check;
        break;
      }
      case 'game-over': {
        state.result = demo
          ? (demo.matedSide === 'white' ? 'checkmate-white' : 'checkmate-black')
          : 'playing';
        break;
      }
      case 'surrender': {
        if (!demo) break;
        const k = pieceAt(demo.king.file, demo.king.rank);
        k?.surrender?.();
        break;
      }
    }
  }

  // --- staging ----------------------------------------------------------------------------

  /**
   * Replay the scripted game instantly, with no animation, up to (but not including) the
   * given ply. Used to reach a late position with all the earlier wreckage already on the
   * board — `king-surrender` needs a board strewn with the debris of the whole game.
   */
  function fastForward(g: DemoGame, upToPly: number) {
    for (const m of g.moves) {
      if (m.ply >= upToPly) break;
      if (m.capture) {
        resolved.add(m.ply);
        destroyOn(m.capture.file, m.capture.rank, m.fromFile, m.fromRank, 0.85);
      }
      const p = pieceAt(m.fromFile, m.fromRank);
      relocate({ file: m.fromFile, rank: m.fromRank }, { file: m.toFile, rank: m.toRank });
      p?.setSquare(m.toFile, m.toRank);
      if (m.castle) {
        const rook = pieceAt(m.castle.rookFromFile, m.castle.rookFromRank);
        relocate(
          { file: m.castle.rookFromFile, rank: m.castle.rookFromRank },
          { file: m.castle.rookToFile, rank: m.castle.rookToRank },
        );
        rook?.setSquare(m.castle.rookToFile, m.castle.rookToRank);
      }
      if (m.promotion) {
        const pawn = pieceAt(m.toFile, m.toRank);
        if (pawn) pawn.group.visible = false;
        bySquare.delete(key(m.toFile, m.toRank));
        const inst = deps.pieces.make(m.promotion, m.side, `${m.side}-${m.promotion}-ff-${serial++}`);
        inst.setSquare(m.toFile, m.toRank);
        bySquare.set(key(m.toFile, m.toRank), inst);
      }
      state.fen = m.fenAfter;
      state.lastMove = m.san;
      state.moveNumber = m.moveNumber;
    }
  }

  function stage(shotId: string) {
    demo = buildDemoGame('wreckage');
    resolved.clear();
    fired = 0;

    switch (shotId) {
      case 'piece-mid-strike':
      case 'aftermath-rubble': {
        // Put a real capture's contact exactly on the shot's capture time. The mid-strike
        // shot is taken at t=0.62, which is STRIKE_CONTACT, so the attack must begin at 0.
        const idx = lastCaptureIndex(demo);
        const at = idx >= 0 ? demo.moves[idx] : null;
        populate(demo.startFen);
        if (at) {
          fastForward(demo, at.ply);
          timeline = buildTimeline({ ...demo, moves: demo.moves.slice(idx) }, 0);
        } else {
          timeline = buildTimeline(demo, 0);
        }
        break;
      }

      case 'king-surrender': {
        // The whole game has already been fought. Show its wreckage and the final mate.
        populate(demo.startFen);
        fastForward(demo, Number.MAX_SAFE_INTEGER);
        engine.reset(demo.finalFen);
        state.fen = demo.finalFen;
        state.result = demo.matedSide === 'white' ? 'checkmate-white' : 'checkmate-black';
        state.inCheck = true;
        // Only the surrender still has to play, and the shot is captured at t=2.8.
        timeline = {
          events: [
            { t: 0.9, kind: 'surrender', ply: 0, move: demo.moves[demo.moves.length - 1] ?? null },
          ],
          duration: 3.0,
          firstContact: null,
        };
        break;
      }

      default: {
        // The still shots: both armies ranked, nothing has happened yet.
        populate(START_FEN);
        engine.reset(START_FEN);
        timeline = null;
        break;
      }
    }
  }

  // --- shared state bookkeeping -------------------------------------------------------------

  function syncState() {
    state.fen = engine.fen;
    state.turn = engine.side;
    state.inCheck = engine.inCheck();
    state.moveNumber = engine.moveNumber;
    if (engine.isCheckmate()) {
      state.result = engine.side === 'white' ? 'checkmate-white' : 'checkmate-black';
      const k = kingSquareOf(engine.side);
      if (k) pieceAt(k.file, k.rank)?.surrender?.();
    } else if (engine.isDraw()) {
      state.result = engine.isStalemate() ? 'stalemate' : 'draw';
    } else {
      state.result = 'playing';
    }
  }

  /** Where a king is standing, from the engine's own board rather than our map. */
  function kingSquareOf(side: Side): { file: number; rank: number } | null {
    const sq = engine.kingSquare(side);
    if (sq === undefined || sq < 0 || (sq & 0x88) !== 0) return null;
    return { file: sq & 15, rank: sq >> 4 };
  }

  // --- interactive play ---------------------------------------------------------------------
  //
  // Everything a human touches lives in interactive.ts, and it is only ever built when we
  // are NOT capturing. The scripted path below never consults it.

  let interactive: Interactive | null = null;

  const model: BoardModel = {
    engine,
    state,
    pieceAt,
    relocate,
    forget: (file, rank) => { bySquare.delete(key(file, rank)); },
    destroyPiece,
    promoteOn,
    syncState,
    kingSquareOf,
  };

  return {
    start() {
      populate(START_FEN);
      if (!world.capturing) interactive = createInteractive(world, deps, model);
    },

    stage,

    update(t) {
      // Scripted: fire every event whose time has passed, in order. Pure function of t.
      if (timeline) {
        while (fired < timeline.events.length && timeline.events[fired].t <= t) {
          fire(timeline.events[fired]);
          fired++;
        }
        return;
      }
      // Interactive. `world.realTime` is the clock a person is actually waiting on;
      // `t` is the clamped scene clock everything visual runs on.
      interactive?.update(t, world.realTime);
    },

    state: () => state,

    setPosition(fen) {
      engine.reset(fen);
      populate(fen);
      timeline = null;
      syncState();
      interactive?.refresh();
    },
  };
}
