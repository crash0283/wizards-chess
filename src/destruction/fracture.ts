/**
 * PIECE: destruction — breaking the real statue.
 *
 * A power diagram (a Voronoi diagram whose cells have per-site *weights*, so the
 * bisectors stay planar and cell sizes can be dialled) is laid over the victim's own
 * geometry and every cell is cut out of it with the half-space clipper in soup.ts.
 *
 * The site layout is the whole trick. Fracture is not uniform: stone shatters into fine
 * shrapnel where the blade goes in and lets go in big architectural lumps far from it.
 * So sites are dense and unweighted around the entry wound, sparse and heavily weighted
 * out at the plinth, with landmark sites deliberately dropped on the helm and the base
 * so that a recognisable helm section and a plinth block always come off whole. The
 * resulting size range runs from ~3 cm chips to ~0.8 m blocks — the 10:1 the brief asks
 * for, and it comes out of the physics of the break rather than being dialled in.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import {
  CH,
  capSoup,
  clipSoup,
  emptySoup,
  meanColour,
  recentre,
  soupBounds,
  soupToGeometry,
  soupVolume,
  supportPoints,
  triCount,
  type Soup,
} from './soup';

export interface Fragment {
  geometry: THREE.BufferGeometry;
  /** World-space centroid at the moment of the break. */
  centre: THREE.Vector3;
  volume: number;
  radius: number;
  /** Extreme points relative to the centroid, for contact and resting. */
  support: Float32Array;
  /** How much of this fragment is freshly broken face, 0..1. */
  freshness: number;
}

interface Site {
  x: number; y: number; z: number;
  /** Power weight: a bigger weight steals volume from its neighbours. */
  w: number;
}

export interface FractureOptions {
  rng: Rng;
  /** Target number of cells. */
  cells: number;
  /** Number of small chips knocked off the skin on top of the cells. */
  chips: number;
  /** World-space direction the blow travelled in. */
  impact: THREE.Vector3;
  /** World position of the piece's base centre. */
  base: THREE.Vector3;
  height: number;
}

/**
 * Brightness of a fresh break relative to the weathered skin it is exposed under.
 * Raw stone reads pale and raw against a stained outer face — but a break is stone, not
 * chalk: push this past about 1.6 and the wreckage blows out white and stops belonging
 * to the statue it came from.
 */
const FRESH_GAIN = 1.35;
const FRESH_FLOOR = 0.022;

export function freshColourFor(soup: Soup): [number, number, number] {
  const [r, g, b] = meanColour(soup);
  // Raw stone is lighter, rawer and less stained than any weathered face. Push toward
  // a slightly warm neutral as well as up, so a break face never reads as a grey decal.
  const lift = (c: number, k: number) => Math.min(0.92, c * FRESH_GAIN * k + FRESH_FLOOR);
  return [lift(r, 1.02), lift(g, 1.0), lift(b, 0.95)];
}

/**
 * Cut `soup` into fragments. The soup is consumed in world space and every fragment
 * comes back centred on its own centroid with its world position recorded.
 */
