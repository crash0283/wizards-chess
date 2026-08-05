/**
 * Deterministic RNG. FROZEN CORE — do not edit in a piece build.
 *
 * Every random decision in the scene must come from one of these so that a given
 * (seed, shot, t) always produces a byte-identical frame. The critic harness relies
 * on that: it re-renders the same shot and expects the same image.
 */

export interface Rng {
  (): number;
  float(min: number, max: number): number;
  int(min: number, maxExclusive: number): number;
  bool(pTrue?: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Normal-ish, mean 0 stddev 1, via sum of uniforms. Cheap and stable. */
  gauss(): number;
  /** A fresh independent stream — use per-object so adding objects doesn't reshuffle others. */
  fork(tag: string): Rng;
}

/** mulberry32 — small, fast, good enough distribution, fully deterministic. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = next as Rng;
  rng.float = (min, max) => min + next() * (max - min);
  rng.int = (min, maxExclusive) => min + Math.floor(next() * (maxExclusive - min));
  rng.bool = (pTrue = 0.5) => next() < pTrue;
  rng.pick = (items) => items[Math.floor(next() * items.length) % items.length];
  rng.gauss = () => (next() + next() + next() + next() + next() + next() - 3) / 0.7071;
  rng.fork = (tag: string) => makeRng((seed ^ hashString(tag)) >>> 0);
  return rng;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Classic 3D value-noise gradient noise, seeded. Used by stone materials + flicker. */
export function makeNoise3(seed: number) {
  const perm = new Uint8Array(512);
  const rng = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return function noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };
}

/** Fractal brownian motion over the noise above. The workhorse for stone surfaces. */
export function makeFbm(seed: number, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  const n = makeNoise3(seed);
  return (x: number, y: number, z: number) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}
