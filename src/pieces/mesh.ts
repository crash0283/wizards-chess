/**
 * PIECE: pieces — carving toolkit.
 *
 * A tiny mesh kernel for *carving* rather than modelling. Everything the chessmen are
 * made of goes through here:
 *
 *   Part      welded indexed triangle soup, built by lofting polygonal cross-sections
 *   subdivide conforming red-green refinement (no T-junctions, no cracks)
 *   clipMesh  half-space cut with a capped cross-section — this is how stone breaks
 *   analyse   welded normals, convex "arris-ness", freshness bleed
 *   toGeometry explode to non-indexed with true face normals -> flat chisel facets
 *
 * Deterministic by construction: no randomness lives in this file at all.
 */
import * as THREE from 'three';

/** Welded, indexed triangle soup with a per-vertex "thin edge" field and per-face freshness. */
export interface CMesh {
  /** 3 floats per vertex. */
  pos: number[];
  /** 1 float per vertex, 0..1 — how thin/translucent the stone is here (ears, blade edges). */
  thin: number[];
  /** 3 indices per triangle. */
  idx: number[];
  /** 1 float per triangle, 0..1 — 0 weathered outer skin, 1 freshly exposed break face. */
  face: number[];
}

const QK = 1e4;

/** A single closed solid. Welds vertices on insert so displacement can never crack it. */
export class Part {
  pos: number[] = [];
  thin: number[] = [];
  idx: number[] = [];
  face: number[] = [];
  /** Thinness stamped onto every vertex created from now on. */
  thinNow = 0;
  /** Target triangle edge length for this part when it is refined. */
  detail = 0.14;
  private buckets = new Map<number, number[]>();

  v(x: number, y: number, z: number): number {
    const kx = Math.round(x * QK), ky = Math.round(y * QK), kz = Math.round(z * QK);
    const key = (Math.imul(kx, 73856093) ^ Math.imul(ky, 19349663) ^ Math.imul(kz, 83492791)) | 0;
    let b = this.buckets.get(key);
    if (b !== undefined) {
      for (let n = 0; n < b.length; n++) {
        const i = b[n];
        if (
          Math.round(this.pos[i * 3] * QK) === kx &&
          Math.round(this.pos[i * 3 + 1] * QK) === ky &&
          Math.round(this.pos[i * 3 + 2] * QK) === kz
        ) {
          if (this.thinNow > this.thin[i]) this.thin[i] = this.thinNow;
          return i;
        }
      }
    } else {
      b = [];
      this.buckets.set(key, b);
    }
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.thin.push(this.thinNow);
    b.push(i);
    return i;
  }

  vv(p: THREE.Vector3): number {
    return this.v(p.x, p.y, p.z);
  }

  t(a: number, b: number, c: number, fresh = 0): void {
    if (a === b || b === c || a === c) return;
    this.idx.push(a, b, c);
    this.face.push(fresh);
  }

  q(a: number, b: number, c: number, d: number, fresh = 0): void {
    this.t(a, b, c, fresh);
    this.t(a, c, d, fresh);
  }

  mesh(): CMesh {
    return { pos: this.pos, thin: this.thin, idx: this.idx, face: this.face };
  }
}

/** Signed volume; used to guarantee outward winding without hand-tracking orientation. */
export function orientOutward(m: CMesh): void {
  let vol = 0;
  const p = m.pos;
  for (let f = 0; f < m.idx.length; f += 3) {
    const a = m.idx[f] * 3, b = m.idx[f + 1] * 3, c = m.idx[f + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    vol +=
      ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (let f = 0; f < m.idx.length; f += 3) {
      const t = m.idx[f + 1];
      m.idx[f + 1] = m.idx[f + 2];
      m.idx[f + 2] = t;
    }
  }
}

export function mergeMeshes(list: CMesh[]): CMesh {
  const out: CMesh = { pos: [], thin: [], idx: [], face: [] };
  for (const m of list) {
    const off = out.pos.length / 3;
    for (let i = 0; i < m.pos.length; i++) out.pos.push(m.pos[i]);
    for (let i = 0; i < m.thin.length; i++) out.thin.push(m.thin[i]);
    for (let i = 0; i < m.idx.length; i++) out.idx.push(m.idx[i] + off);
    for (let i = 0; i < m.face.length; i++) out.face.push(m.face[i]);
  }
  return out;
}

export function transformMesh(m: CMesh, mat: THREE.Matrix4): void {
  const v = new THREE.Vector3();
  for (let i = 0; i < m.pos.length; i += 3) {
    v.set(m.pos[i], m.pos[i + 1], m.pos[i + 2]).applyMatrix4(mat);
    m.pos[i] = v.x;
    m.pos[i + 1] = v.y;
    m.pos[i + 2] = v.z;
  }
}

export function boundsY(m: CMesh): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < m.pos.length; i += 3) {
    if (m.pos[i] < lo) lo = m.pos[i];
    if (m.pos[i] > hi) hi = m.pos[i];
  }
  return { lo, hi };
}

