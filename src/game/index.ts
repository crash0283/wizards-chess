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
import { createInteractive, PLAYER, type BoardModel, type Interactive } from './interactive';
import { PAWN_VALUE } from './glyphs';
import { createReadout, type Readout, type ReadoutSnapshot, type Tally } from './readout';

/** FEN letter -> our piece type. */
const TYPE_OF: Record<string, PieceType> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

const key = (file: number, rank: number) => `${file},${rank}`;

const emptyTally = (): Tally =>
  ({ pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 });

/** How many of each a side starts with — the baseline a mid-game FEN is read against. */
const INITIAL: Tally = { pawn: 8, knight: 2, bishop: 2, rook: 2, queen: 1, king: 1 };

const OTHER_SIDE: Record<Side, Side> = { white: 'black', black: 'white' };

/**
 * Material in whole pawns, White's point of view — the +3 a chess player expects to read.
 *
 * Deliberately NOT `Engine.materialBalance()`, which is centipawns on the search's own
 * scale (a knight is 320, a bishop 330) and would put "+3.2" beside a won knight. The
 * engine's number is still the better judge of who is actually ahead when the piece count
 * is level, so the readout carries both: this one on the badge, that one for the tie.
 *
 * Read off the placement field so promotions are simply counted as what they now are.
 */
