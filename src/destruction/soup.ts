/**
 * PIECE: destruction — the triangle soup a piece is broken with.
 *
 * The victim is not replaced by generic boxes: its *actual* carved geometry is read out
 * of the scene, cut by real half-space planes, and the cross-sections are capped as
 * fresh stone. So every fragment is a genuine piece of that figure — a helm section, a
 * shoulder, a corner of the plinth — with the weathered, rust-stained outer skin the
 * pieces module baked into it still on its outside, and raw pale stone on the break.
 *
 * A soup is a flat, non-indexed triangle list with a fixed 12-float vertex layout, which
 * is all the pieces' stone shader needs to keep rendering a fragment exactly the way it
 * rendered the statue it came from:
 *
 *   0..2  position      3..5  normal      6..8  vertex colour (albedo)
 *   9     aRough       10     aThin      11     aMail
 *
 * Deterministic by construction: there is no randomness in this file at all.
 */
import * as THREE from 'three';

/** Floats per vertex. */
export const CH = 12;
/** Floats per triangle. */
const TRI = CH * 3;

export interface Soup {
  /** 36 floats per triangle. */
  v: number[];
}

export function emptySoup(): Soup {
  return { v: [] };
}

export function triCount(s: Soup): number {
  return s.v.length / TRI;
}

const _nm = new THREE.Matrix3();

/**
 * Append a mesh's triangles, transformed by `matrix`, to the soup. Missing attributes
 * fall back to sane stone defaults so a fragment never renders as a hole.
 */
export function appendGeometry(s: Soup, geo: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const rgh = geo.getAttribute('aRough') as THREE.BufferAttribute | undefined;
  const thn = geo.getAttribute('aThin') as THREE.BufferAttribute | undefined;
  const mai = geo.getAttribute('aMail') as THREE.BufferAttribute | undefined;
  const index = geo.getIndex();
  const count = index ? index.count : pos.count;
  _nm.getNormalMatrix(matrix);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const vi = index ? index.getX(i) : i;
    p.fromBufferAttribute(pos, vi).applyMatrix4(matrix);
    if (nrm) n.fromBufferAttribute(nrm, vi).applyMatrix3(_nm).normalize();
    else n.set(0, 1, 0);
    s.v.push(
      p.x, p.y, p.z,
      n.x, n.y, n.z,
      col ? col.getX(vi) : 0.45, col ? col.getY(vi) : 0.43, col ? col.getZ(vi) : 0.40,
      rgh ? rgh.getX(vi) : 0.82,
      thn ? thn.getX(vi) : 0,
      mai ? mai.getX(vi) : 0,
    );
  }
  // Drop a trailing partial triangle rather than emitting garbage.
  const extra = s.v.length % TRI;
  if (extra) s.v.length -= extra;
}

/** Axis-aligned bounds of a soup. */
export function soupBounds(s: Soup): THREE.Box3 {
  const b = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < s.v.length; i += CH) {
    p.set(s.v[i], s.v[i + 1], s.v[i + 2]);
    b.expandByPoint(p);
  }
  return b;
}

/** Signed volume and centroid, by the divergence theorem over the closed surface. */
export function soupVolume(s: Soup): { volume: number; cx: number; cy: number; cz: number } {
  let vol = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < s.v.length; i += TRI) {
    const ax = s.v[i], ay = s.v[i + 1], az = s.v[i + 2];
    const bx = s.v[i + CH], by = s.v[i + CH + 1], bz = s.v[i + CH + 2];
    const dx = s.v[i + 2 * CH], dy = s.v[i + 2 * CH + 1], dz = s.v[i + 2 * CH + 2];
    const v = (ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx)) / 6;
    vol += v;
    cx += v * (ax + bx + dx) * 0.25;
    cy += v * (ay + by + dy) * 0.25;
    cz += v * (az + bz + dz) * 0.25;
  }
  if (Math.abs(vol) < 1e-9) {
    // Degenerate / open: fall back to the vertex average so a caller still gets a centre.
    let n = 0;
    cx = cy = cz = 0;
    for (let i = 0; i < s.v.length; i += CH) {
      cx += s.v[i]; cy += s.v[i + 1]; cz += s.v[i + 2]; n++;
    }
    if (n) { cx /= n; cy /= n; cz /= n; }
    return { volume: 0, cx, cy, cz };
  }
  return { volume: Math.abs(vol), cx: cx / vol, cy: cy / vol, cz: cz / vol };
}

