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
 * reduced resolution and scale up in CSS, stop re-rendering a 2048² shadow map for a light
 * that never moves while nothing is moving under it, and stop re-rendering the marble's
 * planar reflection — a second, larger, full scene render — at frame rate. Under capture
 * none of this exists: the module is not constructed at all.
 *
 * Measured on this scene under SwiftShader, buffer width against wall-clock frame time:
 *
 *     1024 px  4002 ms      256 px  215 ms
 *      512 px   834 ms      128 px   81 ms
 *
 * — near enough linear in pixel count above a ~30 ms floor. Frame cost here is FRAGMENT
 * cost and nothing else, which is why the ladder below is the whole quality tier and why
 * it now reasons about pixels rather than walking one rung at a time.
 *
 * ── the framing ──────────────────────────────────────────────────────────────────────
 *
 * The other thing this file owns is the shape of the interactive frame, and it owns it
 * for one specific reason. `PLAY_SHOT` is a 30° lens at eye [0,15,-21], composed for the
 * 2.39:1 capture frame, and at that ratio every square of White's OWN back rank projects
 * ~20 px below the bottom edge of the picture: g1's centre lands at y=649 on a canvas that
 * ends at 628. A player clicking where their own king visibly stands hits page background.
 *
 * The fix cannot be in the shot — src/core is frozen, and the shot's eye and fov are the
 * contract. The previous fix here was to letterbox the canvas to 1.6:1, which bought the
 * height by throwing the sides away: on a 2.16:1 phone a fifth of the screen was black bar
 * and the picture in the middle was no bigger for it. The canvas is now the VIEWPORT, and
 * the height is bought with `camera.zoom` instead, which costs nothing and crops nothing.
 * See `fitBoard` below for the solve; the short version is that the board's own corners
 * decide the frame, so it fits at any aspect from 1.3:1 to 2.4:1 — and lands 20% larger on
 * a phone than the letterbox did, on a canvas a third wider again.
 */