function conventionalEdge(fen: string): number {
  const placement = fen.slice(0, fen.indexOf(' ') < 0 ? fen.length : fen.indexOf(' '));
  let v = 0;
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i];
    const type = TYPE_OF[ch.toLowerCase()];
    if (!type) continue;
    const worth = PAWN_VALUE[type];
    v += ch === ch.toUpperCase() ? worth : -worth;
  }
  return v;
}

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

  // --- the readout's books ----------------------------------------------------------------
  //
  // None of this is touched under capture. Every write goes through `note()` or is guarded
  // by the same flag, so the film path allocates nothing extra and branches once.

  /** What each side HAS TAKEN. `taken.white` is a tally of black men. */
  const taken: Record<Side, Tally> = { white: emptyTally(), black: emptyTally() };
  /** The scripted path's own score sheet: it drives `state`, not the engine, so
   *  `Engine.history()` is empty during a replay and cannot be the record. */
  const scriptedLog: string[] = [];
  /** Absolute ply index of the first move in `Engine.history()`. Non-zero only when the
   *  game was set up from a mid-game FEN, where the score sheet must not restart at 1. */
  let historyBase = 0;
  /** Bumped by anything the readout would want to redraw for. Cheaper than diffing. */
  let revision = 0;

  function note(type: PieceType, victimSide: Side) {
    if (world.capturing) return;
    taken[OTHER_SIDE[victimSide]][type]++;
    revision++;
  }

  function resetBooks() {
    if (world.capturing) return;
    taken.white = emptyTally();
    taken.black = emptyTally();
    scriptedLog.length = 0;
    revision++;
  }

  /** Where the score sheet's numbering starts, read off the position just loaded. */
  function markHistoryBase() {
    historyBase = (engine.moveNumber - 1) * 2 + (engine.side === 'black' ? 1 : 0);
  }

  /**
   * Seed the trays from a position nobody watched arrive — `?fen=`, or a staged shot.
   *
   * This is the inference the move-by-move path exists to avoid, and it is kept honest
   * about its limits: it subtracts surplus officers from the missing pawns, so a side with
   * two queens is read as having promoted rather than as having been given one, which is
   * right in every ordinary game. It can still be fooled (promote to a knight after both
   * knights have already been taken and it will show a pawn that is still alive), and that
   * is precisely why live play does not use it.
   */
  function seedBooks(fen: string) {
    if (world.capturing) return;
    resetBooks();
    const live: Record<Side, Tally> = { white: emptyTally(), black: emptyTally() };
    const placement = fen.split(' ')[0];
    for (let i = 0; i < placement.length; i++) {
      const ch = placement[i];
      const type = TYPE_OF[ch.toLowerCase()];
      if (!type) continue;
      live[ch === ch.toUpperCase() ? 'white' : 'black'][type]++;
    }
    for (const side of ['white', 'black'] as Side[]) {
      let promoted = 0;
      for (const type of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
        promoted += Math.max(0, live[side][type] - INITIAL[type]);
      }
      const tray = taken[OTHER_SIDE[side]];
      for (const type of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
        tray[type] = Math.max(0, INITIAL[type] - live[side][type]);
      }
      tray.pawn = Math.max(0, INITIAL.pawn - live[side].pawn - promoted);
    }
    revision++;
  }

  // --- scripted replay ------------------------------------------------------------------
  let demo: DemoGame | null = null;
  let timeline: Timeline | null = null;
  let fired = 0;
  /** Plies whose victim has already been destroyed, so a replay never double-shatters. */
  const resolved = new Set<number>();

  // --- board population -----------------------------------------------------------------

  /**
   * Take the current position off the board.
   *
   * This used to hide each man and clear the square map, which left every instance in the
   * piece factory's live list for the rest of the session. The interactive path stages a
   * position and then starts a game, so after two calls there were 64 men standing on a
   * 32-man board — 32 of them invisible, all 32 still being updated every frame, and all 32
   * still solid to a raycast. `retire` is the counterpart `make` never had.
   */
  function clearBoard() {
    for (const p of bySquare.values()) {
      p.group.visible = false;
      deps.pieces.retire(p);
    }
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
   * Interactive-only dials on the consequences of a blade landing.
   *
   * Both of these are durations expressed in SCENE seconds, and scene time is clamped —
   * on a renderer taking a second a frame it runs ~20x behind the wall clock. A flare
   * specified to decay over 0.55 s therefore sat on the room for the best part of a
   * minute, and by the tenth capture the middle of the board was a white bloom you could
   * not read pieces through. `interactive.ts` measures how far behind scene time actually
   * is and scales these so the flash lasts about the second and a half it was meant to.
   *
   * They are 1 here and NOTHING but interactive.ts ever writes them, so under capture the
   * arguments handed to lighting.flare() and camera.shake() are bit-for-bit what they were
   * before this existed.
   */
  const tuning = { flareDecay: 1, shake: 1 };

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
    deps.lighting.flare(
      new THREE.Vector3(x, victim.height * 0.45, z), 1.15 * force, 0.55 * tuning.flareDecay);
    deps.camera.shake(0.85 * force * tuning.shake);
    deps.board.markImpact(x, z, 2.4, 1.0);

    /**
     * Clear the square ONLY if the victim is still what is standing on it.
     *
     * The scripted path destroys and then relocates, so the victim always is, and this is
     * the plain delete it has always been. Interactive play is the other way round: the
     * board model is settled the instant the click lands and the blade falls half a second
     * of animation later, by which time the ATTACKER is standing here. An unconditional
     * delete therefore erased the piece that had just won the square — it stayed on screen
     * and stayed on the engine's board, but the map no longer knew it was there, so
     * clicking it did nothing and it could never move again. That is a whole capturing
     * piece lost per capture, and it is why a game that had gone through a recapture on c3
     * could not then play c3-c4.
     */
    if (bySquare.get(key(file, rank)) === victim) bySquare.delete(key(file, rank));
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
      note(m.capture.piece, m.capture.side);
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
          note(m.capture.piece, m.capture.side);
          destroyOn(m.capture.file, m.capture.rank, m.fromFile, m.fromRank);
        }
        break;
      }
      case 'arrive': {
        const p = pieceAt(m.fromFile, m.fromRank);
        if (p) p.walkTo(m.toFile, m.toRank, 0.45);
        settleMove(m);
        if (!world.capturing) { scriptedLog.push(m.san); revision++; }
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
        note(m.capture.piece, m.capture.side);
        destroyOn(m.capture.file, m.capture.rank, m.fromFile, m.fromRank, 0.85);
      }
      if (!world.capturing) scriptedLog.push(m.san);
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

  function stageShot(shotId: string) {
    demo = buildDemoGame('wreckage');
    resolved.clear();
    fired = 0;
    resetBooks();

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
    revision++;
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

  // --- the readout -------------------------------------------------------------------------
  //
  // A DOM overlay, built only when we are not capturing. See readout.ts for why it is DOM
  // and not carved into the scene like the affordance markers are.

  let readout: Readout | null = null;
  /** Last state the readout was drawn for. It redraws on change and not otherwise. */
  let drawnKey = '';

  function drawReasonNow(): ReadoutSnapshot['drawReason'] {
    if (state.result === 'stalemate') return 'stalemate';
    if (state.result !== 'draw') return null;
    if (engine.isThreefold()) return 'threefold';
    if (engine.isFiftyMove()) return 'fifty-move';
    if (engine.isInsufficientMaterial()) return 'insufficient-material';
    return null;
  }

  function snapshot(): ReadoutSnapshot {
    const scripted = timeline !== null;
    const over = state.result !== 'playing';
    const winner: Side | null =
      state.result === 'checkmate-white' ? 'black'
      : state.result === 'checkmate-black' ? 'white'
      : null;
    return {
      turn: state.turn,
      thinking: state.thinking,
      inCheck: state.inCheck,
      result: state.result,
      winner,
      // Only ask the engine why it is a draw when it says it is one — every one of those
      // predicates walks the board or the repetition history.
      drawReason: over ? drawReasonNow() : null,
      moveNumber: state.moveNumber,
      edge: conventionalEdge(state.fen),
      cp: engine.materialBalance(),
      taken,
      history: scripted ? scriptedLog : engine.history(),
      firstPly: scripted ? 0 : historyBase,
      player: interactive ? PLAYER : null,
    };
  }

  function drawReadout() {
    if (!readout) return;
    const k = `${revision}|${state.thinking ? 1 : 0}`;
    if (k === drawnKey) return;
    drawnKey = k;
    readout.render(snapshot());
  }

  const model: BoardModel = {
    engine,
    state,
    tuning,
    pieceAt,
    occupied() {
      const out: Array<{ file: number; rank: number; piece: PieceInstance }> = [];
      for (const [k, piece] of bySquare) {
        const comma = k.indexOf(',');
        out.push({ file: +k.slice(0, comma), rank: +k.slice(comma + 1), piece });
      }
      return out;
    },
    relocate,
    forget: (file, rank) => { bySquare.delete(key(file, rank)); },
    destroyPiece,
    promoteOn,
    noteCapture(letter) {
      const type = TYPE_OF[letter.toLowerCase()];
      if (!type) return;
      note(type, letter === letter.toUpperCase() ? 'white' : 'black');
    },
    syncState,
    kingSquareOf,
  };

  return {
    start() {
      populate(START_FEN);
      resetBooks();
      markHistoryBase();
      if (!world.capturing) {
        interactive = createInteractive(world, deps, model);
        // The markers can fail to build and play carries on without them (see
        // interactive.ts); the readout gets the same treatment for the same reason. A
        // scoreboard is worth a lot and is worth nothing next to the game running.
        try {
          readout = createReadout();
        } catch (err) {
          console.warn('readout unavailable, playing without it:', err);
          readout = null;
        }
        // Draw it now rather than on the first frame. This scene can take seconds to put
        // its first frame up, and an empty scoreboard is the first thing a player would
        // otherwise see for all of it.
        drawReadout();
      }
    },

    stage(shotId) {
      stageShot(shotId);
      markHistoryBase();
      revision++;
      drawReadout();
    },

    update(t) {
      // Scripted: fire every event whose time has passed, in order. Pure function of t.
      if (timeline) {
        while (fired < timeline.events.length && timeline.events[fired].t <= t) {
          fire(timeline.events[fired]);
          fired++;
        }
        // Under capture `readout` is null and this is a single null check. A live page
        // behind `?shot=` is a scripted replay somebody is watching, and it gets the
        // score sheet too.
        drawReadout();
        return;
      }
      // Interactive. `world.realTime` is the clock a person is actually waiting on;
      // `t` is the clamped scene clock everything visual runs on.
      interactive?.update(t, world.realTime);
      // After the controller, not before: a click applied this frame should be on the
      // board and in the readout in the same frame, not one behind it.
      drawReadout();
    },

    state: () => state,

    setPosition(fen) {
      engine.reset(fen);
      populate(fen);
      timeline = null;
      // Nobody watched this position arrive, so the trays have to be inferred from what
      // is missing off the board — see seedBooks() for what that can and cannot know.
      seedBooks(fen);
      markHistoryBase();
      syncState();
      interactive?.refresh();
    },
  };
}
