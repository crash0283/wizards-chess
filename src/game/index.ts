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
 *              animation code, driven by real input instead of a schedule.
 *
 * The chess itself lives entirely in src/chess — legal move generation, search and mate
 * detection are that module's problem. Nothing here decides what is legal.
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
  type Move,
} from '../chess';
import { buildTimeline, lastCaptureIndex, STRIKE_CONTACT, type TimedEvent, type Timeline } from './timeline';

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
  function destroyOn(file: number, rank: number, fromFile: number, fromRank: number, force = 1) {
    const victim = pieceAt(file, rank);
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

  // --- interactive play ---------------------------------------------------------------------

  let selected: { file: number; rank: number } | null = null;
  let engineThinkAt = -1;

  function boardHit(ev: PointerEvent): { file: number; rank: number } | null {
    const el = world.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, world.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const file = Math.round(hit.x / 2.35 + 3.5);
    const rank = Math.round(hit.z / 2.35 + 3.5);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return { file, rank };
  }

  function playerMove(from: { file: number; rank: number }, to: { file: number; rank: number }) {
    const legal = engine.moves();
    const match = legal.find(
      (m: Move) => (m.from & 15) === from.file && (m.from >> 4) === from.rank &&
                   (m.to & 15) === to.file && (m.to >> 4) === to.rank,
    );
    if (!match) return false;

    const attacker = pieceAt(from.file, from.rank);
    const victimSquare = match.capturedOn !== undefined
      ? { file: match.capturedOn & 15, rank: match.capturedOn >> 4 }
      : null;

    if (victimSquare) {
      const victim = pieceAt(victimSquare.file, victimSquare.rank);
      if (attacker && victim) {
        attacker.strike(victim);
        const contactAt = world.time + STRIKE_CONTACT;
        pending.push({
          t: contactAt,
          run: () => destroyOn(victimSquare.file, victimSquare.rank, from.file, from.rank),
        });
        pending.push({
          t: contactAt + 0.75,
          run: () => {
            attacker.walkTo(to.file, to.rank, 0.5);
            relocate(from, to);
          },
        });
      }
    } else if (attacker) {
      attacker.walkTo(to.file, to.rank, 0.9);
      pending.push({ t: world.time + 0.9, run: () => relocate(from, to) });
    }

    engine.move(match);
    syncState();
    engineThinkAt = world.time + 1.9;
    return true;
  }

  /** Deferred work for interactive play only — never used during a deterministic capture. */
  const pending: Array<{ t: number; run: () => void }> = [];

  function syncState() {
    state.fen = engine.fen;
    state.turn = engine.side;
    state.inCheck = engine.inCheck();
    state.moveNumber = engine.moveNumber;
    if (engine.isCheckmate()) {
      state.result = engine.side === 'white' ? 'checkmate-white' : 'checkmate-black';
      const pos = parseFen(engine.fen);
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const ch = pos.board[sq];
        if (!ch) continue;
        if (ch.toLowerCase() !== 'k') continue;
        const isWhite = ch === 'K';
        if ((isWhite ? 'white' : 'black') !== engine.side) continue;
        pieceAt(sq & 15, sq >> 4)?.surrender?.();
      }
    } else if (engine.isDraw()) {
      state.result = engine.isStalemate() ? 'stalemate' : 'draw';
    }
  }

  function attachInput() {
    if (world.capturing) return;
    world.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (state.result !== 'playing' || state.thinking) return;
      const sq = boardHit(ev as PointerEvent);
      if (!sq) return;
      if (selected) {
        if (!playerMove(selected, sq)) {
          // Not a legal destination — treat it as re-selecting instead.
          const p = pieceAt(sq.file, sq.rank);
          selected = p && p.side === engine.side ? sq : null;
          return;
        }
        selected = null;
      } else {
        const p = pieceAt(sq.file, sq.rank);
        if (p && p.side === engine.side) selected = sq;
      }
    });
  }

  return {
    start() {
      populate(START_FEN);
      attachInput();
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

      // Interactive: deferred callbacks, then the engine's reply.
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].t <= t) {
          pending[i].run();
          pending.splice(i, 1);
        }
      }
      if (engineThinkAt >= 0 && t >= engineThinkAt && state.result === 'playing') {
        engineThinkAt = -1;
        state.thinking = true;
        const best = engine.moves().length ? engine.search?.() ?? null : null;
        state.thinking = false;
        if (best) {
          playerMove(
            { file: best.from & 15, rank: best.from >> 4 },
            { file: best.to & 15, rank: best.to >> 4 },
          );
        }
      }
    },

    state: () => state,

    setPosition(fen) {
      engine.reset(fen);
      populate(fen);
      timeline = null;
      syncState();
    },
  };
}
