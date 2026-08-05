/**
 * PIECE: camera — the person holding it.
 *
 * Everything here exists to answer one question: what is the difference between a camera
 * and an operator? Three things, and all three are in the reference frames.
 *
 *  1. INERTIA. A body cannot move a 20kg rig instantly. So the noise below is never used
 *     directly — it is a *target* fed to a second-order spring, which lags it, rounds off
 *     the corners and overshoots slightly on the way back. That filter is the difference
 *     between "wobble" and "weight".
 *
 *  2. CORRECTION. An operator does not hold a frame, they keep re-finding it. Slow error
 *     accumulates, they notice, they push back. Modelled as a leaky integrator subtracted
 *     from the target: fast content passes through untouched, slow drift gets pulled out
 *     a couple of seconds after it appears. The result wanders and returns without ever
 *     repeating a path.
 *
 *  3. FLINCH. When a blade lands, the response is not a symmetric wobble — it is a whip
 *     one way and a slower settle back, with the settle *overshooting* because the
 *     operator corrects the correction. Two springs, tuned an octave and a half apart and
 *     kicked in opposite directions, do exactly that.
 *
 * The rig also translates, not only rotates. That matters more than it sounds: pure
 * rotation slides the whole image as one plate, which is what a shake shader does and why
 * it reads as fake. A few millimetres of lateral sway with the aim held on the subject
 * produces parallax — the background moves against the foreground — and parallax is the
 * thing an audience reads as "a person is there".
 *
 * Determinism: all noise comes from a fork of `world.rng`, all integration from
 * `world.time`/`dt`. No clocks anywhere.
 */
import { makeNoiseField, type Fbm1 } from './noise';

/** A critically-ish damped second-order tracker. */
interface Spring {
  x: number;
  v: number;
}

const spring = (): Spring => ({ x: 0, v: 0 });

/**
 * Semi-implicit Euler, substepped so the response is identical whether the frame is a
 * capture's fixed 1/60 or an interactive 1/30. Velocity integrates first, so an impulse
 * delivered this frame is already visible in this frame's position — which is what makes
 * the strike frame itself land slightly off-composed rather than a frame late.
 */
function stepSpring(s: Spring, target: number, omega: number, zeta: number, dt: number) {
  const steps = Math.max(1, Math.ceil((dt * omega) / 0.22));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-2 * zeta * omega * s.v - omega * omega * (s.x - target)) * h;
    s.x += s.v * h;
  }
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** What the operator hands back to the rig each frame. */
export interface OperatorPose {
  /** Extra aim, radians, applied after the shot's own look-at. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Eye offset in camera basis, metres: right, up, forward. */
  dx: number;
  dy: number;
  dz: number;
  /** Multiplier on the shot's focus distance — breathing plus the puller chasing a hit. */
  focusScale: number;
  /** Multiplier on the shot's fov. Anamorphic lenses breathe when they refocus. */
  fovScale: number;
}

export interface Operator {
  update(t: number, dt: number, fovDeg: number): OperatorPose;
  kick(amount: number): void;
}

