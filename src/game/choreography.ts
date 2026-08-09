import { SQUARE } from '../core/constants';
import { walkSeconds } from '../pieces';

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
 * ── the one square that would not walk ────────────────────────────────────────────────
 *
 * That trick had a hole in it, and it was the SHORTEST capture in chess. A station placed
 * radially — on the straight line from the attacker to its victim — leaves the attacker
 * exactly `len - STANDOFF` squares of ground to cover, and for an orthogonally adjacent
 * capture that is 1.00 - 0.86 = 0.14 squares. Thirty-three centimetres. It fell under
 * `NEGLIGIBLE`, the approach was dropped entirely, and a rook took the man beside it
 * without moving: measured at 2.222 m of gap at the swing and the identical 2.222 m when
 * the victim shattered. Rook-takes-rook and queen-takes-pawn on an adjacent square are not
 * rare, and this was the player's original complaint in its purest form.
 *
 * It cannot be fixed by lowering `NEGLIGIBLE`, because 0.14 squares really IS a shuffle.
 * It cannot be fixed by shrinking `STANDOFF` either, and the reason is measured rather
 * than asserted: every piece's plinth is a hexagon of circumradius 1.05-1.11 m in world
 * units (the widest course of `plinth()` in pieces/forms.ts, scaled onto PIECE_HEIGHT), so
 * two men standing together need about 2.2 m centre to centre before their bases stop
 * overlapping. `STANDOFF` is 2.02 m and is already the tightest that reads. On a
 * one-square capture the victim's centre is 2.35 m away. There is no radial room. Any
 * approach worth watching has to come from somewhere other than the straight line.
 *
 * So the station is no longer defined as a point ON that line. It is defined as
 *
 *     the point at distance STANDOFF from the victim that the attacker can reach by
 *     walking at least MIN_APPROACH, on the bearing closest to the straight line.
 *
 * For anything two squares or further the answer is the straight line, unchanged, because
 * the straight line already pays MIN_APPROACH. For a one-square capture the station swings
 * 43° off it, still 2.02 m from the victim and still on the near side of it, and the
 * attacker walks 1.65 m to get there — five times what it walked before, on a real bearing,
 * with a real turn. The distance to the victim genuinely closes while it does it: 2.35 m
 * at the start of the walk, 2.02 m at the end of it, and never more than 2.35 m in between.
 * `standoffStation` below is that search, and it is the only place a station comes from.
 *
 * ── the knight ───────────────────────────────────────────────────────────────────────
 *
 * A knight is the one man whose move is not a straight line, and gliding it diagonally
 * puts it through whatever stands on the square between. It walks its L instead: two
 * squares along the long axis, which lands it orthogonally ADJACENT to its target — and
 * from that elbow it walks the same closing run every other capture walks, so it swings
 * from the same distance a rook does rather than from a full square out. The second leg of
 * the L is then the step onto the cleared square. If a man stands on that elbow the L is
 * taken the other way round, and if one stands on a square the leg passes over, the leg
 * bows around him.
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
 *
 * Measured, so the claim is checkable: `plinth()` in pieces/forms.ts is a hexagon whose
 * widest course has circumradius 0.80-1.36 authored metres, and the factory scales each
 * form by PIECE_HEIGHT / carved height. In world units that lands at 1.091 (pawn), 1.109
 * (knight), 1.097 (bishop), 1.110 (rook), 1.050 (queen), 1.106 (king). Two of the widest
 * touch at 2.22 m corner to corner and 1.92 m flat to flat; 2.02 m sits between them,
 * which is why it is the floor and not a preference.
 */
export const STANDOFF = 0.86;

/**
 * Squares an attacker must WALK before it is allowed to swing. Never scaled, never skipped.
 *
 * 0.70 squares is 1.65 m — over half a piece's height, a second of grinding stone at the
 * charge pacing below, and unmistakably a piece leaving its square rather than shuffling on
 * it. Every capture in the game pays it, including the one-square capture that used to pay
 * 0.14; see `standoffStation` for how it is paid when the straight line cannot pay it.
 */
export const MIN_APPROACH = 0.70;

