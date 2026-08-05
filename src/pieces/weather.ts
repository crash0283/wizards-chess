/**
 * PIECE: pieces — weathering. What turns a shape into stone that has stood for centuries.
 *
 * Two jobs, both driven purely by world.rng:
 *
 *  displace()  the ~10 cm band of surface: chisel facets (a Voronoi of small planar cuts,
 *              because that is literally what a mason leaves), broad weathering swell,
 *              pitting, and erosion of the arrises so no edge is mathematically sharp.
 *
 *  shade()     the metre band: blotching, downward staining runs, dust settled on upward
 *              faces near the floor, cavity darkening in the recesses, and the lighter,
 *              rougher albedo of a break face. Written into vertex colour + roughness.
 */
import type { Rng } from '../core/rng';
import { makeFbm } from '../core/rng';
import type { Shader } from './mesh';
import type { StoneSpec } from './stone';

function ihash3(x: number, y: number, z: number, s: number): number {
  let h = (s ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483629)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Chisel facets. Nearest site in a jittered lattice defines a small plane; the surface is
 * pushed onto that plane along its own normal. Cell boundaries become the ridge between
 * two chisel strokes. Clamped, so it stays a surface treatment and never tears the form.
 */
function facets(
  px: number, py: number, pz: number,
  nx: number, ny: number, nz: number,
  cell: number, slope: number, amp: number, seed: number,
): number {
  const inv = 1 / cell;
  const ix = Math.floor(px * inv), iy = Math.floor(py * inv), iz = Math.floor(pz * inv);
  let best = Infinity;
  let bcx = 0, bcy = 0, bcz = 0, bh = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = ix + dx, gy = iy + dy, gz = iz + dz;
        const h = ihash3(gx, gy, gz, seed);
        const jx = (h & 255) / 255;
        const jy = ((h >>> 8) & 255) / 255;
        const jz = ((h >>> 16) & 255) / 255;
        const cx = (gx + jx) * cell, cy = (gy + jy) * cell, cz = (gz + jz) * cell;
        const ex = px - cx, ey = py - cy, ez = pz - cz;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < best) {
          best = d2;
          bcx = cx; bcy = cy; bcz = cz;
          bh = h;
        }
      }
    }
  }
  // A tangent gradient + a per-facet offset gives a locally planar cut.
  const h2 = ihash3(bh | 0, 0x5f, 0x21, seed ^ 0x1d3b);
  let gx = ((h2 & 1023) / 1023) * 2 - 1;
  let gy = (((h2 >>> 10) & 1023) / 1023) * 2 - 1;
  let gz = (((h2 >>> 20) & 1023) / 1023) * 2 - 1;
  const d = gx * nx + gy * ny + gz * nz;
  gx -= nx * d; gy -= ny * d; gz -= nz * d;
  const gl = Math.hypot(gx, gy, gz) || 1;
  const k = slope / gl;
  gx *= k; gy *= k; gz *= k;
  const off = (((bh >>> 24) & 255) / 255 - 0.5) * amp * 1.35;
  const v = off + (px - bcx) * gx + (py - bcy) * gy + (pz - bcz) * gz;
  return v < -amp ? -amp : v > amp ? amp : v;
}

export interface Weather {
  displace: (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    fresh: number, arris: number,
  ) => number;
  shade: Shader;
}

/**
 * @param spec   stone type parameters
 * @param rng    per-instance stream (world.rng.fork(id)) — this is what makes every
 *               chessman on the board a different stone from every other.
 */
