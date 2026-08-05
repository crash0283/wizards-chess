/**
 * PIECE: camera — the operator's noise source.
 *
 * A handheld camera is the one thing in this project that must not look like a
 * function. Sine waves read instantly as animation: they have a period, they turn
 * around at the same place every time, and the eye finds that in half a second. What a
 * shoulder-mounted rig actually produces is broadband, pink-ish noise — a lot of energy
 * at half a hertz (the operator's weight moving between feet), less at two or three
 * (breathing, the arm), and a fine tremor on top that never repeats.
 *
 * So every channel here is fractal value noise sampled along its own line through a
 * shared 3-D noise field, seeded from `world.rng`. Deterministic, non-periodic over any
 * shot length, and with a spectrum that falls off the way a body does.
 */
import { makeNoise3 } from '../core/rng';

export interface Fbm1 {
  /** Value in roughly [-1, 1] at time t (seconds). */
  (t: number): number;
}

/**
 * One noise channel: `octaves` octaves of value noise at `rate` Hz, each octave twice as
 * fast and `gain` as strong. `lane` separates channels — each one walks a different line
 * through the field, so yaw and pitch are uncorrelated rather than the same wiggle.
 */
export function makeChannel(
  noise: (x: number, y: number, z: number) => number,
  lane: number,
  rate: number,
  octaves = 3,
  gain = 0.48,
): Fbm1 {
  const y = lane * 11.37 + 3.1;
  const z = lane * 5.91 - 7.7;
  let norm = 0;
  for (let i = 0, a = 1; i < octaves; i++, a *= gain) norm += a;
  return (t: number) => {
    let sum = 0;
    let amp = 1;
    let freq = rate;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(t * freq, y + i * 2.7, z - i * 1.9);
      amp *= gain;
      freq *= 2.07; // not exactly 2 — keeps octaves from re-phasing on a short cycle
    }
    // Gradient noise only reaches its theoretical ±1 where a lattice cell happens to line
    // up perfectly, and a 1-D walk through it never does: measured over twenty seconds
    // these channels peak around 0.3. Normalising here means the amplitudes in
    // `operator.ts` can be written as the degrees they actually are.
    return (sum / norm) * 3.2;
  };
}

/** A field plus a factory for channels off it, all from one deterministic seed. */
export function makeNoiseField(seed: number) {
  const noise = makeNoise3(seed);
  let lane = 0;
  return {
    channel(rate: number, octaves = 3, gain = 0.48): Fbm1 {
      return makeChannel(noise, lane++, rate, octaves, gain);
    },
  };
}
