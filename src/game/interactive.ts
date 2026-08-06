/**
 * Interactive play — the half of this game a person actually touches.
 *
 * The scripted path (timeline.ts) replays a frozen game as a pure function of world.time
 * and is what the capture harness renders. Nothing in this file runs under capture; it is
 * constructed only when `world.capturing` is false, so the deterministic shots cannot be
 * affected by anything here.
 *
 * ── the two things that were broken ──────────────────────────────────────────────────
 *
 * 1. The engine never replied. The reply was scheduled 1.9 seconds into `world.time`, and
 *    world.time accumulates a CLAMPED dt — on a software rasteriser running a fifth of a
 *    frame per second, 1.9 s of scene time is several minutes of a person's life. Every
 *    deadline a human waits on is now measured in `world.realTime`; `world.time` is still
 *    what drives every animation, because animations must stay tied to the clamped clock
 *    or they tear.
 *
 * 2. The frame loop died. `Engine.search()` at 120,000 nodes is a synchronous hole in the
 *    main thread, so each reply stopped rAF outright and the tab was killed mid-render.
 *    The search now happens in a Worker (thinker.ts) and the loop never blocks. Because
 *    the search really does span many frames now, `state.thinking` is a state the HUD can
 *    actually show, rather than something set and cleared inside one call.
 *
 * ── and the third: the loop was too slow to play on ──────────────────────────────────
 *
 * Interactive rendering was costing seconds per frame, mostly in two passes that exist to
 * serve the still frames: a 2048² shadow map re-rendered every frame for a light that
 * never moves, and a full second scene render for the marble's planar reflection. Neither
 * needs to be redone at frame rate while a person is looking at a board that is mostly
 * standing still, so this module throttles both while interactive — the shadow map only
 * when something is actually moving, the reflection on a fixed stride. Under capture both
 * are left completely alone.
 */