export function makeWeather(spec: StoneSpec, rng: Rng, heightScale: number): Weather {
  const seedA = rng.int(1, 0x7ffffff);
  const seedB = rng.int(1, 0x7ffffff);
  const ox = rng.float(-90, 90), oy = rng.float(-90, 90), oz = rng.float(-90, 90);
  const sx = rng.float(-70, 70), sy = rng.float(-70, 70), sz = rng.float(-70, 70);

  // Two octaves only: displacement must stay well below the triangle Nyquist or the
  // carving turns into crumpled paper under grazing firelight.
  const fSwell = makeFbm(seedA ^ 0x11, 2, 2.05, 0.5);
  const fPit = makeFbm(seedA ^ 0x27, 2, 2.1, 0.5);
  const fBlotch = makeFbm(seedB ^ 0x31, 4, 2.03, 0.55);
  const fStain = makeFbm(seedB ^ 0x4d, 3, 2.09, 0.60);
  const fMottle = makeFbm(seedB ^ 0x63, 3, 2.11, 0.52);
  const fBed = makeFbm(seedB ^ 0x7f, 2, 2.0, 0.5);

  // Per-instance variation in how hard this particular block has weathered.
  const wear = rng.float(0.72, 1.34);
  const erodeK = spec.erode * rng.float(0.7, 1.45);
  const facetPhase = rng.float(0.0, 12.0);
  const stainK = spec.stain * rng.float(0.6, 1.5);
  // How readily this particular block rusts — some pieces are almost clean, some heavily marked.
  const rustBias = rng.float(-0.06, 0.11);
  const base = spec.base, warm = spec.warm, cool = spec.cool, fresh = spec.fresh;

  const displace: Weather['displace'] = (x, y, z, nx, ny, nz, freshV, arris) => {
    const swell = fSwell(x * 0.85 + ox, y * 0.72 + oy, z * 0.85 + oz) * spec.swell * wear;
    const pit = fPit(x * 2.6 + ox, y * 2.6 + oy, z * 2.6 + oz) * spec.pit * wear;
    const f1 = facets(
      x + facetPhase, y + facetPhase * 0.31, z - facetPhase * 0.7,
      nx, ny, nz,
      spec.facetLargeCell, 0.028, spec.facetLarge * wear, seedA,
    );
    const f2 = facets(
      x - facetPhase * 0.5, y + facetPhase, z + facetPhase * 0.22,
      nx, ny, nz,
      spec.facetFineCell, 0.036, spec.facetFine * wear, seedB,
    );
    // Break faces are rawer: no chisel work on them. Their relief stays low-frequency so
    // the cut face still reads as one plane, the way a real fracture does.
    const raw = freshV;
    const chisel = (f1 + f2) * (1 - raw);
    const fracture = raw * fPit(x * 1.9 + sx, y * 1.9 + sy, z * 1.9 + sz) * 0.010;
    // Arrises erode — but only genuine convex arrises, and limestone far more than basalt.
    const ero = arris * erodeK * (0.55 + 0.9 * (fPit(x * 3.1 + sx, y * 3.1 + sy, z * 3.1 + sz) * 0.5 + 0.5));
    return (swell + pit + chisel + fracture - ero) * heightScale;
  };

  const shade: Shader = (out, x, y, z, nx, ny, nz, freshV, _thin, recess) => {
    const bl = fBlotch(x * 0.78 + ox, y * 0.62 + oy, z * 0.78 + oz);
    const st = fStain(x * 1.05 + sx, y * 0.17 + sy, z * 1.05 + sz);
    const mo = fMottle(x * 4.4 + oz, y * 4.4 + ox, z * 4.4 + oy);
    const bed = spec.bedding > 0 ? fBed(x * 0.45 + ox, y * 7.5, z * 0.45 + oz) : 0;

    const rn = recess / 0.014;
    const rIn = rn > 0 ? (rn > 1 ? 1 : rn) : 0;
    const rOut = rn < 0 ? (rn < -1 ? 1 : -rn) : 0;

    // Dust and grit settle on anything facing up, heaviest near the floor.
    const up = ny > 0 ? ny * ny : 0;
    const low = y < 0.15 ? 1 : y > 1.7 ? 0 : (1.7 - y) / 1.55;
    const dust = up * low * spec.dust;

    // Rust. Irregular PATCHES with definite edges, not a smooth gradient — this is the
    // most identifiable thing about the pale army. Iron in the stone bleeds out where
    // water sits, so up-facing surfaces and recesses take far more of it.
    let rust = (bl + mo * 0.42 - rustBias) / 0.17;
    rust = rust <= 0 ? 0 : rust >= 1 ? 1 : rust * rust * (3 - 2 * rust);
    rust *= 0.62 + 0.40 * up + 0.28 * rIn;
    const kW = rust * spec.blotch;
    // Soot and cold weathering run downward off the ledges.
    const kC = Math.max(0, st) * stainK * (0.5 + 0.5 * Math.max(0, -ny));
    const kk = Math.min(0.92, kW + kC);
    const fW = kk > 0 ? (kW / (kW + kC || 1)) * kk : 0;
    const fC = kk > 0 ? (kC / (kW + kC || 1)) * kk : 0;
    let r = base.r * (1 - kk) + warm.r * fW + cool.r * fC;
    let g = base.g * (1 - kk) + warm.g * fW + cool.g * fC;
    let b = base.b * (1 - kk) + warm.b * fW + cool.b * fC;

    if (freshV > 0) {
      const k = freshV * (0.55 + 0.45 * spec.freshLift);
      r = r * (1 - k) + fresh.r * k;
      g = g * (1 - k) + fresh.g * k;
      b = b * (1 - k) + fresh.b * k;
    }

    let lum =
      (1 + mo * spec.mottle) *
      (1 + bed * spec.bedding) *
      (1 - rIn * spec.cavity) *
      (1 + rOut * 0.05) *
      (1 + dust) *
      (1 - rust * 0.14);
    if (lum < 0.12) lum = 0.12;

    out.r = r * lum;
    out.g = g * lum;
    out.b = b * lum;

    let rough =
      spec.roughBase +
      rIn * spec.roughCavity -
      rOut * spec.roughWorn +
      freshV * spec.roughFresh +
      bed * spec.bedding * 0.6 +
      mo * 0.05 -
      dust * 0.04;
    out.rough = rough < 0.34 ? 0.34 : rough > 1 ? 1 : rough;
  };

  return { displace, shade };
}
