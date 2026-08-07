/**
 * How a move is DANCED, as opposed to what it does to the board.
 *
 * This is interactive-only geometry and timing. Nothing here is imported by timeline.ts or
 * by the scripted branch of index.ts, so the film shots cannot see it — see the note in
 * interactive.ts for why that separation is load-bearing.
 *
 * ── the bug this file exists to kill ─────────────────────────────────────────────────
 *
 * A capture used to be: strike from the attacker's ORIGINAL square, shatter the victim
 * 0.62 s later, then stroll across the board onto the square it had already cleared. A
 * rook taking a man six squares away detonated it from the far side of the room. Even a
 * pawn killed diagonally before it had moved a centimetre. The player's report — "the
 * destruction happens too soon" — is exactly that, and it is an ORDERING bug, not a
 * timing one.
 *
 * The order a capture actually has:
 *
 *     travel  →  arrive adjacent  →  poise  →  strike  →  CONTACT  →  shatter
 *             →  follow-through   →  step onto the square
 *
 * The victim is whole and standing for every beat up to contact.
 *
 * ── arrive adjacent, not on top ──────────────────────────────────────────────────────
 *
 * `PieceInstance.walkTo(file, rank, seconds)` resolves its destination through
 * `squareCentre`, which is LINEAR in file and rank. Fractional coordinates therefore name
 * a real point on the board, and that is the whole trick here: the attacker walks to a
 * fractional station `STANDOFF` squares short of its victim and strikes from there, so
 * there is a held moment with two men standing together and one about to die. Nothing in
 * the pieces module had to change to allow it.
 *
 * ── the knight ───────────────────────────────────────────────────────────────────────
 *
 * A knight is the one man whose move is not a straight line, and gliding it diagonally
 * puts it through whatever stands on the square between. It walks its L instead: two
 * squares along the long axis, which lands it orthogonally ADJACENT to its target — so
 * the elbow of the L is already the striking station, and the second leg of the L is the
 * step onto the cleared square. If a man stands on that elbow the L is taken the other way
 * round, and if one stands on a square the leg passes over, the leg bows around him.
 */

/** A board square. */
export interface Sq {
  file: number;
  rank: number;
}

/** A point on the board in fractional square coordinates. Legal input to `walkTo`. */
export interface Point {
  file: number;
  rank: number;
}

/** One walked segment: where to, and how long the grind takes. */
export interface Leg extends Point {
  seconds: number;
}

// ── the beats ────────────────────────────────────────────────────────────────────────

/**
 * How far short of the victim's centre the attacker stops, in squares.
 *
 * A square is 2.35 m, so this is 2.02 m centre to centre — the attacker's base sits just
 * outside the victim's square with both plinths clear of each other, and the 12%-of-height
 * lunge in the strike closes most of what is left. Any nearer and the two bases
 * interpenetrate; any further and the blade lands in air.
 */
export const STANDOFF = 0.86;

/** Held beat between arriving and committing. The strike's own 0.58 s windup extends it. */
export const POISE = 0.16;

/**
 * Seconds from the start of the strike animation to weapon contact.
 *
 * This is `windup + swing` in pieces/motion.ts (0.58 + 0.24) — the moment its promise
 * resolves. It is NOT `STRIKE_CONTACT` from timeline.ts, which is 0.62 and is the film's
 * framing number: `piece-mid-strike` is captured at exactly t=0.62 and that timeline is
 * frozen. This constant is only ever used as a BACKSTOP for a lost promise; the shatter
 * itself is driven by the promise, so the two clocks cannot drift apart.
 */
export const CONTACT = 0.82;

/** Follow-through held after contact, before the attacker steps in. */
export const FOLLOW = 0.38;

/** Seconds of settling wobble `Motion` adds after any walk finishes. */
export const WALK_SETTLE = 0.55;

/** Pacing of the charge: seconds per square of real travel, and its floor and ceiling. */
const CHARGE_PER_UNIT = 0.36;
const CHARGE_MIN = 0.40;
const CHARGE_MAX = 1.55;