export function scaleMesh(m: CMesh, s: number): void {
  for (let i = 0; i < m.pos.length; i++) m.pos[i] *= s;
}

// ---------------------------------------------------------------------------------------
// Lofting — every carved form here is a stack of polygonal cross-sections.
// ---------------------------------------------------------------------------------------

/** A cross-section ring placed in an arbitrary frame. `prof` is [across, along-up]. */
export function frameRing(
  centre: THREE.Vector3,
  fwd: THREE.Vector3,
  up: THREE.Vector3,
  prof: number[][],
): THREE.Vector3[] {
  const f = fwd.clone().normalize();
  const u = up.clone().normalize();
  const r = new THREE.Vector3().crossVectors(u, f).normalize();
  const u2 = new THREE.Vector3().crossVectors(f, r).normalize();
  return prof.map(
    ([a, b]) =>
      new THREE.Vector3(
        centre.x + r.x * a + u2.x * b,
        centre.y + r.y * a + u2.y * b,
        centre.z + r.z * a + u2.z * b,
      ),
  );
}

/** A horizontal ring: profile is [x, z] at height y. */
export function ringXZ(y: number, prof: number[][], cx = 0, cz = 0): THREE.Vector3[] {
  return prof.map(([x, z]) => new THREE.Vector3(cx + x, y, cz + z));
}

function fanCap(part: Part, ring: number[], fresh = 0): void {
  const n = ring.length;
  if (n < 3) return;
  let cx = 0, cy = 0, cz = 0;
  for (const i of ring) {
    cx += part.pos[i * 3];
    cy += part.pos[i * 3 + 1];
    cz += part.pos[i * 3 + 2];
  }
  const c = part.v(cx / n, cy / n, cz / n);
  for (let i = 0; i < n; i++) part.t(c, ring[i], ring[(i + 1) % n], fresh);
}

/** Stitch a stack of equal-length rings into a closed solid. */
export function loft(
  part: Part,
  rings: THREE.Vector3[][],
  capStart = true,
  capEnd = true,
): void {
  const ids = rings.map((r) => r.map((p) => part.vv(p)));
  const n = rings[0].length;
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      part.q(ids[k][i], ids[k][j], ids[k + 1][j], ids[k + 1][i]);
    }
  }
  if (capStart) fanCap(part, ids[0]);
  if (capEnd) fanCap(part, ids[ids.length - 1]);
}

/** An oriented rectangular block — the unit of "stepped slab" work (manes, crowns, merlons). */
export function slab(
  part: Part,
  centre: THREE.Vector3,
  half: THREE.Vector3,
  quat: THREE.Quaternion,
): void {
  const pts: THREE.Vector3[] = [];
  for (const sy of [-1, 1]) {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pts.push(
        new THREE.Vector3(half.x * sx, half.y * sy, half.z * sz)
          .applyQuaternion(quat)
          .add(centre),
      );
    }
  }
  loft(part, [pts.slice(0, 4), pts.slice(4, 8)], true, true);
}

// ---------------------------------------------------------------------------------------
// Conforming refinement. Marking is per *edge*, so neighbours always agree: no T-junctions.
// ---------------------------------------------------------------------------------------

function edgeKey(a: number, b: number): number {
  return a < b ? a * 4194304 + b : b * 4194304 + a;
}

