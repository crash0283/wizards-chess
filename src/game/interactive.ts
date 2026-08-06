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
 *    the search really does span real seconds now, `state.thinking` is a state the HUD can
 *    actually show, rather than something set and cleared inside one call.
 *
 * ── and the consequence of both: nothing waits for a frame ───────────────────────────
 *
 * The reply is applied from the worker's message event via a timer, not from `update()`.
 * That matters more than it sounds: this scene can take seconds to render one frame under
 * a software rasteriser, and a reply that is only ever applied inside the frame loop is a
 * reply the player waits a whole frame for no matter how quick the search was. Clicks,
 * searches and replies all now happen between frames. Only the animation is frame-bound,
 * because animation has to be.
 *
 * ── the interactive quality tier ─────────────────────────────────────────────────────
 *
 * A live page gets `world.quality === 'high'` and every other module has already been
 * built by the time the game exists, so the tier cannot be chosen at construction. What
 * this module can still do, and does, is cut the work per interactive frame: render at
 * half resolution and scale up in CSS, stop re-rendering a 2048² shadow map for a light
 * that never moves while nothing is moving under it, and stop re-rendering the marble's
 * planar reflection — a second, larger, full scene render — at frame rate. Under capture
 * none of this exists: the module is not constructed at all.
 */
import * as THREE from 'three';
import type { GameDeps, GameState, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import { RENDER, SQUARE, type PieceType, type Side } from '../core/constants';
import type { Engine, Move } from '../chess';
import { STRIKE_CONTACT, STRIKE_RECOVER, WALK_MIN, WALK_PER_SQUARE } from './timeline';
import { createAffordances, type Affordances, type Mark } from './affordances';
import { createThinker, type Thought } from './thinker';

/** The human plays White. The engine answers as Black. */
const PLAYER: Side = 'white';

/** Node budget for a reply. Off-thread, so this is latency the player never feels. */
const REPLY_NODES = 60_000;

/**
 * Milliseconds the "thinking" state is held at minimum.
 *
 * A worker answers a 60k-node search in a fraction of a second. Slamming the reply down
 * that fast reads as a twitch rather than a decision, and it gives the HUD's "thinking…"
 * no time to be seen — which was one of the specific complaints. This is a timer, not a
 * frame count, so it is the same half second whatever the renderer is doing.
 */
const MIN_THINK_MS = 550;

/** How often, in ms, we re-check whether the player's move has finished animating. */
const SETTLE_POLL_MS = 250;

/** Most times we will defer the reply waiting for that — about three seconds' worth. */
const MAX_SETTLE_WAITS = 12;

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

/** Everything the markers do, doing nothing. Used only if the real ones fail to build. */
function nullAffordances(): Affordances {
  return {
    group: new THREE.Group(),
    setSelection() {}, setDestinations() {}, refuse() {}, setCheck() {},
    setGameOver() {}, showPromotion: () => [], hidePromotion() {},
    pickables: () => [], update() {}, dispose() {},
  };
}

export function createInteractive(world: World, deps: GameDeps, model: BoardModel): Interactive {
  const { engine, state } = model;

  // Priority one is that the engine replies. The markers are worth a great deal, but not
  // the whole game: if anything in them fails to build (a canvas the browser will not
  // give us, a texture it will not allocate) play carries on without them.
  let aff: Affordances;
  try {
    aff = createAffordances(world);
    world.scene.add(aff.group);
  } catch (err) {
    console.warn('affordances unavailable, playing without markers:', err);
    aff = nullAffordances();
  }
  const think = createThinker();

  /** Deferred VISUALS only, on world.time. Board bookkeeping is always immediate. */
  const pending: Array<{ t: number; run: () => void }> = [];
  const later = (dt: number, run: () => void) => pending.push({ t: world.time + dt, run });

  let selected: Mark | null = null;
  /** A promotion the player has committed to except for the piece. */
  let promoPending: { from: Mark; to: Mark } | null = null;

  /** A finished thought waiting for its moment, and the timer that will take it. */
  let thoughtHeld: Thought | null = null;
  let thoughtTimer: ReturnType<typeof setTimeout> | null = null;
  let settleWaits = 0;
  /** Position the in-flight search was started from. A reply for any other is discarded. */
  let thinkFen = '';
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
    if (flags.includes('k') || flags.includes('q')) {
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
      later(arriveAt, () => model.promoteOn(to.file, to.rank, type, mover));
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

  /**
   * Hand the position to the engine. Called straight from the click that ended the
   * player's move — NOT from the frame loop, so the search starts immediately however
   * long the renderer is taking over the current frame.
   */
  function scheduleReply() {
    if (state.result !== 'playing') return;
    if (engine.side === PLAYER) return;
    if (think.busy()) return;
    thinkFen = engine.fen;
    thoughtHeld = null;
    settleWaits = 0;
    state.thinking = true;
    think.start(thinkFen, REPLY_NODES, world.realTime, onThought);
  }

  function onThought(th: Thought) {
    thoughtHeld = th;
    settleWaits = 0;
    arm(MIN_THINK_MS);
  }

  function arm(ms: number) {
    if (thoughtTimer !== null) clearTimeout(thoughtTimer);
    thoughtTimer = setTimeout(() => { thoughtTimer = null; playThought(); }, ms);
  }

  function playThought() {
    const th = thoughtHeld;
    if (!th) return;
    // Prefer to let the player's own move finish grinding across the board first, but
    // never at the cost of the reply: after MAX_SETTLE_WAITS the two simply overlap.
    if (pending.length > 0 && settleWaits < MAX_SETTLE_WAITS) {
      settleWaits++;
      arm(SETTLE_POLL_MS);
      return;
    }
    thoughtHeld = null;
    state.thinking = false;
    // The board may have been replaced under the search (setPosition). A move found for
    // some other position is not an answer to this one, however legal it happens to be.
    if (engine.fen !== thinkFen) return;
    if (!th.uci) { model.syncState(); refreshMarks(); return; }
    // Re-resolve against our own live engine: the worker sent back text, not trust.
    const m = engine.moves().find((c) => c.uci === th.uci);
    if (!m) { model.syncState(); refreshMarks(); return; }
    applyMove(m);
  }

  function abandonThought() {
    if (thoughtTimer !== null) { clearTimeout(thoughtTimer); thoughtTimer = null; }
    thoughtHeld = null;
    thinkFen = '';
    settleWaits = 0;
    state.thinking = false;
  }

  // --- interactive render budget -------------------------------------------------------

  const renderer = world.renderer;
  const shadowWasAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  let lastShadow = -1;
  let frame = 0;
  /** Rendered frames between planar-reflection refreshes: while moving, and while idle. */
  const REFL_MOVING = 3;
  const REFL_IDLE = 24;
  /** Scene seconds between shadow-map refreshes while nothing is moving. */
  const SHADOW_IDLE = 2.0;
  let reflDriver: THREE.Object3D | null | undefined;

  /**
   * Interactive resolution, as a fraction of the display size — chosen by measurement.
   *
   * This is the interactive quality tier. `world.quality` is fixed for the life of the
   * page and every other module has already been built by the time the game exists, so
   * the tier cannot be picked at construction. Resolution still can, and on a software
   * rasteriser it is worth more than everything else here combined.
   *
   * Rather than commit to one number, this walks a short ladder against the real frame
   * time (`world.realTime`, the only honest clock — `world.time` is clamped and cannot
   * tell a slow frame from a fast one). A machine with a GPU climbs to full resolution
   * within a couple of seconds; a machine without one settles at the bottom of the ladder
   * instead of showing a person a slideshow. The number of changes is capped, because
   * each one reallocates the post chain's render targets.
   *
   * The canvas is rendered small and stretched to full size in CSS, so framing, camera
   * and pointer mapping (which reads getBoundingClientRect — CSS pixels) are untouched.
   */
  const SCALE_LADDER = [0.4, 0.5, 0.6, 0.75, 1.0];
  /** Start one rung below the top: good hardware climbs, bad hardware never has to fall far. */
  let scaleIdx = 2;
  let scaleChanges = 0;
  const MAX_SCALE_CHANGES = 10;
  /** Target band, in real seconds per frame: slower than 45 ms drops, faster than 22 ms climbs. */
  const FRAME_SLOW = 0.045;
  const FRAME_FAST = 0.022;
  /** Real seconds of shader compilation and first-frame cost to ignore before judging. */
  const WARMUP = 1.5;
  let frameEma = 0;
  let lastRealT = -1;
  let decisionAt = 0;
  let framesSince = 0;

  let cssW = 0;

  function fitCanvas() {
    const el = renderer.domElement;
    const wantCss = Math.max(
      320,
      Math.min(window.innerWidth || RENDER.width, Math.round((window.innerHeight || RENDER.height) * RENDER.aspect)),
    );
    const w = Math.max(160, Math.round(wantCss * SCALE_LADDER[scaleIdx]));
    const h = Math.max(1, Math.round(w / RENDER.aspect));
    if (el.width === w && el.height === h && cssW === wantCss) return;
    cssW = wantCss;
    // Lighting owns the post chain, so it — not the renderer — is what gets resized.
    deps.lighting.setSize(w, h);
    el.style.width = `${wantCss}px`;
    el.style.height = `${Math.round(wantCss / RENDER.aspect)}px`;
    world.camera.aspect = RENDER.aspect;
    world.camera.updateProjectionMatrix();
  }

  /**
   * Watch the real frame time and move one rung at a time.
   *
   * Asymmetric on purpose. Dropping is allowed after half a second, because on a renderer
   * taking twenty seconds a frame "wait for twelve more frames" is four minutes of a
   * person's life. Climbing needs both a run of frames and a second of real time, so a
   * momentary lull cannot push a machine back into a resolution it cannot hold.
   */
  function adaptScale(realT: number) {
    if (lastRealT < 0) { lastRealT = realT; decisionAt = realT; return; }
    const dt = realT - lastRealT;
    lastRealT = realT;
    framesSince++;
    if (!(dt > 0) || dt > 30) return;                 // first frame, or the tab was asleep
    frameEma = frameEma === 0 ? dt : frameEma * 0.75 + dt * 0.25;
    if (realT < WARMUP) { decisionAt = realT; framesSince = 0; return; }
    if (scaleChanges >= MAX_SCALE_CHANGES) return;
    const since = realT - decisionAt;
    const step = (dir: number) => {
      scaleIdx += dir; scaleChanges++; decisionAt = realT; framesSince = 0; frameEma = 0;
    };
    if (frameEma > FRAME_SLOW && scaleIdx > 0 && since > 0.5) step(-1);
    else if (frameEma < FRAME_FAST && scaleIdx < SCALE_LADDER.length - 1 && since > 1.0 && framesSince >= 20) step(1);
  }

  function budget(t: number, realT: number) {
    adaptScale(realT);
    fitCanvas();
    const moving = t < activeUntil;
    // The only shadow-caster in the scene is one fixed key light, so a still board's
    // shadow map is still correct many frames later. Refresh it every frame while a piece
    // is walking or rubble is settling, and rarely otherwise.
    if (moving || lastShadow < 0 || t - lastShadow > SHADOW_IDLE) {
      renderer.shadowMap.needsUpdate = true;
      lastShadow = t;
    }
    // The marble's planar reflection is a SECOND full scene render, at high quality a
    // larger one than the interactive frame itself. What it shows is the room, which
    // barely changes; a stale mirror on a piece of polished floor is not a thing the eye
    // catches, and this is the single biggest saving available from here.
    if (reflDriver === undefined) {
      reflDriver = world.scene.getObjectByName('board-reflection-driver') ?? null;
    }
    if (reflDriver) reflDriver.visible = frame % (moving ? REFL_MOVING : REFL_IDLE) === 0;
    frame++;
  }

  // --- lifecycle --------------------------------------------------------------------------

  const el = world.renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);

  // If the engine has the move from the very first frame (a staged position), let it play.
  scheduleReply();

  return {
    update(t, realT) {
      budget(t, realT);

      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].t <= t) {
          const job = pending[i];
          pending.splice(i, 1);
          job.run();
        }
      }

      // The worker's watchdog is the only thing the frame loop still owes the engine.
      think.tick(realT);
      // Backstop: if it is the engine's move and nothing is in flight (a staged position,
      // or a search that was abandoned), get one going.
      if (state.result === 'playing' && engine.side !== PLAYER && !think.busy() && !thoughtHeld) {
        scheduleReply();
      }

      aff.update(t);
    },

    refresh() {
      pending.length = 0;
      promoPending = null;
      aff.hidePromotion();
      abandonThought();
      refreshMarks();
      scheduleReply();
    },

    dispose() {
      abandonThought();
      el.removeEventListener('pointerdown', onPointerDown);
      think.dispose();
      aff.dispose();
      renderer.shadowMap.autoUpdate = shadowWasAuto;
      if (reflDriver) reflDriver.visible = true;
    },
  };
}
