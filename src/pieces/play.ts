/**
 * PIECE: pieces — INTERACTIVE motion curves.
 *
 * Everything in here is used only when `world.capturing === false`. The film path in
 * motion.ts is byte-frozen: `piece-mid-strike` is captured at exactly t = STRIKE_CONTACT
 * and `king-surrender` has to keep returning the same md5, so not one number over there
 * may move. This file is where interactive play is allowed to differ.
 *
 * What it fixes, in the player's words: "the destruction and animation happens too soon"
 * and "make the animation smoother".
 *
 *   SMOOTHNESS.  The film walk has two genuine discontinuities. Its stick–slip term is
 *   `e - 0.85·sin(2πn·e + φ)/(2πn)`, and at e=0 that is `-0.85·sin(φ)/(2πn)` — up to 8 cm
 *   of instant offset the moment a walk begins, and the same again when it ends. Then the
 *   settle oscillator starts at `sin(φ)·0.016` rather than at zero, so the piece snaps a
 *   second time as it arrives. Here every oscillator is enveloped to zero at both ends and
 *   the velocity profile is built from smootherstep (zero first AND second derivative at
 *   the joins), so position is C2 and the piece eases out of rest and grinds into rest.
 *   The weight is kept: the shoves are still there, they just fade in and out.
 *
 *   SPEED.  A traverse is priced by DISTANCE at a fixed cruise, not by a clamped duration.
 *   `walkSeconds` below is the law; `Motion.walkTo` takes it as a floor on whatever the
 *   caller asked for, so a piece can be told to take longer but never to move faster than
 *   stone moves. Before this, a seven-square charge ran at 9.31 m/s mean and 19.93 m/s
 *   peak and was 43% quicker than a two-square one, because the only thing that grew with
 *   distance was the distance.
 *
 *   FACING.  A play walk turns to face where it is going as it breaks loose, and squares
 *   back up to its side's facing as it settles. A play strike turns fully onto its victim
 *   during the wind-up instead of the film path's 78% of the way.
 *
 *   THE STRIKE.  Anticipation (a slow load back onto the heel with a held beat at the top),
 *   the blow, a contact shock, then a follow-through that leaves the piece off-balance and
 *   rocking. The instant of contact is unchanged at 0.82 s after the strike begins — same
 *   as the film path — so `strike()`'s promise resolves at the same offset either way and
 *   the game piece can still hang the destruction on it.
 *
 * All of it is a pure function of the time handed in — no frame counting, no clocks.
 */

const TAU = Math.PI * 2;

/** Zero 1st AND 2nd derivative at both ends — accelerations join without a step. */
export function smoother(k: number): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  return k * k * k * (k * (k * 6 - 15) + 10);
}

export function clamp01(k: number): number {
  return k <= 0 ? 0 : k >= 1 ? 1 : k;
}

/** Shortest signed way round from angle `a` to angle `b`. */
export function turnDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// -----------------------------------------------------------------------------------------
// Travel velocity profile
// -----------------------------------------------------------------------------------------

/**
 * Trapezoidal speed with smootherstep shoulders: most of a third of the trip breaking
 * loose, most of a third grinding to a halt. Long ramps are what make it read as tons
 * rather than as a token; smootherstep is what makes the ACCELERATION continuous too, so
 * there is no instant at which the piece is yanked.
 *
 * Evaluated in closed form rather than from a table. The film path interpolates a
 * 128-entry LUT, which makes its acceleration a staircase — invisible there, but this file
 * exists because the player asked for smoother, and a piecewise-constant acceleration is
 * precisely the thing being asked about. ∫(6k⁵−15k⁴+10k³)dk = k⁶−3k⁵+2.5k⁴, so the
 * integral of the ramp is exact and cheap.
 */
const IN_A = 0.30;
const OUT_A = 0.28;
export const AREA = 1 - 0.5 * IN_A - 0.5 * OUT_A;
/** max |d(speed)/dp| — smoother'(k) = 30k²(1−k)² peaks at 1.875. */
const ACC_PEAK = 1.875 / Math.min(IN_A, OUT_A);

/** ∫₀ᵏ smoother. F(1) = 0.5. */
function rampArea(k: number): number {
  return k * k * k * k * (k * (k - 3) + 2.5);
}

/** Fraction of the journey covered at normalised time p. Exactly C2 in p. */
export function playEase(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let s: number;
  if (p < IN_A) s = IN_A * rampArea(p / IN_A);
  else if (p <= 1 - OUT_A) s = 0.5 * IN_A + (p - IN_A);
  else s = 0.5 * IN_A + (1 - OUT_A - IN_A) + OUT_A * (0.5 - rampArea((1 - p) / OUT_A));
  return s / AREA;
}