/**
 * The gap the station may close to when the board is too crowded to swing wide.
 *
 * The bearing search prefers to keep the full `STANDOFF` and buy its approach with angle.
 * When every angle is blocked — a bystander standing where the attacker would have to
 * stand, or the edge of the board — it buys the approach radially instead and accepts a
 * tighter gap. 0.66 squares is 1.55 m: the plinth DIES (0.842 of the widest course, so
 * ~0.93 m) still clear each other, and only the bottom step, a 5 cm chamfer at floor
 * level, overlaps. It is the worse-looking answer and it is why it is the last one tried.
 */
const STANDOFF_MIN = 0.66;

/**
 * Squares of clearance a station needs from any OTHER man standing nearby.
 *
 * 0.92 squares is 2.16 m, just inside the 2.22 m at which two of the widest plinths touch
 * corner to corner. A station closer than this to a bystander is rejected outright — the
 * victim is about to stop existing and can be crowded, a bystander cannot.
 */
const STATION_CLEAR = 0.92;

/**
 * The crowded board's answer. Bases graze at 1.65 m; nothing else on the board does.
 *
 * Tried only after every station with real clearance has been rejected, and still
 * preferred over a capture that does not walk — a moment of two plinths touching is a
 * smaller lie than a rook killing the man beside it without leaving its square.
 */
const STATION_CLEAR_SOFT = 0.70;

/**
 * How far off the marble a station may sit, in squares.
 *
 * The marble field ends 9.40 m from the board centre (board/layout.ts `R.field`), so a
 * plinth of radius 1.11 m keeps all of itself on the marble only while its centre is inside
 * 8.29 m — 3.528 squares from the centre line, 0.028 of a square past the middle of the
 * outer rank. A man on a1 is therefore ALREADY at the edge, and a station may not step off
 * it: past this the piece stands over the sunk border inlay with a gap under its rim.
 */
const BOARD_LO = -0.028;
const BOARD_HI = 7.028;

/**
 * The shortest walk that still reads as a step rather than a twitch, in squares.
 *
 * 0.34 squares is 0.80 m. A bearing that buys less than this is not worth the station it
 * costs, so the search moves on to the next kind of candidate instead of taking it.
 */
const WALK_FLOOR = 0.34;

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

/**
 * A WAYPOINT this close to the one before it is not a step — it is a shuffle, and reads as
 * a glitch, so `timeLegs` drops it out of a multi-point route.
 *
 * It used to do a second job as well, and that job was the bug: `planMove` asked whether
 * the whole APPROACH was under `NEGLIGIBLE` and threw it away if it was, which is how the
 * one-square capture ended up striking from its own square. Nothing decides whether a
 * capture walks any more — `MIN_APPROACH` guarantees that it does, and the guarantee is
 * geometric rather than conditional. This constant is back to pruning degenerate waypoints
 * inside a knight's L, which is all it was ever good for.
 */
const NEGLIGIBLE = 0.15;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const dist = (a: Point, b: Point) => Math.hypot(b.file - a.file, b.rank - a.rank);

/**
 * The floor every price in this file has to respect: what the ANIMATION will actually take.
 *
 * ── two duration laws for one walk ───────────────────────────────────────────────────
 *
 * This file priced a walk in seconds per SQUARE and clamped the result; `Motion` prices the
 * same walk in metres per SECOND and treats the seconds it is handed as a floor, taking
 * `walkSeconds(metres)` whenever that is longer. Both are reasonable and they disagree, and
 * because nothing connected them the scheduler was laying out a timeline the piece was not
 * on. Every beat after the first leg — the next leg's start, the poise, the strike, the
 * shatter, the step onto the cleared square, the promotion swap, and the window that tells
 * the renderer something is moving — fired against a clock the stone was not keeping.
 *
 * The clamp is what makes it bite rather than merely differ. `CHARGE_MAX` caps an approach
 * at 1.55 s, so a longer charge does not take longer, it goes FASTER — and past the cap the
 * two laws diverge without limit. Motion refuses to sprint, so the piece simply arrives
 * late, and the strike has already been ordered: `Motion.strike` then takes its documented
 * safety-valve branch and compresses the whole unwalked remainder underneath the wind-up,
 * which is a hard velocity step in the middle of the approach. That step is the thing a
 * player sees, and it is entirely frame-rate independent — it is identical at 60 fps and at
 * 144, which is why it reads as "the animation is not smooth" on hardware that is fast.
 *
 * `src/pieces/index.ts` says this in as many words where it re-exports `walkSeconds`:
 * anything scheduling a beat against a walk wants to price it with the same function. This
 * is that. The per-square laws below are kept as a STYLE — they set the pacing of a short
 * move, where they are the larger number — and the floor only binds once a walk is long
 * enough that the stone's own speed limit takes over.
 */