function lerpVertex(out: number[], s: Soup, ia: number, ib: number, t: number): void {
  const base = out.length;
  for (let k = 0; k < CH; k++) out.push(s.v[ia + k] + (s.v[ib + k] - s.v[ia + k]) * t);
  // Renormalise the interpolated normal.
  const nx = out[base + 3], ny = out[base + 4], nz = out[base + 5];
  const l = Math.hypot(nx, ny, nz) || 1;
  out[base + 3] = nx / l; out[base + 4] = ny / l; out[base + 5] = nz / l;
}

function copyVertex(out: number[], s: Soup, i: number): void {
  for (let k = 0; k < CH; k++) out.push(s.v[i + k]);
}

function emitTri(out: number[], poly: number[], a: number, b: number, c: number): void {
  for (const i of [a, b, c]) for (let k = 0; k < CH; k++) out.push(poly[i * CH + k]);
}

/**
 * Keep the half `n·p <= d`. Cut edges are pushed to `cuts` as 6 floats (two endpoints)
 * so the caller can lid the hole.
 */
export function clipSoup(
  s: Soup,
  nx: number, ny: number, nz: number, d: number,
  cuts: number[],
): Soup {
  const out: number[] = [];
  const poly: number[] = [];
  for (let i = 0; i < s.v.length; i += TRI) {
    const i0 = i, i1 = i + CH, i2 = i + 2 * CH;
    const s0 = nx * s.v[i0] + ny * s.v[i0 + 1] + nz * s.v[i0 + 2] - d;
    const s1 = nx * s.v[i1] + ny * s.v[i1 + 1] + nz * s.v[i1 + 2] - d;
    const s2 = nx * s.v[i2] + ny * s.v[i2 + 1] + nz * s.v[i2 + 2] - d;
    if (s0 <= 0 && s1 <= 0 && s2 <= 0) {
      for (let k = 0; k < TRI; k++) out.push(s.v[i + k]);
      continue;
    }
    if (s0 > 0 && s1 > 0 && s2 > 0) continue;

    // Sutherland–Hodgman over one triangle. The two vertices created on the plane are
    // the cut segment for this triangle.
    poly.length = 0;
    const idx = [i0, i1, i2];
    const dist = [s0, s1, s2];
    const onPlane: number[] = [];
    for (let e = 0; e < 3; e++) {
      const ca = idx[e], cb = idx[(e + 1) % 3];
      const da = dist[e], db = dist[(e + 1) % 3];
      if (da <= 0) copyVertex(poly, s, ca);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        lerpVertex(poly, s, ca, cb, t);
        const b = poly.length - CH;
        onPlane.push(poly[b], poly[b + 1], poly[b + 2]);
      }
    }
    const nv = poly.length / CH;
    if (nv >= 3) {
      emitTri(out, poly, 0, 1, 2);
      if (nv === 4) emitTri(out, poly, 0, 2, 3);
    }
    if (onPlane.length >= 6) cuts.push(onPlane[0], onPlane[1], onPlane[2], onPlane[3], onPlane[4], onPlane[5]);
  }
  return { v: out };
}

/**
 * Lid the hole left by `clipSoup` with a fresh break face.
 *
 * The cut segments are grouped into connected loops (a plane can pass through a limb and
 * a plinth at once), then each loop is fanned about its own centroid. Fanning a loop that
 * happens to be concave slightly over-fills it; at fragment scale that is invisible and
 * it can never leave a hole, which a half-open stone shell would show as a black window.
 */
