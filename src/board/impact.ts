/**
 * PIECE: board — the stateful surface: baked wear plus everything the game does to it.
 *
 * One RGBA map in world space over the whole board assembly:
 *   R  dust deposition   — pale stone powder thrown out of a burst, drifting into joints
 *   G  scoring/abrasion  — where a fragment landed hard and dragged
 *   B  baseline wear     — traffic polish and the worn stances under the ranks, baked
 *   A  aggregate         — a static per-texel break-up so nothing reads as a clean disc
 *
 * `markImpact` accumulates into R and G and re-uploads only when something changed, so
 * the aftermath shot shows a board that remembers what landed on it. Everything is
 * generated with the fbm helper from src/core/rng.ts; there is no clock and no
 * Math.random anywhere in here.
 */
import * as THREE from 'three';
import { SQUARE, squareCentre } from '../core/constants';
import { makeFbm } from '../core/rng';
import type { World } from '../core/world';
import { HALF, MAP_EXTENT } from './layout';

export interface ImpactField {
  texture: THREE.DataTexture;
  /** Accumulate dust and scoring in a world-space disc. */
  mark(x: number, z: number, radius: number, strength: number): void;
  dispose(): void;
}

export function createImpactField(world: World): ImpactField {
  /**
   * The one texture this piece allocates, RGBA8 over a 24.8 m square.
   *
   *   high  512 x 512 = 1 048 576 bytes,  4.8 cm per texel
   *   low   128 x 128 =    65 536 bytes, 19.4 cm per texel
   *
   * What lives in it is the slowest-varying thing on the board — baked traffic wear, and
   * the dust a burst throws — and every one of those terms is given its structure again
   * per pixel in the shader (see the dustMask arithmetic in marble.ts, which multiplies
   * this by fbm at 30 cm and at 3 cm). So the map only has to say WHERE, not what it
   * looks like, and 19 cm is finer than the softest edge any deposit has. It also makes
   * markImpact sixteen times cheaper, which matters: it runs on the CPU every time a
   * piece is destroyed, on the same thread as the frame.
   */
  const size = world.quality === 'high' ? 512 : 128;
  const data = new Uint8Array(size * size * 4);
  const seed = world.rng.fork('board-wear').int(1, 0x7fffffff);
  const fbmWear = makeFbm(seed, 5);
  const fbmDrift = makeFbm(seed ^ 0x51ab, 4);
  const fbmGrit = makeFbm(seed ^ 0x9d3f, 3);

  /** Texel centre -> world metres. */
  const toWorld = (i: number) => ((i + 0.5) / size - 0.5) * 2 * MAP_EXTENT;

  // --- baked baseline ------------------------------------------------------------------
  // Traffic polish is not uniform: it pools along the middle files where the game is
  // fought and under the ranks where the pieces have stood for centuries.
  const stances: Array<[number, number]> = [];
  for (let f = 0; f < 8; f++) {
    for (const r of [0, 1, 6, 7]) {
      const c = squareCentre(f, r);
      stances.push([c.x, c.z]);
    }
  }

  for (let j = 0; j < size; j++) {
    const z = toWorld(j);
    for (let i = 0; i < size; i++) {
      const x = toWorld(i);
      const o = (j * size + i) * 4;

      // makeFbm is signed, mean 0, spread about +-0.55. Wear sits low with real
      // patches in it rather than covering the whole floor.
      let wear = 0.15 + 0.72 * fbmWear(x * 0.085, z * 0.085, 0.5);
      // Broad patches: some squares are simply more worn than their neighbours.
      wear += 0.55 * fbmWear(x * 0.31, z * 0.31, 3.7);
      // A worn depression under every stance in the two back ranks.
      let stance = 0;
      for (const [sx, sz] of stances) {
        const d = Math.hypot(x - sx, z - sz) / (SQUARE * 0.40);
        if (d < 1) stance = Math.max(stance, (1 - d) * (1 - d));
      }
      wear += stance * 0.42;
      // Beyond the field the border and kerb are weathered harder — nothing shelters them.
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (edge > HALF) wear += Math.min(0.42, (edge - HALF) * 0.30);

      // A little grit has always been drifted into this room; more of it near the rim,
      // where the rubble heaps are, than out in the middle of the board.
      const drift =
        Math.max(0, fbmDrift(x * 0.22, z * 0.22, 8.1) - 0.12) * 0.55 +
        Math.max(0, (edge - HALF * 0.72) / HALF) * 0.16;

      data[o + 0] = clampByte(drift * 255);
      data[o + 1] = 0;
      data[o + 2] = clampByte(wear * 255);
      data[o + 3] = clampByte((0.5 + 0.5 * fbmGrit(x * 2.9, z * 2.9, 1.3)) * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'board-wear';
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  // A static, deterministic break-up field so a deposit is never a clean circle. Sampled
  // per texel at mark time, not per pixel, which keeps markImpact cheap.
  const fbmSplat = makeFbm(seed ^ 0x2c17, 3);

  return {
    texture,

    mark(x: number, z: number, radius: number, strength: number) {
      if (!(radius > 0) || !(strength > 0)) return;
      const px = (radius / MAP_EXTENT) * (size / 2);
      const cx = ((x / (2 * MAP_EXTENT)) + 0.5) * size - 0.5;
      const cz = ((z / (2 * MAP_EXTENT)) + 0.5) * size - 0.5;
      const i0 = Math.max(0, Math.floor(cx - px - 1));
      const i1 = Math.min(size - 1, Math.ceil(cx + px + 1));
      const j0 = Math.max(0, Math.floor(cz - px - 1));
      const j1 = Math.min(size - 1, Math.ceil(cz + px + 1));
      if (i1 < i0 || j1 < j0) return;

      let touched = false;
      for (let j = j0; j <= j1; j++) {
        const wz = toWorld(j);
        for (let i = i0; i <= i1; i++) {
          const wx = toWorld(i);
          const d = Math.hypot(wx - x, wz - z) / radius;
          if (d >= 1) continue;
          // Lobed edge: the plume does not deposit in a circle.
          const lobe = 0.68 + 0.55 * fbmSplat(wx * 1.35, wz * 1.35, 4.2);
          const dd = d / lobe;
          if (dd >= 1) continue;
          const fall = (1 - dd) * (1 - dd);
          const o = (j * size + i) * 4;
          const dust = fall * strength * 235;
          const score = Math.max(0, 1 - dd * 2.1) * strength * 150;
          const nd = Math.min(255, data[o] + dust);
          const ns = Math.min(255, data[o + 1] + score);
          if (nd !== data[o] || ns !== data[o + 1]) touched = true;
          data[o] = nd;
          data[o + 1] = ns;
        }
      }
      if (touched) texture.needsUpdate = true;
    },

    dispose() {
      texture.dispose();
    },
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