export function fracture(soup: Soup, opts: FractureOptions): Fragment[] {
  const { rng } = opts;
  const bounds = soupBounds(soup);
  const size = bounds.getSize(new THREE.Vector3());
  const mid = bounds.getCenter(new THREE.Vector3());
  const spanXZ = Math.max(0.25, Math.max(size.x, size.z));
  const fresh = freshColourFor(soup);

  // Where the blade went in: the near face, at chest height.
  const entry = new THREE.Vector3(
    mid.x - opts.impact.x * spanXZ * 0.42,
    opts.base.y + opts.height * 0.56,
    mid.z - opts.impact.z * spanXZ * 0.42,
  );

  const sites: Site[] = [];
  const wMax = Math.min(0.26, spanXZ * 0.20);

  const push = (x: number, y: number, z: number, w: number) => sites.push({ x, y, z, w });

  // --- landmarks: the pieces of the figure that must come off recognisable ------------
  push(mid.x + rng.float(-0.06, 0.06), opts.base.y + opts.height * 0.90, mid.z + rng.float(-0.06, 0.06), wMax * 1.05);
  push(mid.x + rng.float(-0.12, 0.12), opts.base.y + opts.height * 0.085, mid.z + rng.float(-0.12, 0.12), wMax * 1.30);
  push(
    mid.x + rng.float(-0.3, 0.3) - opts.impact.x * spanXZ * 0.3,
    opts.base.y + opts.height * 0.30,
    mid.z + rng.float(-0.3, 0.3) - opts.impact.z * spanXZ * 0.3,
    wMax * 0.95,
  );

  // --- the wound: dense, unweighted, tiny cells ---------------------------------------
  const wound = Math.max(4, Math.round(opts.cells * 0.30));
  for (let i = 0; i < wound; i++) {
    const r = spanXZ * 0.34 * Math.pow(rng.float(0, 1), 0.55);
    const th = rng.float(0, Math.PI * 2);
    const ph = rng.float(-0.85, 0.85);
    push(
      entry.x + Math.cos(th) * r,
      entry.y + ph * opts.height * 0.20,
      entry.z + Math.sin(th) * r,
      wMax * 0.10 * rng.float(0, 1),
    );
  }

  // --- the body: anchored on the statue's own surface, so cells follow its anatomy ----
  // Vertices are bucketed by height and the sites walk the buckets in turn, so the break
  // covers the whole figure from plinth to crown instead of clustering wherever the mesh
  // happens to be finely tessellated (which is always the head).
  const verts = soup.v.length / CH;
  const BANDS = 12;
  const bands: number[][] = Array.from({ length: BANDS }, () => []);
  const spanY = Math.max(1e-3, bounds.max.y - bounds.min.y);
  for (let vi = 0; vi < verts; vi++) {
    const b = Math.min(BANDS - 1, Math.floor(((soup.v[vi * CH + 1] - bounds.min.y) / spanY) * BANDS));
    bands[b].push(vi);
  }
  const rest = Math.max(6, opts.cells - wound - 3);
  for (let i = 0; i < rest; i++) {
    let x: number, y: number, z: number;
    const band = bands[i % BANDS];
    if (band.length > 0 && rng.bool(0.78)) {
      const vi = band[rng.int(0, band.length)] * CH;
      const inset = rng.float(0.02, 0.30) * spanXZ;
      x = soup.v[vi] - soup.v[vi + 3] * inset;
      y = soup.v[vi + 1] - soup.v[vi + 4] * inset;
      z = soup.v[vi + 2] - soup.v[vi + 5] * inset;
    } else {
      x = rng.float(bounds.min.x, bounds.max.x);
      y = rng.float(bounds.min.y, bounds.max.y);
      z = rng.float(bounds.min.z, bounds.max.z);
    }
    // Far from the wound, the stone lets go in bigger lumps.
    const dist = Math.hypot(x - entry.x, y - entry.y, z - entry.z);
    const far = Math.min(1, Math.max(0, (dist - spanXZ * 0.3) / (opts.height * 0.7)));
    push(x, y, z, wMax * far * Math.pow(rng.float(0, 1), 1.4));
  }

  // --- assign triangles to the cells they can possibly touch ---------------------------
  const tris = triCount(soup);
  const cand: number[][] = sites.map(() => []);
  const stride = CH * 3;
  for (let t = 0; t < tris; t++) {
    const o = t * stride;
    const cx = (soup.v[o] + soup.v[o + CH] + soup.v[o + 2 * CH]) / 3;
    const cy = (soup.v[o + 1] + soup.v[o + CH + 1] + soup.v[o + 2 * CH + 1]) / 3;
    const cz = (soup.v[o + 2] + soup.v[o + CH + 2] + soup.v[o + 2 * CH + 2]) / 3;
    let rad = 0;
    for (let k = 0; k < 3; k++) {
      const p = o + k * CH;
      rad = Math.max(rad, Math.hypot(soup.v[p] - cx, soup.v[p + 1] - cy, soup.v[p + 2] - cz));
    }
    let best = Infinity;
    for (const s of sites) {
      const d = Math.hypot(s.x - cx, s.y - cy, s.z - cz) - s.w;
      if (d < best) best = d;
    }
    const cut = best + 2 * rad + 0.10;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (Math.hypot(s.x - cx, s.y - cy, s.z - cz) - s.w <= cut) cand[i].push(o);
    }
  }

  // --- cut every cell out of the statue -------------------------------------------------
  const out: Fragment[] = [];
  const cuts: number[] = [];

  for (let i = 0; i < sites.length; i++) {
    if (cand[i].length < 4) continue;
    const si = sites[i];

    let cell: Soup = { v: [] };
    for (const o of cand[i]) for (let k = 0; k < stride; k++) cell.v.push(soup.v[o + k]);

    // EVERY other site cuts this cell, nearest first. Skipping the distant ones is
    // tempting and wrong: a plane that only just clips the far end of a candidate patch
    // is the one holding a whole extra limb inside the fragment. Nearest-first makes it
    // cheap anyway — after four or five cuts there is almost nothing left to test.
    const order: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue;
      const sj = sites[j];
      order.push({ j, d: Math.hypot(sj.x - si.x, sj.y - si.y, sj.z - si.z) });
    }
    order.sort((a, b) => (a.d === b.d ? a.j - b.j : a.d - b.d));

    for (let k = 0; k < order.length; k++) {
      if (cell.v.length === 0) break;
      const sj = sites[order[k].j];
      let nx = sj.x - si.x, ny = sj.y - si.y, nz = sj.z - si.z;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-5) continue;
      nx /= len; ny /= len; nz /= len;
      const d =
        (sj.x * sj.x + sj.y * sj.y + sj.z * sj.z - si.x * si.x - si.y * si.y - si.z * si.z
          - sj.w * sj.w + si.w * si.w) / (2 * len);
      cuts.length = 0;
      cell = clipSoup(cell, nx, ny, nz, d, cuts);
      capSoup(cell, nx, ny, nz, cuts, fresh, 0.86);
    }

    const frag = finish(cell, fresh);
    if (frag) out.push(frag);
  }

  // --- chips: little flakes spalled straight off the skin -------------------------------
  for (let i = 0; i < opts.chips && tris > 0; i++) {
    const t = rng.int(0, tris) * stride;
    const chip = buildChip(soup, t, rng.float(0.35, 0.78), rng.float(0.012, 0.055), fresh);
    if (!chip) continue;
    const frag = finish(chip, fresh);
    if (frag) out.push(frag);
  }

  return out;
}