/** Pacing of the step onto the cleared square. */
const STEP_PER_UNIT = 0.34;
const STEP_MIN = 0.40;

/** A quiet move keeps the script's pacing exactly: heavy stone, per square crossed. */
const QUIET_PER_UNIT = 0.42;
const QUIET_MIN = 0.85;

/** Lateral bow, in squares, used to walk a knight's leg around an occupied square. */
const SKIRT = 0.62;

/** Travel shorter than this is not a move — it is a shuffle, and reads as a glitch. */
const NEGLIGIBLE = 0.15;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const dist = (a: Point, b: Point) => Math.hypot(b.file - a.file, b.rank - a.rank);

/** Seconds for an attacker to close `units` squares on its victim. */
export function chargeSeconds(units: number): number {
  return clamp(units * CHARGE_PER_UNIT, CHARGE_MIN, CHARGE_MAX);
}

/** Seconds for a quiet move of `units` squares — the script's own numbers. */
export function quietSeconds(units: number): number {
  return Math.max(QUIET_MIN, units * QUIET_PER_UNIT);
}

// ── the plan ─────────────────────────────────────────────────────────────────────────

export interface MovePlan {
  /** Walked before the blow. The whole move, for a quiet one. May be empty. */
  approach: Leg[];
  /** Walked after the follow-through: the step onto the cleared square. */
  finish: Leg[];
  /** Where the blow is delivered FROM, for the debris to fly away from. */
  station: Point;
  /** Seconds from the start of the move to the strike beginning. -1 when there is none. */
  strikeAt: number;
  /** Seconds from the start of the move to the attacker coming to rest (no settle). */
  duration: number;
}

export interface PlanRequest {
  from: Sq;
  to: Sq;
  /** Square the victim stands on, or null for a quiet move. Not always `to` — en passant. */
  capSq: Sq | null;
  /** Knights take their L; nothing else does. */
  knight: boolean;
  /** Does a carved man stand here? Attacker and victim excluded by the caller. */
  occupied(file: number, rank: number): boolean;
}

/** The point `STANDOFF` squares short of `target`, approached from `origin`. */
function standoffFrom(origin: Point, target: Point): Point {
  const df = target.file - origin.file;
  const dr = target.rank - origin.rank;
  const len = Math.hypot(df, dr);
  if (len < 1e-6) return { file: origin.file, rank: origin.rank };
  const travel = Math.max(0, len - STANDOFF);
  return {
    file: origin.file + (df / len) * travel,
    rank: origin.rank + (dr / len) * travel,
  };
}

/**
 * The waypoints a knight walks, in order, ending where it should stand.
 *
 * `capture` decides where that is: the elbow of the L for a capture (it is orthogonally
 * adjacent to the target, which is exactly the striking station), the target itself for a
 * quiet move.
 */
function knightRoute(req: PlanRequest, capture: boolean): Point[] {
  const { from, to, occupied } = req;
  const df = to.file - from.file;
  const dr = to.rank - from.rank;
  const sf = Math.sign(df);
  const sr = Math.sign(dr);
  const fileLong = Math.abs(df) === 2;

  // Elbow A — the long axis first. Always ends one square orthogonally from `to`.
  const a: Sq = fileLong
    ? { file: from.file + df, rank: from.rank }
    : { file: from.file, rank: from.rank + dr };
  // Elbow B — the short axis first. Ends two squares from `to` along the long axis.
  const b: Sq = fileLong
    ? { file: from.file, rank: from.rank + dr }
    : { file: from.file + df, rank: from.rank };

  const pts: Point[] = [];

  if (!occupied(a.file, a.rank) || occupied(b.file, b.rank)) {
    // Long leg first. It passes over one square; bow around anyone standing on it.
    const mid: Sq = fileLong
      ? { file: from.file + sf, rank: from.rank }
      : { file: from.file, rank: from.rank + sr };
    if (occupied(mid.file, mid.rank)) {
      pts.push(fileLong
        ? { file: mid.file, rank: mid.rank + sr * SKIRT }
        : { file: mid.file + sf * SKIRT, rank: mid.rank });
    }
    pts.push({ file: a.file, rank: a.rank });
    // The elbow is already adjacent, so a capture strikes from it and steps in afterwards.
    if (!capture) pts.push({ file: to.file, rank: to.rank });
    return pts;
  }

  // Short leg first, then the two-square run in. Same bow, on the other axis.
  pts.push({ file: b.file, rank: b.rank });
  const mid: Sq = fileLong
    ? { file: b.file + sf, rank: b.rank }
    : { file: b.file, rank: b.rank + sr };
  if (occupied(mid.file, mid.rank)) {
    pts.push(fileLong
      ? { file: mid.file, rank: mid.rank - sr * SKIRT }
      : { file: mid.file - sf * SKIRT, rank: mid.rank });
  }
  pts.push(capture ? standoffFrom(b, to) : { file: to.file, rank: to.rank });
  return pts;
}