import * as THREE from 'three';
import type { GameDeps, GameState, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import {
  PIECE_HEIGHT, RENDER, SQUARE, squareCentre, type PieceType, type Side,
} from '../core/constants';
import { PLAY_SHOT } from '../core/shots';
import type { Engine, Move } from '../chess';
import { STRIKE_CONTACT, STRIKE_RECOVER, WALK_MIN, WALK_PER_SQUARE } from './timeline';
import { createAffordances, type Affordances, type Mark } from './affordances';
import { createThinker, type Thought } from './thinker';

/** The human plays White. The engine answers as Black. */
const PLAYER: Side = 'white';

/** Node budget for a reply. Off-thread, so this is latency the player never feels. */
const REPLY_NODES = 60_000;

/**
 * Milliseconds a reply is held at MINIMUM, counted from the moment the search started.
 *
 * A worker answers a 60k-node search in a fraction of a second. Slamming the reply down
 * that fast reads as a twitch rather than a decision, and it gives the HUD's "thinking…"
 * no time to be seen. Counted from the start of the search, not from its end: if the
 * search itself already took longer than this, the answer is played the moment it lands
 * and nothing is added on top. That distinction is the difference between a floor and a
 * tax, and it used to be a tax.
 */
const MIN_THINK_MS = 500;

/**
 * Milliseconds of REAL time the reply will wait for the player's own move to stop moving.
 *
 * It reads better when the two do not overlap, but it is worth exactly one short pause and
 * no more. The previous version polled `pending.length` up to twelve times at 250 ms —
 * except a timer cannot fire while a frame is rendering, so on a renderer taking seconds a
 * frame each poll cost a whole frame and twelve of them cost half a minute. That, not the
 * chess, is where the critic's 36-second replies came from: the same 60k-node search runs
 * in ~230 ms. One deadline in real time, and then the reply goes in regardless.
 */
const SETTLE_MS = 700;

/** Seconds of grinding stone for a move of `dist` squares. Same numbers as the script. */
const WALK_OF = (dist: number) => Math.max(WALK_MIN, dist * WALK_PER_SQUARE);

/** Board bookkeeping the interactive controller needs from the game module. */
export interface BoardModel {
  engine: Engine;
  state: GameState;
  /** Interactive-only scale factors on flare decay and camera shake. See game/index.ts. */
  tuning: { flareDecay: number; shake: number };
  pieceAt(file: number, rank: number): PieceInstance | undefined;
  /** Every square that has a carved piece standing on it, for pointer picking. */
  occupied(): Array<{ file: number; rank: number; piece: PieceInstance }>;
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

  /** Real seconds elapsed, as of the last frame. Set by update(); see `later` below. */
  let realNow = 0;

  /**
   * Deferred VISUALS. Board bookkeeping is always immediate; this is the shatter, the
   * attacker stepping into the square it just cleared, the promoted piece appearing.
   *
   * Each job carries TWO deadlines and fires on whichever arrives first. `t` is scene
   * time, which is what the animation it belongs to is running on, and is the one that
   * fires on any machine keeping up. `real` is the wall clock, and it exists because
   * scene time is clamped: at a second a frame, a 0.62 s deferred contact is twelve frames
   * and most of a minute away, which is why the critic watched a blade land and saw no
   * debris in the scene graph two and a half seconds later. The animation may still be
   * grinding through it slowly — nothing here can make another module's tween run at wall
   * speed — but the CONSEQUENCE lands when it was supposed to.
   */
  const pending: Array<{ t: number; real: number; run: () => void }> = [];
  const later = (dt: number, run: () => void) =>
    pending.push({ t: world.time + dt, real: realNow + dt, run });

  let selected: Mark | null = null;
  /** A promotion the player has committed to except for the piece. */
  let promoPending: { from: Mark; to: Mark } | null = null;

  /** A finished thought waiting for its moment, and the timer that will take it. */
  let thoughtHeld: Thought | null = null;
  let thoughtTimer: ReturnType<typeof setTimeout> | null = null;
  /** Real time the current search began. Both reply deadlines are measured from it. */
  let thinkStartedAt = 0;
  /** Position the in-flight search was started from. A reply for any other is discarded. */
  let thinkFen = '';
  /** Clocks until which something is visibly moving. Drives the shadow throttle. */
  let activeUntil = 0;
  let activeUntilReal = 0;

  const markActive = (seconds: number) => {
    activeUntil = Math.max(activeUntil, world.time + seconds);
    activeUntilReal = Math.max(activeUntilReal, realNow + seconds);
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

  /**
   * Radius of the invisible column a piece is picked by, metres. A square is 2.35 m, so
   * this is a cylinder covering the middle ~72% of the slab — wide enough that a click
   * anywhere on a piece's body counts, narrow enough that it does not swallow clicks
   * meant for the square alongside.
   */
  const PICK_RADIUS = SQUARE * 0.36;

  /**
   * Ray against a capped vertical cylinder standing on the board. Returns the distance to
   * where the ray enters it, or null.
   *
   * Analytic rather than a mesh raycast on purpose: the carved pieces are the most
   * detailed geometry in the scene and the answer wanted here is "did the player click
   * this man", not "which triangle". A slightly generous column is also the friendlier
   * answer — nobody aims at a knight's ear.
   */
  function columnEntry(cx: number, cz: number, radius: number, top: number): number | null {
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const ox = o.x - cx;
    const oz = o.z - cz;
    let t0 = -Infinity;
    let t1 = Infinity;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      const b = 2 * (d.x * ox + d.z * oz);
      const c = ox * ox + oz * oz - radius * radius;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      t0 = (-b - s) / (2 * a);
      t1 = (-b + s) / (2 * a);
    } else if (ox * ox + oz * oz > radius * radius) {
      return null;                                   // parallel to the axis, outside it
    }
    if (Math.abs(d.y) > 1e-9) {                      // clip to the slab 0 <= y <= top
      const ta = -o.y / d.y;
      const tb = (top - o.y) / d.y;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    } else if (o.y < 0 || o.y > top) {
      return null;
    }
    const enter = Math.max(t0, 0);
    return t1 < enter ? null : enter;
  }

  /**
   * Which square the player just clicked.
   *
   * The board PLANE at y=0 is the answer, and it is deliberately not an occlusion test.
   * That distinction decides whether this game is playable at all, so it is worth the
   * paragraph: the play camera looks down the board at 34°, and a king is 4.55 m of stone.
   * A piece that tall throws 4.55/tan(34°) ≈ 6.7 m of itself across the floor behind it —
   * nearly three squares. Picking "the nearest solid thing under the cursor" is therefore
   * not the friendly answer but the hostile one: the ray from this camera to the CENTRE of
   * e2 passes 0.18 m from the axis of the white king on e1 at 2.33 m up, which is inside
   * any silhouette that king could plausibly have. An honest mesh pick refuses to let you
   * move your own king's pawn. A chess player clicks where the SQUARE is; every board they
   * have ever used has answered that question, and so does this one.
   *
   * The column test below is the exception that costs nothing: when the ray misses the
   * board entirely, it is very often because the player aimed at the upper body of a piece
   * on a far rank, whose crown projects past the back edge. That click used to do nothing.
   * Now it finds the piece it visibly landed on.
   */
  function boardSquare(): Mark | null {
    if (ray.ray.intersectPlane(plane, hitPoint)) {
      const file = Math.round(hitPoint.x / SQUARE + 3.5);
      const rank = Math.round(hitPoint.z / SQUARE + 3.5);
      if (file >= 0 && file <= 7 && rank >= 0 && rank <= 7) return { file, rank };
    }

    let best: Mark | null = null;
    let bestT = Infinity;
    for (const { file, rank, piece } of model.occupied()) {
      if (piece.destroyed) continue;
      const { x, z } = squareCentre(file, rank);
      const t = columnEntry(x, z, PICK_RADIUS, Math.max(1.2, piece.height));
      if (t !== null && t < bestT) {
        bestT = t;
        best = { file, rank };
      }
    }
    return best;
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
    thinkStartedAt = realNow;
    state.thinking = true;
    think.start(thinkFen, REPLY_NODES, world.realTime, onThought);
  }

  /**
   * The search came back. Work out the ONE delay it should sit behind and set ONE timer.
   *
   * Both deadlines are measured from the moment the search started, not from now, so a
   * search that already took a second adds nothing on top of itself. And there is exactly
   * one timer: a timer cannot fire while a frame is rendering, so every re-arm costs a
   * whole frame on a slow renderer, and a chain of them is how a 230 ms search turned into
   * a 36-second wait.
   */
  function onThought(th: Thought) {
    thoughtHeld = th;
    const spentMs = Math.max(0, (realNow - thinkStartedAt) * 1000);
    const settle = pending.length > 0 ? SETTLE_MS : 0;
    const wait = Math.max(MIN_THINK_MS, settle) - spentMs;
    // Zero delay still costs a macrotask, and a macrotask cannot run while a frame is
    // rendering — on the low tier that is a whole frame spent waiting for a timer whose
    // whole purpose was to wait for nothing. `realNow` advancing past `thinkStartedAt`
    // means at least one frame has already gone by with the HUD showing "thinking…", so
    // the pause has been served and the move goes down on this turn of the event loop.
    // (This runs from the worker's message event or from the ladder's timer — between
    // frames either way, never on one.)
    if (wait <= 0) playThought();
    else arm(wait);
  }

  function arm(ms: number) {
    if (thoughtTimer !== null) clearTimeout(thoughtTimer);
    thoughtTimer = setTimeout(() => { thoughtTimer = null; playThought(); }, Math.max(0, ms));
  }

  function playThought() {
    const th = thoughtHeld;
    if (!th) return;
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
   * The shape of the interactive frame: the whole viewport, and the board inside it.
   *
   * The canvas is the viewport — no letterbox. `main.ts` already sets `camera.aspect` from
   * the real viewport and widens the vertical fov when the frame is narrower than the
   * 2.39:1 reference (`fitFov` there), so filling the screen is mostly a matter of not
   * fighting it.
   *
   * But fitFov alone does not keep the board in frame, and that is the whole reason the
   * letterbox was here. It holds the HORIZONTAL extent fixed, so at 2.16:1 the vertical fov
   * opens to only 33° — and White's own back rank needs 18.5° below the lens axis from this
   * eye. Rank 1 falls off the bottom and a player cannot click their own king.
   *
   * So the height is bought with ZOOM instead. `PerspectiveCamera.zoom` divides the frame
   * extent in BOTH axes: no stretch, no re-aim, not one number of the frozen shot touched.
   * Neither the camera rig nor fitFov reads or writes it, so a value set here survives into
   * the projection matrix — and into the raycaster, which unprojects through that same
   * matrix, so picking follows the picture for free.
   *
   * `view` carries the other half. The board is not centred on the lens axis — it runs from
   * 18.5° below it to 8.5° above — so the frame is shifted DOWN by the difference, and the
   * board sits in the middle of the picture instead of hugging the bottom edge. That shift
   * is what pays for most of the extra size: without it the frame has to be opened wide
   * enough to hold 18.5° in both directions, and half of that is empty ceiling.
   *
   * Zoom is capped at 1: the play view is never TIGHTER than the shot. A frame wider than
   * the reference gets a zoom below 1 because it needs the height; anything narrower has
   * the height from fitFov already and is left alone.
   */

  /** Half the board, metres, and the tallest crown that can stand on a corner square. */
  const BOARD_HALF = SQUARE * 4;
  const CROWN = PIECE_HEIGHT.king;
  /** Clearance kept around the board plane, and around those crowns. */
  const PLANE_MARGIN = 1.18;
  const CROWN_MARGIN = 1.06;

  /**
   * What the board demands of the frame, in tangent units off the play camera's lens axis:
   * half-width, half-height, and where the middle of the vertical band it occupies sits.
   *
   * Solved once from the FROZEN shot rather than from the live camera. The operator's
   * handheld drift is ±0.5° and its flinch about 1.3°; re-solving against that every frame
   * would breathe the framing in time with the shake. The margins above cover it instead.
   */
  const FIT = (() => {
    const eye = new THREE.Vector3(...PLAY_SHOT.eye);
    const fwd = new THREE.Vector3(...PLAY_SHOT.target).sub(eye).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const v = new THREE.Vector3();
    let halfX = 0;
    let lo = 0;
    let hi = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, CROWN]) {
          const margin = y === 0 ? PLANE_MARGIN : CROWN_MARGIN;
          v.set(sx * BOARD_HALF, y, sz * BOARD_HALF).sub(eye);
          const depth = Math.max(0.1, v.dot(fwd));
          halfX = Math.max(halfX, (Math.abs(v.dot(right)) / depth) * margin);
          const ty = (v.dot(up) / depth) * margin;
          lo = Math.min(lo, ty);
          hi = Math.max(hi, ty);
        }
      }
    }
    return { eye, halfX, halfY: (hi - lo) / 2, centreY: (hi + lo) / 2 };
  })();

  /**
   * Solve zoom and the vertical shift for this aspect, and hand them to the camera.
   *
   * Runs from `update()`, which main.ts calls BEFORE the camera rig composes the frame and
   * before fitFov, so both values are in place for the projection matrix this frame builds.
   *
   * The guard is for a live page opened with `?shot=` and no `?t=`: that is not a capture,
   * it is interactive play behind a FILM camera, whose framing is somebody else's contract.
   * Fit only the camera this solve is about.
   */
  function fitBoard(aspect: number) {
    const cam = world.camera;
    if (cam.position.distanceToSquared(FIT.eye) > 4) {
      cam.zoom = 1;
      if (cam.view) cam.clearViewOffset();
      return;
    }
    // The vertical half-extent main.ts is about to derive from this aspect, as a tangent.
    const shotHalf = Math.tan((PLAY_SHOT.fov * Math.PI) / 360);
    const tanV = aspect < RENDER.aspect ? (shotHalf * RENDER.aspect) / aspect : shotHalf;
    const zoom = Math.min(1, tanV / FIT.halfY, (aspect * tanV) / FIT.halfX);
    // view.offsetY is in units of the full frame and moves the window DOWN; the frame
    // centre ends up at -2·offsetY·halfHeight, hence the sign and the factor.
    const shift = -FIT.centreY / (2 * (tanV / zoom));
    cam.zoom = zoom;
    if (!cam.view || cam.view.offsetY !== shift) cam.setViewOffset(1, 1, 0, shift, 1, 1);
  }

  /**
   * Interactive resolution, as a fraction of the display size — chosen by measurement.
   *
   * This is the interactive quality tier. `world.quality` is fixed for the life of the
   * page and every other module has already been built by the time the game exists, so
   * the tier cannot be picked at construction. Resolution still can, and it is worth more
   * than everything else here combined: measured on this scene under SwiftShader, frame
   * time is very close to linear in pixel count above a ~30 ms floor (1024 px wide 4002 ms,
   * 512 px 834 ms, 256 px 215 ms, 128 px 81 ms). Nothing else in the frame comes close —
   * dropping the bloom pass entirely, or the shadow map, or the planar reflection, each
   * moved the same frame by well under a factor of two.
   *
   * The canvas is rendered small and stretched to full size in CSS, so framing, camera and
   * pointer mapping (which reads getBoundingClientRect — CSS pixels) are untouched.
   *
   * ── the floor ──
   *
   * The ladder used to bottom out at 0.38, which on a 1280 px canvas is a 486 px buffer —
   * and a phone reached it in the first second and stayed there, so the game a person
   * actually played was a 486 px picture stretched over their screen. Every carved edge,
   * every vein in the marble and every letter of the HUD was an upscale of something that
   * had never been rendered. No amount of detail elsewhere survives that.
   *
   * So the floor is now absolute as well as fractional: never below 75% of the display, and
   * never below 800 px across whatever the display is. On a phone in landscape (844 CSS px)
   * that pins the buffer at 800; on a 1280 px desktop canvas the floor is 960. Both are
   * resolutions where the picture is a picture rather than a magnified thumbnail.
   *
   * The rungs are gentle to match — 0.75 / 0.85 / 0.92 / 1.0, about 15% of pixel cost
   * apiece, so the scaler trades a little sharpness for a little speed instead of falling
   * off a cliff. And it is slower to give up: a frame has to be over 70 ms (14 fps) for
   * three quarters of a second before a rung goes. Dropping a few frames is cheaper than
   * rendering mush — mush is permanent while it lasts, and a dropped frame is gone.
   */
  const SCALE_LADDER = [0.75, 0.85, 0.92, 1.0];
  /** Start one rung down: good hardware climbs in a second, bad hardware is already there. */
  let scaleIdx = 1;
  /** Absolute sharpness floor and sanity cap on the render buffer, in pixels across. */
  const MIN_BUFFER_W = 800;
  const MAX_BUFFER_W = 1920;
  let scaleChanges = 0;
  const MAX_SCALE_CHANGES = 14;
  /** Real seconds per frame we are aiming at, and the one that counts as too slow. */
  const FRAME_TARGET = 0.033;
  const FRAME_SLOW = 0.070;
  /** Real seconds of shader compilation and first-frame cost to ignore before judging. */
  const WARMUP = 1.5;
  /**
   * A gap this long is not a frame anybody rendered — it is a suspended tab, a laptop lid,
   * or the very first paint. It is evidence of nothing and is not measured. What it must
   * NOT do is look fast; see `fastRun`.
   */
  const SUSPEND_DT = 30;
  /**
   * Consecutive frames under FRAME_TARGET required to take a rung, and the far longer run
   * required to take back a rung this machine has already failed to hold. 45 frames under
   * 33 ms is a second and a half of genuinely smooth play; 180 is six.
   */
  const CLIMB_RUN = 45;
  const RECLAIM_RUN = 180;
  let frameEma = 0;
  /** Frames actually measured. The sentinel for "no data yet" — never `frameEma === 0`. */
  let frameSamples = 0;
  /** Length of the current unbroken run of frames under FRAME_TARGET. */
  let fastRun = 0;
  /** Highest rung this machine has not yet proved it cannot hold. */
  let ceilingIdx = SCALE_LADDER.length - 1;
  let lastRealT = -1;
  let decisionAt = 0;

  let cssW = 0;
  let cssH = 0;

  /** Viewport size in CSS pixels. The canvas is exactly this — there is no letterbox. */
  const viewW = () => Math.max(320, window.innerWidth || RENDER.width);
  const viewH = () => Math.max(200, window.innerHeight || RENDER.height);

  /**
   * Render scale for a given rung on a canvas `cw` CSS pixels wide.
   *
   * The floor is the interesting half: whichever is LARGER of the rung and the fraction
   * that still leaves MIN_BUFFER_W pixels across. On a small canvas the pixel floor wins
   * and the ladder is effectively disabled — an 844 px phone canvas never renders below
   * 800 px — while on a large one the fractional floor keeps the cost bounded.
   */
  function scaleFor(idx: number, cw: number): number {
    const floor = Math.min(1, MIN_BUFFER_W / Math.max(1, cw));
    return Math.min(1, Math.max(SCALE_LADDER[idx], floor));
  }

  function fitCanvas() {
    const el = renderer.domElement;
    const cw = viewW();
    const ch = viewH();
    const aspect = cw / ch;

    const w = Math.max(320, Math.min(MAX_BUFFER_W, Math.round(cw * scaleFor(scaleIdx, cw))));
    const h = Math.max(1, Math.round(w / aspect));

    if (el.width !== w || el.height !== h || cssW !== cw || cssH !== ch) {
      cssW = cw;
      cssH = ch;
      // main.ts's own fit() sets a device pixel ratio for the full-viewport case. Here the
      // ladder above already decides how many pixels to render, so the buffer is exactly
      // what we ask for — otherwise el.width never matches w and this resizes every frame.
      renderer.setPixelRatio(1);
      // Lighting owns the post chain, so it — not the renderer — is what gets resized.
      deps.lighting.setSize(w, h);
      // The buffer is stretched to the whole viewport. Both dimensions are set explicitly:
      // #stage centres the canvas, so a canvas that is not the full size leaves black bar.
      el.style.width = `${cw}px`;
      el.style.height = `${ch}px`;
    }

    // Every frame, not just on change: main.ts's resize handler rewrites camera.aspect from
    // the viewport, and the rig rebuilds the projection from it after this runs.
    world.camera.aspect = aspect;
    fitBoard(aspect);
    world.camera.updateProjectionMatrix();
  }

  /**
   * Watch the real frame time and pick the rung.
   *
   * Both directions move one rung at a time. The old version solved for the biggest rung
   * that fitted the budget and took it in a single step, which made sense when the bottom
   * of the ladder was 0.38 and the walk down was four frames of a person's life. With four
   * gentle rungs above a hard floor there is nothing left to solve for: the worst case is
   * three steps, and each one costs 15% of the picture rather than half of it.
   *
   * ── why this used to climb on a machine 66x too slow to ──────────────────────────────
   *
   * Instrumented at a 932x430 viewport under the software rasteriser, the buffer walked
   * 800 -> 857 -> 932 -> 857 -> 932 across four minutes while frames were taking over two
   * seconds each. The trace of the decision inputs shows exactly how, and it is three
   * separate mistakes stacking:
   *
   *   {realT: 54.15, dt: 54.15, why: 'skip', frameEma: 0}
   *   {realT: 54.16, dt: 0.017, ema: 0.017, idx: 1, since: 54.16, fs: 2}
   *
   *   1. `frameEma === 0` was doing double duty: it was the "no measurement yet" sentinel
   *      AND a value that sails through `frameEma < FRAME_TARGET`. `commit()` set it to 0
   *      on every rung change, and the "tab was asleep" guard returned BEFORE updating it,
   *      so 0 survived into the next decision.
   *   2. With the average empty, the next sample REPLACED it outright instead of being
   *      averaged into it — and the next sample after a long stall is a catch-up rAF
   *      callback that costs nothing. One 17 ms callback stood in for a 10-second frame.
   *      31x over the slow threshold, measured as half the target.
   *   3. `framesSince` and `decisionAt` were only reset when a rung actually CHANGED. At
   *      932 CSS px the MIN_BUFFER_W floor makes rungs 0 and 1 identical, so the too-slow
   *      branch kept returning without committing, and those two counters grew for the
   *      whole session. After the first minute `since > 1.5 && framesSince >= 20` was
   *      permanently true and the average was the only gate left — the one that had just
   *      been handed a 17 ms lie.
   *
   * So the climb no longer trusts an average at all. It requires an unbroken RUN of frames
   * under target: `fastRun` resets to zero on any frame over target, and on any suspended
   * gap, so "45 fast frames" means 45 in a row. A machine at two seconds a frame cannot
   * produce two in a row, let alone forty-five, however the browser bunches its callbacks.
   *
   * And a rung that had to be given up becomes a ceiling. Reclaiming it needs four times
   * the evidence (RECLAIM_RUN), so a device that is simply slow pins to its floor and
   * stays there — thrashing resolution is worse than sitting on a stable rung — while one
   * that was briefly busy can still come back.
   */
  function adaptScale(realT: number) {
    if (lastRealT < 0) { lastRealT = realT; decisionAt = realT; return; }
    const dt = realT - lastRealT;
    lastRealT = realT;
    if (!(dt > 0)) return;
    if (dt > SUSPEND_DT) {
      // Not a frame anybody rendered. It says nothing about how fast this machine is —
      // but it absolutely must not be able to masquerade as speed, so the fast run dies
      // here and the average is left exactly as it was.
      fastRun = 0;
      return;
    }
    frameSamples++;
    frameEma = frameSamples === 1 ? dt : frameEma * 0.75 + dt * 0.25;
    fastRun = dt < FRAME_TARGET ? fastRun + 1 : 0;
    if (realT < WARMUP) { decisionAt = realT; fastRun = 0; return; }
    if (scaleChanges >= MAX_SCALE_CHANGES) return;
    const since = realT - decisionAt;

    const cw = cssW || viewW();
    const commit = (idx: number) => {
      if (idx === scaleIdx) return;
      // Frame cost on this scene is very close to linear in pixel count, so the average
      // is not thrown away across a rung change — it is carried over at the cost the new
      // rung is expected to have. That leaves no "no data" hole for a cheap catch-up
      // callback to fall into, which is what the climb used to be triggered by.
      const before = scaleFor(scaleIdx, cw);
      const after = scaleFor(idx, cw);
      if (before > 0) frameEma *= (after * after) / (before * before);
      scaleIdx = idx;
      scaleChanges++;
      decisionAt = realT;
      fastRun = 0;
    };

    if (frameEma > FRAME_SLOW && since > 0.75) {
      // This rung is beyond this machine, whether or not there is a lower one to take.
      // Recording that is the point: it is what stops the ladder walking back up into it.
      if (scaleIdx > 0 && scaleFor(scaleIdx - 1, cw) < scaleFor(scaleIdx, cw)) {
        ceilingIdx = Math.min(ceilingIdx, scaleIdx - 1);
        commit(scaleIdx - 1);
      } else {
        // Nothing to gain from a rung the pixel floor is already holding above it — but
        // the machine has still failed at this one, so it does not get climbed past.
        ceilingIdx = Math.min(ceilingIdx, scaleIdx);
        decisionAt = realT;
        fastRun = 0;
      }
      return;
    }
    const needed = scaleIdx < ceilingIdx ? CLIMB_RUN : RECLAIM_RUN;
    if (scaleIdx < SCALE_LADDER.length - 1 && fastRun >= needed
        && frameEma < FRAME_TARGET && since > 1.5) {
      if (scaleIdx >= ceilingIdx) ceilingIdx = Math.min(SCALE_LADDER.length - 1, scaleIdx + 1);
      commit(scaleIdx + 1);
    }
  }

  function budget(t: number, realT: number) {
    adaptScale(realT);
    fitCanvas();
    // Both clocks have to agree that something is still moving. `activeUntil` alone is
    // scene time, which on a slow renderer stays "moving" for tens of real seconds after
    // the stone has come to rest, and that is the expensive state.
    const moving = t < activeUntil && realT < activeUntilReal;
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

  /**
   * How fast scene time is running compared with the wall clock, and what to do about it.
   *
   * `world.time` accumulates a dt clamped at 0.05 s, so on a renderer taking a second a
   * frame it advances at a twentieth of real speed. Anything specified as a DURATION IN
   * SCENE SECONDS therefore lasts twenty times longer than it was meant to, and the flare
   * a capture throws is the one where that is unmistakable: 0.55 s of decay became most of
   * a minute of white bloom, they stacked capture on capture, and by move twelve the middle
   * of the board was unreadable. Scaling the requested decay by this ratio hands the
   * lighting piece a number that expires after about the right amount of a PERSON's time,
   * with a floor of a few frames so it is never invisible.
   *
   * Only interactive play touches these; under capture the module does not exist and the
   * game module's own defaults of 1 are what reach lighting and camera.
   */
  let sceneRate = 1;

  function tune(dtScene: number, dtReal: number) {
    if (dtReal > 1e-4 && dtScene > 0 && dtReal < 30) {
      const r = Math.min(1, dtScene / dtReal);
      sceneRate = sceneRate * 0.8 + r * 0.2;
    }
    // 2.5·rate targets ~1.4 s of real decay; the floor keeps it alive for ~3 frames of
    // scene time so a flash is never lost between two frames entirely.
    const floor = Math.min(1, (3 * Math.max(0.001, dtScene)) / 0.55);
    model.tuning.flareDecay = Math.min(1, Math.max(floor, 2.5 * sceneRate));
    model.tuning.shake = Math.min(1, Math.max(0.45, 3 * sceneRate));
  }

  // --- lifecycle --------------------------------------------------------------------------

  const el = world.renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);

  // If the engine has the move from the very first frame (a staged position), let it play.
  scheduleReply();

  return {
    update(t, realT) {
      const dtReal = realNow > 0 ? realT - realNow : world.dt;
      realNow = realT;
      tune(world.dt, dtReal);
      budget(t, realT);

      // Whichever deadline arrives first — see `later`. Scene time on a machine keeping
      // up, the wall clock on one that is not.
      //
      // In SCHEDULE order, and pulled out of the queue before any of them runs. A slow
      // frame now routinely makes several jobs due at once, and they are the steps of one
      // capture: clear the victim, step the attacker into the square, put the promoted
      // piece down. Running them backwards puts the new queen on the board before the pawn
      // has walked there.
      if (pending.length) {
        const due: Array<() => void> = [];
        for (let i = 0; i < pending.length; ) {
          if (pending[i].t <= t || pending[i].real <= realT) due.push(pending.splice(i, 1)[0].run);
          else i++;
        }
        for (const run of due) run();
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
      // Hand the camera back exactly as it was found: no zoom, no shifted window.
      world.camera.zoom = 1;
      world.camera.clearViewOffset();
      world.camera.updateProjectionMatrix();
    },
  };
}