/** Volume, centroid, hull and geometry for a finished cell. Rejects the specks. */
function finish(cell: Soup, fresh: [number, number, number]): Fragment | null {
  if (triCount(cell) < 4) return null;
  const bb = soupBounds(cell);
  const bs = bb.getSize(new THREE.Vector3());
  const bbv = Math.max(1e-9, bs.x * bs.y * bs.z);
  let { volume, cx, cy, cz } = soupVolume(cell);

  // A cell that came out of the clipper open — a cap that could not close because the
  // cut grazed a vertex — makes the divergence integral meaningless. Fall back to the
  // bounding box rather than handing the physics a body centred somewhere in the vault.
  const inside =
    cx >= bb.min.x - bs.x && cx <= bb.max.x + bs.x &&
    cy >= bb.min.y - bs.y && cy <= bb.max.y + bs.y &&
    cz >= bb.min.z - bs.z && cz <= bb.max.z + bs.z;
  if (!inside || !Number.isFinite(cx + cy + cz)) {
    const c = bb.getCenter(new THREE.Vector3());
    cx = c.x; cy = c.y; cz = c.z;
  }
  if (!Number.isFinite(volume) || volume <= 0 || volume > bbv * 1.05) volume = bbv * 0.34;
  if (volume < 6e-6) return null;
  // A cell that came out as a wide sheet a couple of centimetres thick is a shaving,
  // not a piece of a statue: it flutters, it catches the light like paper and it reads
  // as debris from something else entirely.
  const thin = Math.min(bs.x, bs.y, bs.z);
  const wide = Math.max(bs.x, bs.y, bs.z);
  if (thin < 0.025 && wide > 0.28) return null;
  recentre(cell, cx, cy, cz);

  let radius = 0;
  let freshTris = 0;
  const stride = CH * 3;
  for (let i = 0; i < cell.v.length; i += CH) {
    radius = Math.max(radius, Math.hypot(cell.v[i], cell.v[i + 1], cell.v[i + 2]));
  }
  for (let i = 0; i < cell.v.length; i += stride) {
    if (Math.abs(cell.v[i + 6] - fresh[0]) < 1e-4 && Math.abs(cell.v[i + 7] - fresh[1]) < 1e-4) freshTris++;
  }

  return {
    geometry: soupToGeometry(cell),
    centre: new THREE.Vector3(cx, cy, cz),
    volume,
    radius,
    support: supportPoints(cell),
    freshness: freshTris / Math.max(1, triCount(cell)),
  };
}