const animated = (units: number) => walkSeconds(units * SQUARE);

/** Seconds for an attacker to close `units` squares on its victim. */
export function chargeSeconds(units: number): number {
  return Math.max(clamp(units * CHARGE_PER_UNIT, CHARGE_MIN, CHARGE_MAX), animated(units));
}

/** Seconds for a quiet move of `units` squares — the script's own numbers. */
export function quietSeconds(units: number): number {
  return Math.max(QUIET_MIN, units * QUIET_PER_UNIT, animated(units));
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

/** Is a fractional board point somewhere a plinth can actually stand? */
function onBoard(p: Point): boolean {
  return p.file >= BOARD_LO && p.file <= BOARD_HI
      && p.rank >= BOARD_LO && p.rank <= BOARD_HI;
}

/** Distance in squares from `p` to the nearest OTHER man. Infinity if the ground is open. */
function clearance(p: Point, occupied: PlanRequest['occupied']): number {
  let best = Infinity;
  const f0 = Math.round(p.file);
  const r0 = Math.round(p.rank);
  for (let f = f0 - 1; f <= f0 + 1; f++) {
    if (f < 0 || f > 7) continue;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      if (r < 0 || r > 7) continue;
      if (!occupied(f, r)) continue;
      const d = Math.hypot(p.file - f, p.rank - r);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Where the blow is delivered from: `gap` squares out from `target`, on a bearing `theta`
 * off the straight line back to `origin`.
 */
function stationAt(origin: Point, target: Point, gap: number, theta: number): Point {
  const ux = (origin.file - target.file);
  const uy = (origin.rank - target.rank);
  const len = Math.hypot(ux, uy) || 1;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const nx = ux / len;
  const ny = uy / len;
  return {
    file: target.file + (nx * c - ny * s) * gap,
    rank: target.rank + (nx * s + ny * c) * gap,
  };
}

/**
 * The striking station: a point `STANDOFF` from the victim that costs a real walk to reach.
 *
 * Candidates, all of them exactly `gap` from the victim so the blow always lands from a
 * distance the strike animation can actually reach:
 *
 *   1. the straight line, `STANDOFF` out. What every capture of two squares or more uses,
 *      and what this function returned exclusively before.
 *   2. the same `STANDOFF`, swung off that line by an angle. The angle that buys exactly
 *      `MIN_APPROACH` of walk comes straight out of the law of cosines on the triangle
 *      origin-victim-station, and the sweep steps back down from it toward the line so a
 *      blocked bearing degrades instead of failing.
 *   3. the straight line again, but closing the gap toward `STANDOFF_MIN`. Only reached
 *      when the board is too crowded for any bearing, and the plinths pay for it.
 *
 * Every candidate is checked for board bounds and for a bystander's plinth, and they are
 * tried in order of how much walking they buy, so the attacker always gets the longest
 * approach the position allows. The straight `STANDOFF` line is the guaranteed fallback:
 * for anything that slides it is clear by the legality of the move itself.
 */
function standoffStation(origin: Point, target: Point, occupied: PlanRequest['occupied']): Point {
  const len = dist(origin, target);
  if (len < 1e-6) return { file: origin.file, rank: origin.rank };

  const straight = stationAt(origin, target, Math.min(STANDOFF, len), 0);
  if (len - STANDOFF >= MIN_APPROACH) return straight;

  // 2. Swing off the line, keeping the full standoff. cos(theta) is the law of cosines on
  //    the triangle whose sides are `len`, the standoff, and the walk we want to buy.
  //    Widest bearing first, so the attacker gets the longest approach the position allows.
  const gap = Math.min(STANDOFF, len);
  const cosNeed = (len * len + gap * gap - MIN_APPROACH * MIN_APPROACH) / (2 * len * gap);
  const need = Math.acos(clamp(cosNeed, -1, 1));
  const STEPS = 12;

  const swung = (floor: number, clear: number): Point | null => {
    for (let i = 0; i < STEPS; i++) {
      const theta = need * (1 - i / STEPS);
      // Left and right of the line are the same walk, so take whichever has more room.
      const sides = [stationAt(origin, target, gap, theta), stationAt(origin, target, gap, -theta)]
        .sort((a, b) => clearance(b, occupied) - clearance(a, occupied));
      for (const p of sides) {
        if (dist(origin, p) < floor) continue;
        if (onBoard(p) && clearance(p, occupied) >= clear) return p;
      }
    }
    return null;
  };

  // 3. Or close the gap radially, which is uglier and therefore tried second.
  const closed = (floor: number, clear: number): Point | null => {
    for (let g = STANDOFF - 0.02; g >= STANDOFF_MIN - 1e-6; g -= 0.02) {
      const p = stationAt(origin, target, Math.min(g, len), 0);
      if (dist(origin, p) < floor) continue;
      if (onBoard(p) && clearance(p, occupied) >= clear) return p;
    }
    return null;
  };

  return swung(WALK_FLOOR, STATION_CLEAR)
    ?? closed(WALK_FLOOR, STATION_CLEAR)
    // A board crowded enough to block all of those gets a station that grazes a
    // bystander's base rather than a capture that does not move.
    ?? swung(WALK_FLOOR, STATION_CLEAR_SOFT)
    ?? closed(WALK_FLOOR, STATION_CLEAR_SOFT)
    ?? swung(NEGLIGIBLE, STATION_CLEAR_SOFT)
    ?? straight;
}

/**
 * The waypoints a knight walks, in order, ending where it should stand.
 *
 * `capture` decides where that is: for a capture, the striking station reached from the
 * elbow of the L — the elbow is orthogonally adjacent to the target, so `standoffStation`
 * has exactly the one-square problem it was written for. For a quiet move, the target.
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
    // The elbow is orthogonally adjacent, so the last thing a capture walks is the same
    // closing run every other capture walks — from the elbow, not from the start square.
    // Without it the knight swung from a full square out, 2.35 m, further than any other
    // man in the game strikes from.
    pts.push(capture
      ? standoffStation({ file: a.file, rank: a.rank }, to, occupied)
      : { file: to.file, rank: to.rank });
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
  pts.push(capture ? standoffStation(b, to, occupied) : { file: to.file, rank: to.rank });
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
    // A shuffle in the MIDDLE of a route is not a step and is dropped. The LAST waypoint
    // never is: it is where the route ends, and dropping it silently moved a capture's
    // striking station back onto the previous waypoint — which is how a knight ended up
    // swinging from a full square out.
    if (segs[i] < NEGLIGIBLE && i < pts.length - 1) continue;
    const share = units > 1e-6 ? segs[i] / units : 1 / pts.length;
    // Each leg is floored on its OWN length as well as on its share of the route's price.
    // Sharing a total that is already correct is not enough: a route whose legs are very
    // uneven — a knight's L, an approach that swings wide — gives a long leg a share that
    // is shorter than the stone can cross it in, and that leg then overruns the next beat
    // on its own. See `animated`.
    legs.push({
      file: pts[i].file,
      rank: pts[i].rank,
      seconds: Math.max(0.30, total * share, animated(segs[i])),
    });
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
  //
  // There is no "already close enough to strike where it stands" branch any more, and its
  // absence is the fix: it fired for every orthogonally adjacent capture in the game and
  // it is what made a rook kill the man beside it without moving. `standoffStation`
  // guarantees a station at least MIN_APPROACH away, so the approach is never empty and
  // the station is never the attacker's own square.
  const victim: Point = { file: capSq.file, rank: capSq.rank };
  const pts = knight
    ? knightRoute(req, true)
    : [standoffStation(start, victim, req.occupied)];
  const measured = timeLegs(start, pts, 1);

  const approach = timeLegs(start, pts, chargeSeconds(measured.units)).legs;
  const station: Point = approach.length
    ? { file: approach[approach.length - 1].file, rank: approach[approach.length - 1].rank }
    : start;

  const stepUnits = dist(station, { file: to.file, rank: to.rank });
  const finish: Leg[] = stepUnits < NEGLIGIBLE
    ? []
    : [{
      file: to.file,
      rank: to.rank,
      seconds: Math.max(STEP_MIN, stepUnits * STEP_PER_UNIT, animated(stepUnits)),
    }];

  const strikeAt = secondsOf(approach) + POISE;
  return {
    approach,
    finish,
    station,
    strikeAt,
    duration: strikeAt + CONTACT + FOLLOW + secondsOf(finish),
  };
}