/** Normalised acceleration at p: +1 is the hardest shove-off, −1 the hardest braking. */
export function playAccel(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < IN_A) {
    const k = p / IN_A;
    return (30 * k * k * (1 - k) * (1 - k)) / IN_A / ACC_PEAK;
  }
  if (p <= 1 - OUT_A) return 0;
  const k = (1 - p) / OUT_A;
  return (-30 * k * k * (1 - k) * (1 - k)) / OUT_A / ACC_PEAK;
}

// -----------------------------------------------------------------------------------------
// How long a traverse takes — the speed law
// -----------------------------------------------------------------------------------------

/**
 * CRUISE SPEED, metres per second, and it is the whole point of this section.
 *
 * A duration handed to `walkTo` prices a move in SECONDS, and a caller that clamps that
 * price makes a long move FASTER: at a ceiling of 1.55 s, a rook crossing 14.43 m averaged
 * 9.31 m/s and peaked at 19.93 — 72 km/h for a four-tonne block of stone, and 43% quicker
 * than the same rook covering two squares. Speed cannot be a function of how far there is
 * to go. So the piece sets its own pace and the DURATION follows the distance:
 *
 *     duration = distance / cruise        (never shorter than the caller asked for)
 *
 * 2.50 m/s is a shade over one square a second. A 3.07 m rook covers its own height in
 * 1.23 s; a 1.8 m person walking at 1.4 m/s covers theirs in 1.29 s. So this is a walking
 * pace in body-lengths for a body this size — which is what a Froude-scaled walk of
 * something three metres tall and made of granite actually is.
 *
 * CRUISE_LONG is what it drops to once the traverse is long enough to be work. A long
 * haul should look HEAVIER, not lighter, so speed sags 12% across the board rather than
 * rising: nothing on the board ever moves faster than the one-square cruise.
 */
export const CRUISE = 2.50;
export const CRUISE_LONG = 2.20;
/** Metres of traverse at which the load is fully felt. Roughly five squares. */
const LONG_TRAVEL = 12.0;

/**
 * Ceiling on a single traverse, for playability alone — the one thing here that is not
 * physics. It binds only on the very longest walk in chess, a queen or bishop running the
 * whole a1–h8 diagonal (23.26 m), and it is set high enough that even there the piece is
 * doing 2.47 m/s: still under CRUISE, so the ceiling can never make a long move quicker
 * than a short one. Every other move on the board is uncapped.
 */
const MAX_TRAVEL = 9.4;

/** Seconds a carved man takes to cover `metres` on its own two feet. Monotonic in metres. */
export function walkSeconds(metres: number): number {
  if (!(metres > 0)) return 0;
  const cruise = CRUISE + (CRUISE_LONG - CRUISE) * smoother(clamp01(metres / LONG_TRAVEL));
  return Math.min(MAX_TRAVEL, metres / cruise);
}

// -----------------------------------------------------------------------------------------
// Walk
// -----------------------------------------------------------------------------------------

/**
 * Depth of the stick–slip: the fraction by which a shove modulates the travel speed.
 *
 * Because the modulation multiplies the speed rather than being added to the position,
 * forward velocity is `speed × (1 − GRIND·cos φ)` — never negative for GRIND < 1, and
 * exactly zero whenever the piece is standing still. The film path uses 0.85, a 12.3×
 * peak-to-trough lurch.
 *
 * 0.52 was still a 3.17× swing, and at the speeds a clamped charge used to run at, one
 * shove cycle was FOUR FRAMES at 60 fps — the ripple stopped reading as weight and started
 * reading as a strobe. Most of that is fixed by the cruise law above, which makes the shove
 * rate a constant ~4 Hz instead of 14.8; 0.28 does the rest. The swing is 1.78× now, which
 * is a body shoving itself along, and it lasts sixteen frames instead of four.
 */
const GRIND = 0.28;

export interface PlayWalkSpec {
  fx: number; fz: number; tx: number; tz: number;
  /** Travel time, then the settle that follows arrival. */
  dur: number; settle: number;
  /** Number of stick–slip shoves over the whole trip. Must be a whole number. */
  shoves: number;
  /** Half-width of the plinth — how far it can rock onto an edge. */
  baseHalf: number;
  /** Facing at the moment the walk was ordered, the travel heading, and the rest facing. */
  yaw0: number; yawTravel: number; yawRest: number;
  /** Seconds to complete the turn onto the travel heading / back to rest. */
  turnIn: number; turnOut: number;
  ph: number[];
}

export interface PlayPose {
  x: number; y: number; z: number;
  face: number; pitch: number; roll: number;
  /** Half-cycles of the shove oscillator completed — a base edge lands on each. */
  step: number;
}