/** A flake off the skin: one shrunken surface triangle, extruded inward. */
function buildChip(
  soup: Soup,
  o: number,
  shrink: number,
  depth: number,
  fresh: [number, number, number],
): Soup | null {
  const p: number[][] = [];
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < 3; k++) {
    const i = o + k * CH;
    p.push([soup.v[i], soup.v[i + 1], soup.v[i + 2]]);
    cx += soup.v[i] / 3; cy += soup.v[i + 1] / 3; cz += soup.v[i + 2] / 3;
  }
  let nx = soup.v[o + 3] + soup.v[o + CH + 3] + soup.v[o + 2 * CH + 3];
  let ny = soup.v[o + 4] + soup.v[o + CH + 4] + soup.v[o + 2 * CH + 4];
  let nz = soup.v[o + 5] + soup.v[o + CH + 5] + soup.v[o + 2 * CH + 5];
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-5) return null;
  nx /= nl; ny /= nl; nz /= nl;

  const top = p.map(([x, y, z]) => [
    cx + (x - cx) * shrink,
    cy + (y - cy) * shrink,
    cz + (z - cz) * shrink,
  ]);
  const bot = top.map(([x, y, z]) => [x - nx * depth, y - ny * depth, z - nz * depth]);

  const s = emptySoup();
  const colTop: [number, number, number] = [soup.v[o + 6], soup.v[o + 7], soup.v[o + 8]];
  const put = (
    a: number[], b: number[], c: number[],
    col: [number, number, number],
  ) => {
    let ex1 = b[0] - a[0], ey1 = b[1] - a[1], ez1 = b[2] - a[2];
    let ex2 = c[0] - a[0], ey2 = c[1] - a[1], ez2 = c[2] - a[2];
    let fx = ey1 * ez2 - ez1 * ey2, fy = ez1 * ex2 - ex1 * ez2, fz = ex1 * ey2 - ey1 * ex2;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    for (const v of [a, b, c]) {
      s.v.push(v[0], v[1], v[2], fx, fy, fz, col[0], col[1], col[2], 0.86, 0, 0);
    }
  };

  put(top[0], top[1], top[2], colTop);
  put(bot[2], bot[1], bot[0], fresh);
  for (let k = 0; k < 3; k++) {
    const a = top[k], b = top[(k + 1) % 3];
    const c = bot[(k + 1) % 3], d = bot[k];
    put(a, b, c, fresh);
    put(a, c, d, fresh);
  }
  return s;
}