/** Turn waypoints into timed legs, sharing `total` seconds out by segment length. */
function timeLegs(start: Point, pts: Point[], total: number): { legs: Leg[]; units: number } {
  const segs: number[] = [];
  let units = 0;
  let cur = start;
  for (const p of pts) {
    const d = dist(cur, p);
    segs.push(d);
    units += d;
    cur = p;
  }
  const legs: Leg[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (segs[i] < NEGLIGIBLE && pts.length > 1) continue;   // a shuffle, not a step
    const share = units > 1e-6 ? segs[i] / units : 1 / pts.length;
    legs.push({ file: pts[i].file, rank: pts[i].rank, seconds: Math.max(0.30, total * share) });
  }
  return { legs, units };
}

const secondsOf = (legs: Leg[]) => legs.reduce((s, l) => s + l.seconds, 0);

/**
 * Choreograph one move.
 *
 * Two passes, because the duration depends on the route and the route does not depend on
 * the duration: lay out the waypoints, measure them, then price them.
 */
export function planMove(req: PlanRequest): MovePlan {
  const { from, to, capSq, knight } = req;
  const start: Point = { file: from.file, rank: from.rank };

  // ── a quiet move: the whole thing is one walk, at the script's pacing ──
  if (!capSq) {
    const pts = knight ? knightRoute(req, false) : [{ file: to.file, rank: to.rank }];
    const measured = timeLegs(start, pts, 1);
    // Chebyshev for anything that slides, so a diagonal is priced exactly as the script
    // prices it; the knight is paid for the L it actually walks, which is longer.
    const squares = knight
      ? measured.units
      : Math.max(Math.abs(to.file - from.file), Math.abs(to.rank - from.rank));
    const total = quietSeconds(squares);
    const { legs } = timeLegs(start, pts, total);
    return { approach: legs, finish: [], station: start, strikeAt: -1, duration: secondsOf(legs) };
  }

  // ── a capture ──
  const victim: Point = { file: capSq.file, rank: capSq.rank };
  const pts = knight ? knightRoute(req, true) : [standoffFrom(start, victim)];
  const measured = timeLegs(start, pts, 1);

  let approach: Leg[];
  let station: Point;
  if (measured.units < NEGLIGIBLE) {
    // Already within reach — an adjacent king, an en-passant pawn. It strikes where it
    // stands, because that is what "arrive adjacent" already means for it.
    approach = [];
    station = start;
  } else {
    approach = timeLegs(start, pts, chargeSeconds(measured.units)).legs;
    station = approach.length
      ? { file: approach[approach.length - 1].file, rank: approach[approach.length - 1].rank }
      : start;
  }

  const stepUnits = dist(station, { file: to.file, rank: to.rank });
  const finish: Leg[] = stepUnits < NEGLIGIBLE
    ? []
    : [{ file: to.file, rank: to.rank, seconds: Math.max(STEP_MIN, stepUnits * STEP_PER_UNIT) }];

  const strikeAt = secondsOf(approach) + POISE;
  return {
    approach,
    finish,
    station,
    strikeAt,
    duration: strikeAt + CONTACT + FOLLOW + secondsOf(finish),
  };
}