import * as THREE from 'three';
import type { GameState, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import { SQUARE, type PieceType, type Side } from '../core/constants';
import type { Engine, Move } from '../chess';
import { STRIKE_CONTACT, STRIKE_RECOVER, WALK_MIN, WALK_PER_SQUARE } from './timeline';
import { createAffordances, type Mark } from './affordances';
import { createThinker, type Thought } from './thinker';

/** The human plays White. The engine answers as Black. */
const PLAYER: Side = 'white';

/** Node budget for a reply. Off-thread, so this is latency the player never feels. */
const REPLY_NODES = 60_000;

/** Real seconds the "thinking" state is held at minimum, so it is observably true. */
const MIN_THINK = 0.5;

/** Real seconds we will wait for the player's own move to finish animating first. */
const REPLY_PATIENCE = 3.0;

/** Seconds of grinding stone for a move of `dist` squares. Same numbers as the script. */
const WALK_OF = (dist: number) => Math.max(WALK_MIN, dist * WALK_PER_SQUARE);

/** Board bookkeeping the interactive controller needs from the game module. */
export interface BoardModel {
  engine: Engine;
  state: GameState;
  pieceAt(file: number, rank: number): PieceInstance | undefined;
  relocate(from: Mark, to: Mark): void;
  /** Forget whatever stands on a square without destroying it. */
  forget(file: number, rank: number): void;
  /** Shatter a known instance: rubble, flare, shake, and a scar on the marble. */
  destroyPiece(
    victim: PieceInstance | undefined,
    file: number, rank: number,
    fromFile: number, fromRank: number,
    force?: number,
  ): void;
  /** Swap whatever stands on a square for a freshly carved piece of `type`. */
  promoteOn(file: number, rank: number, type: PieceType, side: Side): void;
  syncState(): void;
  kingSquareOf(side: Side): Mark | null;
}

export interface Interactive {
  update(t: number, realT: number): void;
  /** The board was replaced under us (setPosition). Drop selection, redraw the marks. */
  refresh(): void;
  dispose(): void;
}

const TYPE_OF_PROMO: Record<string, PieceType> = {
  q: 'queen', r: 'rook', b: 'bishop', n: 'knight',
};

export function createInteractive(world: World, model: BoardModel): Interactive {
  const { engine, state } = model;
  const aff = createAffordances(world);
  world.scene.add(aff.group);
  const think = createThinker();

  /** Deferred VISUALS only, on world.time. Board bookkeeping is always immediate. */
  const pending: Array<{ t: number; run: () => void }> = [];
  const later = (dt: number, run: () => void) => pending.push({ t: world.time + dt, run });

  let selected: Mark | null = null;
  /** A promotion the player has committed to except for the piece. */
  let promoPending: { from: Mark; to: Mark } | null = null;

  /** Real time at which the engine should begin thinking; -1 when it should not. */
  let replyDueAt = -1;
  let thoughtHeld: Thought | null = null;
  let thinkStartedAt = 0;
  /** world.time until which something is visibly moving. Drives the shadow throttle. */
  let activeUntil = 0;

  const markActive = (seconds: number) => {
    activeUntil = Math.max(activeUntil, world.time + seconds);
  };

  // --- picking ---------------------------------------------------------------------

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function setRay(ev: PointerEvent): boolean {
    const el = world.renderer.domElement;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    ndc.set(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(ndc, world.camera);
    return true;
  }

  function boardSquare(): Mark | null {
    if (!ray.ray.intersectPlane(plane, hitPoint)) return null;
    const file = Math.round(hitPoint.x / SQUARE + 3.5);
    const rank = Math.round(hitPoint.z / SQUARE + 3.5);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return { file, rank };
  }

  // --- legality -----------------------------------------------------------------------

  const sqOf = (m: Mark) => (m.rank << 4) | m.file;

  function movesFrom(sq: Mark): Move[] {
    const s = sqOf(sq);
    return engine.moves().filter((m) => m.from === s);
  }

  function showSelection(sq: Mark) {
    selected = sq;
    aff.setSelection(sq);
    const quiet: Mark[] = [];
    const caps: Mark[] = [];
    const seen = new Set<number>();
    for (const m of movesFrom(sq)) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      const mark = { file: m.to & 15, rank: m.to >> 4 };
      (m.captured ? caps : quiet).push(mark);
    }
    aff.setDestinations(quiet, caps);
  }

  function clearSelection() {
    selected = null;
    aff.setSelection(null);
    aff.setDestinations([], []);
  }

  function refuse(sq: Mark | null) {
    if (sq) aff.refuse(sq, world.time);
  }

  // --- applying a move ------------------------------------------------------------------

  /**
   * Play one legal move: board model first and immediately, animation afterwards.
   *
   * Doing the bookkeeping up front is what makes castling, en passant and promotion work
   * through the click path rather than only through the scripted one — the map, the
   * engine and the FEN agree the instant the move is made, and the several seconds of
   * grinding stone that follow are pure decoration on top of a position that is already
   * settled.
   */
  function applyMove(m: Move) {
    const from: Mark = { file: m.from & 15, rank: m.from >> 4 };
    const to: Mark = { file: m.to & 15, rank: m.to >> 4 };
    const attacker = model.pieceAt(from.file, from.rank);
    const mover: Side = engine.side;
    const flags = m.flags ?? '';

    const capSq: Mark | null = m.capturedOn !== undefined
      ? { file: m.capturedOn & 15, rank: m.capturedOn >> 4 }
      : null;
    const victim = capSq ? model.pieceAt(capSq.file, capSq.rank) : undefined;

    // Castling: the rook travels with the king. 0x88 arithmetic, same as the engine's.
    let rookFrom: Mark | null = null;
    let rookTo: Mark | null = null;
    if (m.flags.includes('k') || m.flags.includes('q')) {
      const rf = m.to > m.from ? m.from + 3 : m.from - 4;
      const rt = m.to > m.from ? m.from + 1 : m.from - 1;
      rookFrom = { file: rf & 15, rank: rf >> 4 };
      rookTo = { file: rt & 15, rank: rt >> 4 };
    }
    const rook = rookFrom ? model.pieceAt(rookFrom.file, rookFrom.rank) : undefined;

    // --- bookkeeping, now ---
    if (capSq) model.forget(capSq.file, capSq.rank);
    model.relocate(from, to);
    if (rookFrom && rookTo) model.relocate(rookFrom, rookTo);
    engine.move(m);
    state.lastMove = m.san ?? state.lastMove;
    model.syncState();

    // --- animation, over the next couple of seconds ---
    const dist = Math.max(Math.abs(to.file - from.file), Math.abs(to.rank - from.rank));
    const walk = WALK_OF(dist);
    let arriveAt: number;

    if (victim && attacker) {
      attacker.strike(victim);
      later(STRIKE_CONTACT, () =>
        model.destroyPiece(victim, capSq!.file, capSq!.rank, from.file, from.rank));
      later(STRIKE_CONTACT + STRIKE_RECOVER, () => attacker.walkTo(to.file, to.rank, 0.5));
      arriveAt = STRIKE_CONTACT + STRIKE_RECOVER + 0.5;
    } else {
      if (victim) {
        // No attacker instance to swing (should not happen) — still remove the victim.
        later(0, () => model.destroyPiece(victim, capSq!.file, capSq!.rank, from.file, from.rank));
      }
      attacker?.walkTo(to.file, to.rank, walk);
      arriveAt = walk;
    }
    if (rook && rookTo) rook.walkTo(rookTo.file, rookTo.rank, 0.9);

    if (m.promo) {
      const type = TYPE_OF_PROMO[m.promo] ?? 'queen';
      const side: Side = m.piece === m.piece.toUpperCase() ? 'white' : 'black';
      later(arriveAt, () => model.promoteOn(to.file, to.rank, type, side));
    }

    markActive(arriveAt + 1.2);
    refreshMarks();
  }

  /** Check ring, game-over sigil, and the destination markers the move invalidated. */
  function refreshMarks() {
    clearSelection();
    const over = state.result !== 'playing';
    aff.setCheck(!over && state.inCheck ? model.kingSquareOf(engine.side) : null);
    if (over) {
      const mated = state.result === 'checkmate-white' ? 'white'
        : state.result === 'checkmate-black' ? 'black' : null;
      const king = model.kingSquareOf(mated ?? engine.side);
      aff.setGameOver(mated ? 'mate' : 'draw', king, world.time);
    } else {
      aff.setGameOver(null, null, world.time);
    }
  }

  // --- input ----------------------------------------------------------------------------

  function onPointerDown(ev: PointerEvent) {
    if (!setRay(ev)) return;

    // The promotion tablets are in front of everything else while they are up.
    if (promoPending) {
      const hits = ray.intersectObjects(aff.pickables(), false);
      const promo = hits.length ? (hits[0].object.userData.promo as string | undefined) : undefined;
      resolvePromotion(promo ?? 'q');
      return;
    }

    const sq = boardSquare();

    if (state.result !== 'playing') { refuse(sq); return; }
    if (state.thinking || engine.side !== PLAYER) { refuse(sq); return; }
    if (!sq) { clearSelection(); return; }

    const here = model.pieceAt(sq.file, sq.rank);

    if (selected) {
      const candidates = movesFrom(selected).filter((m) => m.to === sqOf(sq));
      if (candidates.length === 0) {
        // Not a legal destination. Re-selecting one of your own men is what was almost
        // always meant; anything else is refused visibly instead of silently.
        if (here && here.side === PLAYER && !(sq.file === selected.file && sq.rank === selected.rank)) {
          showSelection(sq);
        } else {
          refuse(sq);
          clearSelection();
        }
        return;
      }
      if (candidates.length > 1 && candidates.every((m) => m.promo)) {
        // A pawn reaching the last rank. Raise the four tablets and let them choose.
        aff.showPromotion(sq, PLAYER);
        promoPending = { from: selected, to: sq };
        clearSelection();
        aff.setSelection(promoPending.from);
        return;
      }
      applyMove(candidates[0]);
      scheduleReply();
      return;
    }

    if (here && here.side === PLAYER && movesFrom(sq).length) {
      showSelection(sq);
    } else {
      refuse(sq);
      clearSelection();
    }
  }

  function resolvePromotion(promo: string) {
    const p = promoPending;
    promoPending = null;
    aff.hidePromotion();
    if (!p) return;
    const wanted = movesFrom(p.from).filter((m) => m.to === sqOf(p.to));
    const pick = wanted.find((m) => m.promo === promo) ?? wanted.find((m) => m.promo === 'q') ?? wanted[0];
    if (!pick) { clearSelection(); return; }
    applyMove(pick);
    scheduleReply();
  }

  // --- the engine's turn ------------------------------------------------------------------

  function scheduleReply() {
    if (state.result !== 'playing') return;
    if (engine.side === PLAYER) return;
    replyDueAt = world.realTime;
  }

  function beginThinking(realT: number) {
    replyDueAt = -1;
    thoughtHeld = null;
    thinkStartedAt = realT;
    state.thinking = true;
    think.start(engine.fen, REPLY_NODES, realT);
  }

  function tryPlayThought(realT: number) {
    const th = thoughtHeld;
    if (!th) return;
    // Hold the reply until the player's own move has finished grinding across the board,
    // but never longer than REPLY_PATIENCE of a person's actual time.
    const settled = pending.length === 0;
    if (!settled && realT - thinkStartedAt < REPLY_PATIENCE) return;
    if (realT - thinkStartedAt < MIN_THINK) return;

    thoughtHeld = null;
    state.thinking = false;
    if (!th.uci) { model.syncState(); refreshMarks(); return; }
    // Re-resolve against our own live engine: the worker sent back text, not trust.
    const m = engine.moves().find((c) => c.uci === th.uci);
    if (!m) { model.syncState(); refreshMarks(); return; }
    applyMove(m);
  }

  // --- interactive render budget -------------------------------------------------------

  const renderer = world.renderer;
  const shadowWasAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  let lastShadow = -1;
  let frame = 0;
  /** Rendered frames between planar-reflection refreshes while nothing is moving. */
  const REFL_STRIDE = 3;
  let reflDriver: THREE.Object3D | null | undefined;

  function budget(t: number) {
    const moving = t < activeUntil;
    // The only shadow-caster in the scene is a fixed key light, so a still board's shadow
    // map is still correct several frames later. Refresh it every frame while a piece is
    // walking or rubble is settling, and a few times a second otherwise.
    if (moving || lastShadow < 0 || t - lastShadow > 0.25) {
      renderer.shadowMap.needsUpdate = true;
      lastShadow = t;
    }
    if (reflDriver === undefined) {
      reflDriver = world.scene.getObjectByName('board-reflection-driver') ?? null;
    }
    if (reflDriver) reflDriver.visible = frame % REFL_STRIDE === 0;
    frame++;
  }

  // --- lifecycle --------------------------------------------------------------------------

  const el = world.renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);

  // If the engine has the move from the very first frame (a staged position), let it play.
  scheduleReply();

  return {
    update(t, realT) {
      budget(t);

      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].t <= t) {
          const job = pending[i];
          pending.splice(i, 1);
          job.run();
        }
      }

      think.tick(realT);
      const ready = think.take();
      if (ready) thoughtHeld = ready;

      if (replyDueAt >= 0 && realT >= replyDueAt && !think.busy() && state.result === 'playing') {
        beginThinking(realT);
      }
      tryPlayThought(realT);

      aff.update(t);
    },

    refresh() {
      pending.length = 0;
      promoPending = null;
      aff.hidePromotion();
      thoughtHeld = null;
      state.thinking = false;
      refreshMarks();
      scheduleReply();
    },

    dispose() {
      el.removeEventListener('pointerdown', onPointerDown);
      think.dispose();
      aff.dispose();
      renderer.shadowMap.autoUpdate = shadowWasAuto;
      if (reflDriver) reflDriver.visible = true;
    },
  };
}