export function createOperator(seed: number): Operator {
  const field = makeNoiseField(seed);

  // --- the body -------------------------------------------------------------------------
  // Rates chosen off each other's harmonics so nothing beats into a cycle.
  const nYaw: Fbm1 = field.channel(0.29, 3);
  const nPitch: Fbm1 = field.channel(0.23, 3);
  const nRoll: Fbm1 = field.channel(0.17, 2);
  const nSwayX: Fbm1 = field.channel(0.21, 2);
  const nSwayY: Fbm1 = field.channel(0.27, 2);
  const nSwayZ: Fbm1 = field.channel(0.13, 2);
  // Grip tremor: fast, small, and deliberately NOT put through the rig filter, because a
  // filtered tremor disappears entirely and a clean image is the tell we are avoiding.
  const nTremX: Fbm1 = field.channel(6.9, 2, 0.6);
  const nTremY: Fbm1 = field.channel(8.3, 2, 0.6);
  const nFocus: Fbm1 = field.channel(0.19, 2);

  // Amplitudes at the reference 40° vertical fov. Degrees / metres. At 804 lines that is
  // 20 pixels per degree, so the drift below wanders the frame about ±7 pixels and moves
  // at most a pixel and a third per frame — present in every frame of a filmstrip, never
  // enough to argue with the framing in `shots.ts`.
  const A = {
    yaw: 0.55,
    pitch: 0.42,
    roll: 0.34,
    tremor: 0.075,
    swayX: 0.020,
    swayY: 0.015,
    swayZ: 0.012,
  };

  // The rig: 2.4 Hz, slightly under critically damped. Anything faster and it stops
  // having mass; anything slower and the camera feels like it is underwater.
  const RIG_W = TAU * 2.4;
  const RIG_Z = 0.68;
  const sYaw = spring();
  const sPitch = spring();
  const sRoll = spring();
  const sSwayX = spring();
  const sSwayY = spring();
  const sSwayZ = spring();

  // Slow-error integrators — the "keep re-finding the frame" behaviour.
  const CORRECT_TAU = 2.6;
  const CORRECT_AMOUNT = 0.72;
  let lpYaw = 0;
  let lpPitch = 0;
  let lpRoll = 0;

  // --- the flinch -----------------------------------------------------------------------
  // Whip: fast and only lightly damped. At the game's own shake(0.85) it throws the frame
  // 15 pixels in the first frame, peaks near 20 at 33ms, and is spent inside half a second.
  const WHIP_W = TAU * 5.5;
  const WHIP_Z = 0.40;
  // Settle: the operator's recovery. Kicked the other way and nearly critically damped, so
  // it does not oscillate — it leans the frame back the opposite way, peaking at about a
  // third of the whip a tenth of a second later, and is inside a pixel of the original
  // framing by two thirds of a second. Whip and settle deliberately do NOT match in size
  // or in speed: a response that is equal in both directions is a wobble, and a wobble is
  // what a shake shader does.
  const SETTLE_W = TAU * 0.85;
  const SETTLE_Z = 0.85;

  const whipYaw = spring();
  const whipPitch = spring();
  const whipRoll = spring();
  const setYaw = spring();
  const setPitch = spring();
  const setRoll = spring();
  const punch = spring(); // metres along the lens axis
  const focusErr = spring(); // fractional focus error the puller is chasing

  // Successive impacts must not be identical, and must not be random either.
  let kicks = 0;

  let primed = false;

  function kick(amount: number) {
    const k = Math.min(3, Math.max(0, amount));
    if (k <= 0) return;
    kicks++;
    // Deterministic alternation with a little variety, rather than a fresh random draw:
    // an operator's flinch has a handedness, and it does not reverse every single time.
    const hand = kicks % 3 === 0 ? -1 : 1;
    const lean = ((kicks * 0.618034) % 1) * 2 - 1; // low-discrepancy, repeatable

    // Down and away — the head drops off the eyepiece and the whole rig rotates about the
    // shoulder. Pitch dominates; yaw and roll follow at a fraction, which is what stops
    // this reading as a 2-D screen shake.
    whipPitch.v += -1.35 * k;
    whipYaw.v += 0.50 * k * hand;
    whipRoll.v += 0.55 * k * hand * (0.6 + 0.4 * lean);

    // The recovery goes the other way and arrives late.
    setPitch.v += 0.075 * k;
    setYaw.v += -0.030 * k * hand;
    setRoll.v += -0.024 * k * hand;

    // A physical shove back off the lens axis, so the framing loses a little size too.
    punch.v += 0.30 * k;

    // Focus is pulled by a human watching a blur, and they are always late. Small — a
    // couple of percent of the distance — because at these focal lengths that is already
    // the whole depth of the sharp band moving.
    focusErr.v += 1.00 * k * (0.6 + 0.4 * lean);
  }

  function update(t: number, dt: number, fovDeg: number): OperatorPose {
    // Scaled to focal length: a longer lens magnifies the same angular wobble, so the
    // operator's angles come down a little on the tight end — but only as the square root,
    // because they never come down enough to actually compensate. Tighter lens, more move.
    const halfRef = Math.tan((40 * Math.PI) / 360);
    const half = Math.tan((fovDeg * Math.PI) / 360);
    const angScale = Math.sqrt(Math.max(0.2, half / halfRef));

    const tYaw = nYaw(t) * A.yaw * DEG * angScale;
    const tPitch = nPitch(t) * A.pitch * DEG * angScale;
    const tRoll = nRoll(t) * A.roll * DEG;
    const tSwayX = nSwayX(t) * A.swayX;
    const tSwayY = nSwayY(t) * A.swayY;
    const tSwayZ = nSwayZ(t) * A.swayZ;

    const step = Math.max(1e-4, Math.min(0.1, dt));
    const lpK = 1 - Math.exp(-step / CORRECT_TAU);
    lpYaw += (tYaw - lpYaw) * lpK;
    lpPitch += (tPitch - lpPitch) * lpK;
    lpRoll += (tRoll - lpRoll) * lpK;

    const cYaw = tYaw - lpYaw * CORRECT_AMOUNT;
    const cPitch = tPitch - lpPitch * CORRECT_AMOUNT;
    const cRoll = tRoll - lpRoll * CORRECT_AMOUNT;

    if (!primed) {
      // Start the rig already holding the frame, not swinging into it from rest — the
      // first second of a shot is not a settling transient.
      primed = true;
      sYaw.x = cYaw;
      sPitch.x = cPitch;
      sRoll.x = cRoll;
      sSwayX.x = tSwayX;
      sSwayY.x = tSwayY;
      sSwayZ.x = tSwayZ;
    }

    stepSpring(sYaw, cYaw, RIG_W, RIG_Z, step);
    stepSpring(sPitch, cPitch, RIG_W, RIG_Z, step);
    stepSpring(sRoll, cRoll, RIG_W * 0.8, 0.75, step);
    stepSpring(sSwayX, tSwayX, RIG_W * 0.55, 0.85, step);
    stepSpring(sSwayY, tSwayY, RIG_W * 0.55, 0.85, step);
    stepSpring(sSwayZ, tSwayZ, RIG_W * 0.45, 0.9, step);

    stepSpring(whipYaw, 0, WHIP_W, WHIP_Z, step);
    stepSpring(whipPitch, 0, WHIP_W, WHIP_Z, step);
    stepSpring(whipRoll, 0, WHIP_W * 0.9, WHIP_Z + 0.05, step);
    stepSpring(setYaw, 0, SETTLE_W, SETTLE_Z, step);
    stepSpring(setPitch, 0, SETTLE_W, SETTLE_Z, step);
    stepSpring(setRoll, 0, SETTLE_W, SETTLE_Z, step);
    stepSpring(punch, 0, WHIP_W * 0.55, 0.42, step);
    stepSpring(focusErr, 0, TAU * 1.25, 0.70, step);

    const tremX = nTremX(t) * A.tremor * DEG * angScale;
    const tremY = nTremY(t) * A.tremor * DEG * angScale;

    return {
      yaw: sYaw.x + whipYaw.x + setYaw.x + tremX,
      pitch: sPitch.x + whipPitch.x + setPitch.x + tremY,
      roll: sRoll.x + whipRoll.x + setRoll.x,
      dx: sSwayX.x,
      dy: sSwayY.x,
      dz: sSwayZ.x - punch.x,
      // Both are fractions of the focus distance: a slow breath, and the puller's error.
      focusScale: 1 + nFocus(t) * 0.004 + focusErr.x,
      fovScale: 1 + focusErr.x * 0.05,
    };
  }

  return { update, kick };
}