/** Where the walking piece is at local time `tt`. Defined for tt in [0, dur + settle]. */
export function playWalk(a: PlayWalkSpec, tt: number, out: PlayPose): PlayPose {
  const dx = a.tx - a.fx;
  const dz = a.tz - a.fz;

  if (tt < a.dur) {
    const p = clamp01(tt / a.dur);
    const e = playEase(p);
    const acc = playAccel(p);
    // The shove phase is locked to DISTANCE COVERED and carries no offset, so sin φ is
    // exactly zero at both ends of the trip (shoves is a whole number) and the piece
    // starts and finishes precisely on its squares. This is where the film walk goes
    // wrong: its `−0.85·sin(2πn·e + φ)/(2πn)` is up to 8 cm of instant offset at e=0 and
    // another at e=1, so the piece jumps as it sets off and jumps again as it lands.
    const phase = TAU * a.shoves * e;
    const slip = e - (GRIND * Math.sin(phase)) / (TAU * a.shoves);

    out.x = a.fx + dx * slip;
    out.z = a.fz + dz * slip;
    // Rocking onto alternating base edges. Every term below is built from sin φ, |sin φ|
    // or (1 − cos φ), all of which vanish at both ends of the walk on their own — no
    // envelope, and therefore no envelope of their own to be discontinuous.
    const wob = 0.80 + a.ph[0] * 0.06;
    out.y = Math.abs(Math.sin(phase)) * a.baseHalf * 0.030 * wob;
    out.roll = Math.sin(phase) * 0.030 * wob;
    // …plus the whole mass leaning into its own acceleration and rocking back as it brakes.
    out.pitch = (1 - Math.cos(phase)) * -0.008 * wob + acc * 0.052;
    out.face = a.yaw0 + turnDelta(a.yaw0, a.yawTravel) * smoother(clamp01(tt / a.turnIn));
    out.step = Math.floor(phase / Math.PI);
    return out;
  }

  // Arrived. The mass keeps going for a moment; because it braked to a stop rather than
  // hitting a wall, this is a short heavy nod, not a bounce. sin(0) = 0 at both frequencies
  // so it joins the walk without a step in position.
  const s = tt - a.dur;
  const decay = Math.exp(-s * 5.2);
  const w1 = TAU * (2.35 + a.ph[1] * 0.05);
  const w2 = TAU * (3.10 + a.ph[2] * 0.05);
  out.x = a.tx;
  out.z = a.tz;
  out.y = 0;
  out.pitch = -0.021 * Math.sin(s * w1) * decay;
  out.roll = 0.012 * Math.sin(s * w2) * decay;
  out.face = a.yawTravel + turnDelta(a.yawTravel, a.yawRest) * smoother(clamp01(s / a.turnOut));
  out.step = -1;
  return out;
}

// -----------------------------------------------------------------------------------------
// Strike
// -----------------------------------------------------------------------------------------

/**
 * Wind-up, blow, contact, follow-through.
 *
 * WINDUP + SWING IS EXACTLY 0.82, the same total the film path uses, and therefore
 * `strike()` resolves at the same offset whichever path is running. That is deliberate:
 * the game piece hangs the shatter on the promise and carries 0.82 as a written-down
 * backstop, so the two must not disagree by so much as a frame. What changed is the SHAPE
 * inside the 0.82 — most of it is anticipation now, and the blow itself is faster and
 * still accelerating when the blade lands.
 *
 * (0.62 is a different number, STRIKE_CONTACT in game/timeline.ts. That is the film's
 * FRAMING — `piece-mid-strike` is captured at exactly t=0.62 — not the motion's contact.)
 */
export const PLAY_WINDUP = 0.60;
export const PLAY_SWING = 0.22;
export const PLAY_HOLD = 0.18;
export const PLAY_RECOVER = 1.05;
export const PLAY_CONTACT = PLAY_WINDUP + PLAY_SWING;
export const PLAY_STRIKE_TOTAL = PLAY_CONTACT + PLAY_HOLD + PLAY_RECOVER;

/** How far back the blow drives the victim's own reaction, and how early it begins. */
export const PLAY_BRACE = 0.17;

/** Fraction of the lunge the impact takes back off the attacker — the blade is stopped. */
const CHECKED = 0.06;

export interface PlayStrikeSpec {
  yaw0: number; yawTarget: number; turnIn: number;
  lean: number; lunge: number;
  armSwing: number;
  ph: number[];
}

export interface PlayStrikePose {
  /** Displacement along the attack direction, metres. Positive is toward the victim. */
  push: number;
  face: number; pitch: number; roll: number;
  arm: number;
}