export function capSoup(
  s: Soup,
  nx: number, ny: number, nz: number,
  cuts: number[],
  colour: [number, number, number],
  rough: number,
): void {
  const segs = cuts.length / 6;
  if (segs < 2) return;

  // Weld endpoints, then union-find the segments into loops.
  const key = new Map<string, number>();
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  const ends = new Int32Array(segs * 2);
  const Q = 1e4;
  for (let i = 0; i < segs; i++) {
    for (let e = 0; e < 2; e++) {
      const o = i * 6 + e * 3;
      const k = `${Math.round(cuts[o] * Q)},${Math.round(cuts[o + 1] * Q)},${Math.round(cuts[o + 2] * Q)}`;
      let id = key.get(k);
      if (id === undefined) {
        id = px.length;
        key.set(k, id);
        px.push(cuts[o]); py.push(cuts[o + 1]); pz.push(cuts[o + 2]);
      }
      ends[i * 2 + e] = id;
    }
  }

  const parent = new Int32Array(px.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (let i = 0; i < segs; i++) {
    const a = find(ends[i * 2]), b = find(ends[i * 2 + 1]);
    if (a !== b) parent[a] = b;
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < px.length; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(i);
  }

  // Plane basis.
  let ux = 0, uy = 0, uz = 0;
  if (Math.abs(nx) < 0.9) { ux = 1; } else { uy = 1; }
  let tx = uy * nz - uz * ny, ty = uz * nx - ux * nz, tz = ux * ny - uy * nx;
  let tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;

  for (const g of groups.values()) {
    if (g.length < 3) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const i of g) { cx += px[i]; cy += py[i]; cz += pz[i]; }
    cx /= g.length; cy /= g.length; cz /= g.length;

    const ordered = g
      .map((i) => {
        const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
        return { i, a: Math.atan2(dx * bx + dy * by + dz * bz, dx * tx + dy * ty + dz * tz) };
      })
      .sort((p, q) => p.a - q.a);

    for (let k = 0; k < ordered.length; k++) {
      const a = ordered[k].i;
      const b = ordered[(k + 1) % ordered.length].i;
      const e1x = px[a] - cx, e1y = py[a] - cy, e1z = pz[a] - cz;
      const e2x = px[b] - cx, e2y = py[b] - cy, e2z = pz[b] - cz;
      const cr = (e1y * e2z - e1z * e2y) * nx + (e1z * e2x - e1x * e2z) * ny + (e1x * e2y - e1y * e2x) * nz;
      if (Math.abs(cr) < 1e-9) continue;
      const first = cr > 0 ? a : b;
      const second = cr > 0 ? b : a;
      push(s.v, cx, cy, cz);
      push(s.v, px[first], py[first], pz[first]);
      push(s.v, px[second], py[second], pz[second]);
    }
  }

  function push(v: number[], x: number, y: number, z: number) {
    v.push(x, y, z, nx, ny, nz, colour[0], colour[1], colour[2], rough, 0, 0);
  }
}

/** Move every vertex so the soup is centred on (cx, cy, cz). */
export function recentre(s: Soup, cx: number, cy: number, cz: number): void {
  for (let i = 0; i < s.v.length; i += CH) {
    s.v[i] -= cx; s.v[i + 1] -= cy; s.v[i + 2] -= cz;
  }
}

/** Turn a soup into a renderable geometry carrying everything the stone shader wants. */
export function soupToGeometry(s: Soup): THREE.BufferGeometry {
  const n = s.v.length / CH;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const rgh = new Float32Array(n);
  const thn = new Float32Array(n);
  const mai = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * CH;
    pos[i * 3] = s.v[o]; pos[i * 3 + 1] = s.v[o + 1]; pos[i * 3 + 2] = s.v[o + 2];
    nrm[i * 3] = s.v[o + 3]; nrm[i * 3 + 1] = s.v[o + 4]; nrm[i * 3 + 2] = s.v[o + 5];
    col[i * 3] = s.v[o + 6]; col[i * 3 + 1] = s.v[o + 7]; col[i * 3 + 2] = s.v[o + 8];
    rgh[i] = s.v[o + 9];
    thn[i] = s.v[o + 10];
    mai[i] = s.v[o + 11];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRough', new THREE.BufferAttribute(rgh, 1));
  g.setAttribute('aThin', new THREE.BufferAttribute(thn, 1));
  g.setAttribute('aMail', new THREE.BufferAttribute(mai, 1));
  g.computeBoundingSphere();
  return g;
}

/** Mean albedo of a soup — the reference value a fresh break has to be brighter than. */
export function meanColour(s: Soup): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < s.v.length; i += CH) {
    r += s.v[i + 6]; g += s.v[i + 7]; b += s.v[i + 8]; n++;
  }
  if (!n) return [0.45, 0.43, 0.40];
  return [r / n, g / n, b / n];
}

/** Up to 18 extreme points of a soup — enough of a hull for contact and resting. */
const HULL_DIRS: Array<[number, number, number]> = (() => {
  const d: Array<[number, number, number]> = [];
  const g = 1.618033988749895;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      d.push([0, s, t * g], [s, t * g, 0], [t * g, 0, s]);
    }
  }
  d.push([0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]);
  return d.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l] as [number, number, number];
  });
})();

export function supportPoints(s: Soup): Float32Array {
  const out = new Float32Array(HULL_DIRS.length * 3);
  for (let k = 0; k < HULL_DIRS.length; k++) {
    const [dx, dy, dz] = HULL_DIRS[k];
    let best = -Infinity, bx = 0, by = 0, bz = 0;
    for (let i = 0; i < s.v.length; i += CH) {
      const dot = s.v[i] * dx + s.v[i + 1] * dy + s.v[i + 2] * dz;
      if (dot > best) { best = dot; bx = s.v[i]; by = s.v[i + 1]; bz = s.v[i + 2]; }
    }
    out[k * 3] = bx; out[k * 3 + 1] = by; out[k * 3 + 2] = bz;
  }
  return out;
}