export function subdivide(m: CMesh, maxEdge: number, maxPasses = 7): CMesh {
  let cur = m;
  for (let pass = 0; pass < maxPasses; pass++) {
    const pos = cur.pos;
    const marked = new Set<number>();
    let any = false;
    const len2 = (a: number, b: number) => {
      const dx = pos[a * 3] - pos[b * 3];
      const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
      const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    const lim2 = maxEdge * maxEdge;
    // Pass A: any edge longer than the target.
    for (let f = 0; f < cur.idx.length; f += 3) {
      const a = cur.idx[f], b = cur.idx[f + 1], c = cur.idx[f + 2];
      if (len2(a, b) > lim2) { marked.add(edgeKey(a, b)); any = true; }
      if (len2(b, c) > lim2) { marked.add(edgeKey(b, c)); any = true; }
      if (len2(c, a) > lim2) { marked.add(edgeKey(c, a)); any = true; }
    }
    if (!any) break;
    // Pass B: keep triangles from degenerating into needles — split siblings of a
    // marked long edge when they are of comparable length.
    for (let f = 0; f < cur.idx.length; f += 3) {
      const a = cur.idx[f], b = cur.idx[f + 1], c = cur.idx[f + 2];
      const e = [
        [a, b, len2(a, b)],
        [b, c, len2(b, c)],
        [c, a, len2(c, a)],
      ];
      let mx = 0;
      for (const t of e) if (t[2] > mx) mx = t[2];
      if (!marked.has(edgeKey(e[0][0], e[0][1])) &&
          !marked.has(edgeKey(e[1][0], e[1][1])) &&
          !marked.has(edgeKey(e[2][0], e[2][1]))) continue;
      for (const t of e) if (t[2] > mx * 0.5) marked.add(edgeKey(t[0], t[1]));
    }

    const out: CMesh = { pos: pos.slice(), thin: cur.thin.slice(), idx: [], face: [] };
    const mid = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const k = edgeKey(a, b);
      const got = mid.get(k);
      if (got !== undefined) return got;
      const i = out.pos.length / 3;
      out.pos.push(
        (pos[a * 3] + pos[b * 3]) * 0.5,
        (pos[a * 3 + 1] + pos[b * 3 + 1]) * 0.5,
        (pos[a * 3 + 2] + pos[b * 3 + 2]) * 0.5,
      );
      out.thin.push((cur.thin[a] + cur.thin[b]) * 0.5);
      mid.set(k, i);
      return i;
    };

    for (let f = 0; f < cur.idx.length; f += 3) {
      const a = cur.idx[f], b = cur.idx[f + 1], c = cur.idx[f + 2];
      const fv = cur.face[f / 3];
      const e0 = marked.has(edgeKey(a, b));
      const e1 = marked.has(edgeKey(b, c));
      const e2 = marked.has(edgeKey(c, a));
      const push = (x: number, y: number, z: number) => {
        if (x === y || y === z || x === z) return;
        out.idx.push(x, y, z);
        out.face.push(fv);
      };
      if (!e0 && !e1 && !e2) {
        push(a, b, c);
      } else if (e0 && e1 && e2) {
        const m0 = midpoint(a, b), m1 = midpoint(b, c), m2 = midpoint(c, a);
        push(a, m0, m2); push(m0, b, m1); push(m2, m1, c); push(m0, m1, m2);
      } else if (e0 && e1) {
        const m0 = midpoint(a, b), m1 = midpoint(b, c);
        push(a, m0, m1); push(a, m1, c); push(m0, b, m1);
      } else if (e1 && e2) {
        const m1 = midpoint(b, c), m2 = midpoint(c, a);
        push(m1, c, m2); push(a, b, m1); push(a, m1, m2);
      } else if (e0 && e2) {
        const m0 = midpoint(a, b), m2 = midpoint(c, a);
        push(a, m0, m2); push(m0, b, m2); push(b, c, m2);
      } else if (e0) {
        const m0 = midpoint(a, b);
        push(a, m0, c); push(m0, b, c);
      } else if (e1) {
        const m1 = midpoint(b, c);
        push(a, b, m1); push(a, m1, c);
      } else {
        const m2 = midpoint(c, a);
        push(a, b, m2); push(m2, b, c);
      }
    }
    cur = out;
  }
  return cur;
}

// ---------------------------------------------------------------------------------------
// The break. A half-space cut with a properly capped cross-section, tagged as fresh stone.
// ---------------------------------------------------------------------------------------