export function playStrike(a: PlayStrikeSpec, tt: number, out: PlayStrikePose): PlayStrikePose {
  const load = a.armSwing * 1.12;
  out.face = a.yaw0 + turnDelta(a.yaw0, a.yawTarget) * smoother(clamp01(tt / a.turnIn));

  if (tt < PLAY_WINDUP) {
    // ANTICIPATION. Weight goes back onto the heel and the blade is drawn past the
    // shoulder, and it is fully loaded a beat BEFORE the release — that held beat at the
    // top is what makes the blow read as a decision rather than a twitch.
    const k = smoother(clamp01(tt / (PLAY_WINDUP * 0.86)));
    out.pitch = -0.175 * k;
    out.push = -0.090 * k;
    out.roll = 0.022 * k;
    out.arm = -load * k;
    return out;
  }

  if (tt < PLAY_CONTACT) {
    // THE BLOW. Starts from rest (p^1.9 has zero slope at 0, so it joins the held load
    // cleanly) and is still accelerating when the blade arrives.
    const p = (tt - PLAY_WINDUP) / PLAY_SWING;
    const k = Math.pow(p, 1.9);
    out.pitch = -0.175 + (a.lean + 0.175) * k;
    out.push = -0.090 + (a.lunge + 0.090) * k;
    out.roll = 0.022 - 0.032 * k;
    out.arm = -load + (load + 1.22) * k;
    return out;
  }

  const after = tt - PLAY_CONTACT;
  if (after < PLAY_HOLD) {
    // CONTACT. The blade stops in stone. sin(0)=0, so the shock starts from exactly the
    // pose the blow ended in and then rings out.
    const u = after / PLAY_HOLD;
    const jolt = Math.exp(-after * 22) * Math.sin(after * TAU * 11);
    out.pitch = a.lean - 0.045 * smoother(u) + jolt * 0.030;
    out.push = a.lunge * (1 - CHECKED * smoother(u)) + jolt * a.lunge * 0.04;
    out.roll = -0.010 + jolt * 0.014;
    out.arm = 1.22 + 0.05 * smoother(u);
    return out;
  }

  // FOLLOW-THROUGH. It does not walk back upright; it is off balance and has to catch
  // itself, so the return overshoots once and rocks out. Facing is deliberately NOT
  // restored here — after a capture the next thing this piece does is step onto the
  // square it just cleared, which is the way it is already looking.
  const q = clamp01((after - PLAY_HOLD) / PLAY_RECOVER);
  const k = smoother(q);
  const wob = Math.exp(-q * 4.5) * Math.sin(q * TAU * 1.6);
  out.pitch = (a.lean - 0.045) * (1 - k) - 0.055 * wob;
  // Starts from where the hold left it — a.lunge×(1−CHECKED), not a.lunge — or the piece
  // hops forward 2 cm on the frame the follow-through begins.
  out.push = a.lunge * (1 - CHECKED) * (1 - k) - a.lunge * 0.18 * wob;
  out.roll = -0.010 * (1 - k) + 0.022 * wob;
  out.arm = 1.27 * (1 - k);
  return out;
}

// -----------------------------------------------------------------------------------------
// The victim
// -----------------------------------------------------------------------------------------

export interface PlayReactPose {
  /**
   * Metres shoved along the blow direction (attacker -> victim, i.e. AWAY from the
   * attacker) and radians of lean the same way. Both positive means recoiling.
   */
  shove: number;
  lean: number;
  tremor: number;
}

/**
 * What the target does about it. `tt` is measured FROM the instant of contact, so it is
 * negative while the blade is still coming in.
 *
 * The victim is normally shattered on the contact frame, which means the part of this that
 * actually gets screen time is the brace — the two or three frames where the target sees
 * it coming and pulls away. That is the point: something that registers the blow before it
 * comes apart reads as alive, and something that stands perfectly still until it explodes
 * reads as a prop.
 */
export function playReact(tt: number, out: PlayReactPose): PlayReactPose {
  if (tt < 0) {
    // Bracing: it pulls fractionally away from the blade and shivers.
    const b = smoother(clamp01((tt + PLAY_BRACE) / PLAY_BRACE));
    out.lean = 0.050 * b;
    out.shove = 0.018 * b;
    out.tremor = b * 0.0024;
    return out;
  }
  // Struck: whipped away from the blow, fast, then hauled back if it somehow survives.
  const k = 1 - Math.exp(-tt * 26);
  const decay = Math.exp(-tt * 3.4);
  out.lean = 0.050 * decay + 0.130 * k * decay;
  out.shove = 0.018 * decay + 0.090 * k * decay;
  out.tremor = 0.0024 * decay + Math.exp(-tt * 12) * Math.sin(tt * TAU * 14) * 0.010;
  return out;
}
