/**
 * PIECE: chamber — procedural stone surface, generated once into an atlas.
 *
 * Every block, flagstone, voussoir and chunk of scree in the room shares one atlas of
 * 16 stone patches (albedo / normal / roughness). One material means one compiled
 * program and one texture upload for several thousand instanced blocks, which matters
 * a great deal under software GL; sixteen patches plus per-instance tinting means the
 * masonry never reads as a repeated tile.
 *
 * This is the finest of the three spatial scales of detail: centimetre pitting, chisel
 * tooling and chipped arrises live here. Metre-scale block variation lives in
 * `weather.ts`, and the architectural scale lives in `wall.ts`.
 *
 * Determinism: the field is a pure function of a forked rng seed. No clocks.
 */
import * as THREE from 'three';
import { makeFbm, hashString } from '../core/rng';
import type { World } from '../core/world';

export interface CellRect {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

export interface StoneAtlas {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** Cells across and down. */
  grid: number;
  /** Sub-rectangle of cell `i`, inset so mip bleeding never crosses a cell border. */
  cell(i: number, sub?: number): CellRect;
  dispose(): void;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function buildStoneAtlas(world: World): StoneAtlas {
  const high = world.quality === 'high';
  const size = high ? 1024 : 512;
  const grid = 4;
  const cell = size / grid;

  const seed = hashString('chamber-stone-atlas') ^ world.seed;
  const fBroad = makeFbm(seed >>> 0, high ? 4 : 3, 2.03, 0.5);
  const fFine = makeFbm((seed ^ 0x9e3779b9) >>> 0, high ? 4 : 3, 2.11, 0.55);
  const fChip = makeFbm((seed ^ 0x517cc1b7) >>> 0, 3, 2.07, 0.5);

  const n = size * size;
  const height = new Float32Array(n);
  const albedo = new Float32Array(n);
  const chip = new Float32Array(n);

  for (let cj = 0; cj < grid; cj++) {
    for (let ci = 0; ci < grid; ci++) {
      // Each cell is an independent slice of the same noise field.
      const zc = (ci * 7.77 + cj * 23.31) + 0.5;
      for (let py = 0; py < cell; py++) {
        const Y = (py / cell) * 2.0;
        const row = (cj * cell + py) * size + ci * cell;
        for (let px = 0; px < cell; px++) {
          const X = (px / cell) * 2.0;

          const b = fBroad(X * 1.55, Y * 1.55, zc);
          const f = fFine(X * 7.4, Y * 7.4, zc + 11.7);
          // Ridged noise gathers into narrow veins -> chipped arrises and shell pits.
          const r = 1.0 - Math.abs(fChip(X * 3.4, Y * 3.4, zc + 31.3)) * 2.6;
          const pit = Math.max(0, r - 0.62) * 2.1;

          // Chisel tooling: a faint diagonal comb, wandered by the fine field so it
          // never reads as a straight machine line.
          const tool = Math.sin((X + Y * 0.72) * 41.0 + f * 11.0) * 0.017;

          let h = 0.56 + 0.30 * b + 0.14 * f + tool - 0.5 * pit;
          let a = 0.60 + 0.27 * b + 0.11 * f + tool * 0.6 - 0.16 * pit;
          // Fresh break faces inside a chip are paler and rawer than any weathered face.
          a += 0.26 * pit;

          const idx = row + px;
          height[idx] = h;
          albedo[idx] = clamp01(a);
          chip[idx] = pit;
        }
      }
    }
  }

  // --- albedo ---------------------------------------------------------------------
  const mapData = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = albedo[i];
    // Limestone: a hair warm in the raw albedo so the cold room does the cooling.
    const o = i * 4;
    mapData[o] = Math.round(clamp01(a * 1.09) * 255);
    mapData[o + 1] = Math.round(clamp01(a * 1.0) * 255);
    mapData[o + 2] = Math.round(clamp01(a * 0.795 + chip[i] * 0.04) * 255);
    mapData[o + 3] = 255;
  }

  // --- roughness ------------------------------------------------------------------
  const roughData = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const rgh = clamp01(0.60 + 0.32 * (1.0 - height[i]) + chip[i] * 0.15);
    const o = i * 4;
    roughData[o] = 255;
    roughData[o + 1] = Math.round(rgh * 255); // green channel = roughness
    roughData[o + 2] = 255;
    roughData[o + 3] = 255;
  }

  // --- normal ---------------------------------------------------------------------
  const normData = new Uint8Array(n * 4);
  const strength = high ? 2.6 : 2.0;
  for (let y = 0; y < size; y++) {
    const ym = y > 0 ? y - 1 : y;
    const yp = y < size - 1 ? y + 1 : y;
    for (let x = 0; x < size; x++) {
      const xm = x > 0 ? x - 1 : x;
      const xp = x < size - 1 ? x + 1 : x;
      const dx = (height[y * size + xp] - height[y * size + xm]) * strength;
      const dy = (height[yp * size + x] - height[ym * size + x]) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const inv = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const o = (y * size + x) * 4;
      normData[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normData[o + 3] = 255;
    }
  }

  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = high ? 4 : 1;
    t.needsUpdate = true;
    return t;
  };

  const map = mk(mapData, true);
  const normalMap = mk(normData, false);
  const roughnessMap = mk(roughData, false);

  const inset = 3 / cell; // texels of guard band, expressed in cell-normalised units

  return {
    map,
    normalMap,
    roughnessMap,
    grid,
    cell(i: number, sub = 0): CellRect {
      const k = ((i % (grid * grid)) + grid * grid) % (grid * grid);
      const ci = k % grid;
      const cj = Math.floor(k / grid);
      const s = 1 / grid;
      // `sub` slides a wide sub-window around inside the cell so two variants sharing a
      // cell still differ, and so block faces are not stretched square.
      const h = 0.46;
      const off = ((sub * 0.37) % 1) * (1 - h - inset * 2);
      return {
        u0: ci * s + inset * s,
        v0: cj * s + (inset + off) * s,
        du: s * (1 - inset * 2),
        dv: s * h,
      };
    },
    dispose() {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}