/** Keep the half-space where dot(n, p) <= d. The cut face is capped and marked `freshVal`. */
export function clipMesh(
  m: CMesh,
  n: THREE.Vector3,
  d: number,
  freshVal = 1,
): CMesh {
  const nv = m.pos.length / 3;
  const s = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    s[i] = n.x * m.pos[i * 3] + n.y * m.pos[i * 3 + 1] + n.z * m.pos[i * 3 + 2] - d;
  }
  const EPS = 1e-6;
  const out = new Part();
  const cut: number[] = [];
  const px: number[] = [], py: number[] = [], pz: number[] = [], pt: number[] = [], ps: number[] = [];

  for (let f = 0; f < m.idx.length; f += 3) {
    const vi = [m.idx[f], m.idx[f + 1], m.idx[f + 2]];
    px.length = 0; py.length = 0; pz.length = 0; pt.length = 0; ps.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = vi[e], b = vi[(e + 1) % 3];
      const sa = s[a], sb = s[b];
      if (sa <= EPS) {
        px.push(m.pos[a * 3]); py.push(m.pos[a * 3 + 1]); pz.push(m.pos[a * 3 + 2]);
        pt.push(m.thin[a]); ps.push(sa);
      }
      if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
        const u = sa / (sa - sb);
        px.push(m.pos[a * 3] + (m.pos[b * 3] - m.pos[a * 3]) * u);
        py.push(m.pos[a * 3 + 1] + (m.pos[b * 3 + 1] - m.pos[a * 3 + 1]) * u);
        pz.push(m.pos[a * 3 + 2] + (m.pos[b * 3 + 2] - m.pos[a * 3 + 2]) * u);
        pt.push(m.thin[a] + (m.thin[b] - m.thin[a]) * u);
        ps.push(0);
      }
    }
    const cnt = px.length;
    if (cnt < 3) continue;
    const ids: number[] = [];
    for (let k = 0; k < cnt; k++) {
      out.thinNow = pt[k];
      ids.push(out.v(px[k], py[k], pz[k]));
    }
    out.thinNow = 0;
    const fv = m.face[f / 3];
    for (let k = 1; k + 1 < cnt; k++) out.t(ids[0], ids[k], ids[k + 1], fv);
    for (let k = 0; k < cnt; k++) {
      const k2 = (k + 1) % cnt;
      if (Math.abs(ps[k]) <= EPS && Math.abs(ps[k2]) <= EPS && ids[k] !== ids[k2]) {
        cut.push(ids[k], ids[k2]);
      }
    }
  }

  // Cap: walk the cut boundary backwards into closed loops, fan each one.
  const next = new Map<number, number>();
  for (let i = 0; i < cut.length; i += 2) if (!next.has(cut[i + 1])) next.set(cut[i + 1], cut[i]);
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let v = start;
    for (let guard = 0; guard < 8192; guard++) {
      if (seen.has(v)) break;
      seen.add(v);
      loop.push(v);
      const nx = next.get(v);
      if (nx === undefined) break;
      v = nx;
      if (v === start) break;
    }
    if (loop.length < 3) continue;
    // Newell normal, so the cap always faces out along +n.
    let ax = 0, ay = 0, az = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
      ax += (out.pos[a + 1] - out.pos[b + 1]) * (out.pos[a + 2] + out.pos[b + 2]);
      ay += (out.pos[a + 2] - out.pos[b + 2]) * (out.pos[a] + out.pos[b]);
      az += (out.pos[a] - out.pos[b]) * (out.pos[a + 1] + out.pos[b + 1]);
    }
    const flip = ax * n.x + ay * n.y + az * n.z < 0;
    const ordered = flip ? loop.slice().reverse() : loop;
    let cx = 0, cy = 0, cz = 0;
    for (const i of ordered) {
      cx += out.pos[i * 3]; cy += out.pos[i * 3 + 1]; cz += out.pos[i * 3 + 2];
    }
    out.thinNow = 0;
    const c = out.v(cx / ordered.length, cy / ordered.length, cz / ordered.length);
    for (let i = 0; i < ordered.length; i++) {
      out.t(c, ordered[i], ordered[(i + 1) % ordered.length], freshVal);
    }
  }
  return out.mesh();
}

// ---------------------------------------------------------------------------------------
// Surface analysis: welded normals, freshness bleed, convex arris detection.
// ---------------------------------------------------------------------------------------

export interface SurfaceInfo {
  /** Area-weighted welded normal, 3 per vertex. Used as the displacement direction. */
  nrm: Float32Array;
  /** Max freshness of any face touching this vertex. */
  fresh: Float32Array;
  /** 0..1 — how much this vertex sits on a convex edge or corner (an arris). */
  arris: Float32Array;
  /** Mean length of the edges meeting this vertex. */
  scale: Float32Array;
}

export function analyse(m: CMesh): SurfaceInfo {
  const nv = m.pos.length / 3;
  const nrm = new Float32Array(nv * 3);
  const fresh = new Float32Array(nv);
  const arris = new Float32Array(nv);
  const scale = new Float32Array(nv);
  const cnt = new Float32Array(nv);
  const cen = new Float32Array(nv * 3);
  const p = m.pos;

  const fn = new Float32Array((m.idx.length / 3) * 3);
  for (let f = 0; f < m.idx.length; f += 3) {
    const a = m.idx[f] * 3, b = m.idx[f + 1] * 3, c = m.idx[f + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const t = f;
    fn[t] = nx; fn[t + 1] = ny; fn[t + 2] = nz;
    for (let k = 0; k < 3; k++) {
      const vi = m.idx[f + k];
      nrm[vi * 3] += nx; nrm[vi * 3 + 1] += ny; nrm[vi * 3 + 2] += nz;
      const fv = m.face[f / 3];
      if (fv > fresh[vi]) fresh[vi] = fv;
    }
  }
  for (let i = 0; i < nv; i++) {
    const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
  }

  // Neighbour centroid + edge scale.
  for (let f = 0; f < m.idx.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.idx[f + k], b = m.idx[f + ((k + 1) % 3)];
      const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
      const l = Math.hypot(dx, dy, dz);
      cen[a * 3] += p[b * 3]; cen[a * 3 + 1] += p[b * 3 + 1]; cen[a * 3 + 2] += p[b * 3 + 2];
      cen[b * 3] += p[a * 3]; cen[b * 3 + 1] += p[a * 3 + 1]; cen[b * 3 + 2] += p[a * 3 + 2];
      scale[a] += l; scale[b] += l;
      cnt[a]++; cnt[b]++;
    }
  }
  // Convex arris: how far the vertex stands proud of its own neighbourhood.
  for (let i = 0; i < nv; i++) {
    const c = cnt[i] || 1;
    scale[i] /= c;
    const dx = p[i * 3] - cen[i * 3] / c;
    const dy = p[i * 3 + 1] - cen[i * 3 + 1] / c;
    const dz = p[i * 3 + 2] - cen[i * 3 + 2] / c;
    const proud = dx * nrm[i * 3] + dy * nrm[i * 3 + 1] + dz * nrm[i * 3 + 2];
    const k = proud / Math.max(1e-4, scale[i] * 0.42);
    arris[i] = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  }
  return { nrm, fresh, arris, scale };
}

/** Push every vertex along its welded normal. Returns the applied offsets. */
export function displaceMesh(
  m: CMesh,
  info: SurfaceInfo,
  fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number, fresh: number, arris: number) => number,
): Float32Array {
  const nv = m.pos.length / 3;
  const out = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    const nx = info.nrm[i * 3], ny = info.nrm[i * 3 + 1], nz = info.nrm[i * 3 + 2];
    const d = fn(x, y, z, nx, ny, nz, info.fresh[i], info.arris[i]);
    out[i] = d;
    m.pos[i * 3] = x + nx * d;
    m.pos[i * 3 + 1] = y + ny * d;
    m.pos[i * 3 + 2] = z + nz * d;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Export. Non-indexed with true face normals — the flat facets ARE the chisel work.
// ---------------------------------------------------------------------------------------

export interface ShadeOut {
  r: number;
  g: number;
  b: number;
  rough: number;
}

export type Shader = (
  out: ShadeOut,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  fresh: number, thin: number, recess: number,
) => void;

export function toGeometry(
  m: CMesh,
  disp: Float32Array,
  shade: Shader,
): THREE.BufferGeometry {
  const tris = m.idx.length / 3;
  const pos = new Float32Array(tris * 9);
  const nor = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  const rgh = new Float32Array(tris * 3);
  const thn = new Float32Array(tris * 3);
  const out: ShadeOut = { r: 0, g: 0, b: 0, rough: 0.9 };
  const p = m.pos;

  for (let f = 0; f < m.idx.length; f += 3) {
    const ti = f / 3;
    const ia = m.idx[f], ib = m.idx[f + 1], ic = m.idx[f + 2];
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const fv = m.face[ti];
    const vs = [ia, ib, ic];
    for (let k = 0; k < 3; k++) {
      const vi = vs[k];
      const o = ti * 9 + k * 3;
      pos[o] = p[vi * 3]; pos[o + 1] = p[vi * 3 + 1]; pos[o + 2] = p[vi * 3 + 2];
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      shade(out, pos[o], pos[o + 1], pos[o + 2], nx, ny, nz, fv, m.thin[vi], -disp[vi]);
      col[o] = out.r; col[o + 1] = out.g; col[o + 2] = out.b;
      rgh[ti * 3 + k] = out.rough;
      thn[ti * 3 + k] = m.thin[vi];
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRough', new THREE.BufferAttribute(rgh, 1));
  g.setAttribute('aThin', new THREE.BufferAttribute(thn, 1));
  g.computeBoundingSphere();
  return g;
}

/** Vertices sitting on convex corners — candidate sites for a chip. */
export function cornerVertices(m: CMesh, info: SurfaceInfo, minArris: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < info.arris.length; i++) if (info.arris[i] >= minArris) out.push(i);
  return out;
}
