/**
 * PIECE: pieces — quadric edge-collapse decimation. LOW TIER ONLY.
 *
 * Coarser subdivision is not a level of detail. It looked like one until it was measured:
 * a rook carved with NO refinement at all still lands at 4,900 triangles, because the
 * lofted solid itself — twenty-sided colonnettes, stepped plinth mouldings, merlons, mail
 * courses, the cross-slit visor — is where most of the triangles live. Refinement was only
 * ever half the cost, so refining less could only ever halve it.
 *
 * So the levels are decimated properly, by Garland–Heckbert quadric error metrics. That
 * matters for the LOOK, not just the count: the quadric of a vertex is the summed squared
 * distance to the planes of the faces around it, which is zero across a flat face and
 * enormous across an arris. Collapsing cheapest-first therefore eats the redundant interior
 * of flat surfaces and leaves the silhouette, the creases and the break faces standing. It
 * is the opposite behaviour to vertex clustering, which would take the visor slit out first.
 *
 * Run on the WEATHERED mesh, after displacement. The bumps then carry real quadric cost of
 * their own and survive in proportion to how much they actually change the surface, so a
 * decimated piece still reads as eroded stone rather than as a polygon model of one.
 *
 * Wholly deterministic: no randomness, no clock, fixed iteration order, and ties in the
 * heap broken by edge index so the same input always yields the same output.
 */
import type { CMesh } from './mesh';

interface Cand {
  cost: number;
  a: number;
  b: number;
  va: number;
  vb: number;
  x: number;
  y: number;
  z: number;
}

/** Binary min-heap. Ties broken on (a, b) so ordering never depends on insertion timing. */
class Heap {
  private h: Cand[] = [];
  get size() { return this.h.length; }
  private less(i: number, j: number): boolean {
    const p = this.h[i], q = this.h[j];
    if (p.cost !== q.cost) return p.cost < q.cost;
    if (p.a !== q.a) return p.a < q.a;
    return p.b < q.b;
  }
  push(c: Cand): void {
    const h = this.h;
    h.push(c);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      const t = h[i]; h[i] = h[p]; h[p] = t;
      i = p;
    }
  }
  pop(): Cand | undefined {
    const h = this.h;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length === 0) return top;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let s = i;
      if (l < h.length && this.less(l, s)) s = l;
      if (r < h.length && this.less(r, s)) s = r;
      if (s === i) break;
      const t = h[i]; h[i] = h[s]; h[s] = t;
      i = s;
    }
    return top;
  }
}

function qErr(Q: Float64Array, o: number, x: number, y: number, z: number): number {
  return (
    Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x +
    Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y +
    Q[o + 7] * z * z + 2 * Q[o + 8] * z +
    Q[o + 9]
  );
}

/**
 * Collapse `src` down to at most `targetTris` triangles.
 *
 * `disp` is the per-vertex weathering offset that toGeometry needs for the recess term; it
 * rides along through the collapses so the shading of a decimated level still knows which
 * of its surface sits in a pit and which stands proud.
 */
export function decimate(
  src: CMesh,
  disp: Float32Array,
  targetTris: number,
): { m: CMesh; disp: Float32Array } {
  const nv = src.pos.length / 3;
  const nf = src.idx.length / 3;
  if (targetTris >= nf || nf < 8) return { m: src, disp };

  const pos = Float64Array.from(src.pos);
  const thin = Float32Array.from(src.thin);
  const mail = Float32Array.from(src.mail);
  const dsp = Float32Array.from(disp);
  const fv = Int32Array.from(src.idx);
  const fdead = new Uint8Array(nf);
  const alive = new Uint8Array(nv).fill(1);
  const ver = new Int32Array(nv);
  const Q = new Float64Array(nv * 10);

  const vf: number[][] = new Array(nv);
  for (let i = 0; i < nv; i++) vf[i] = [];

  const addQuadric = (v: number, a: number, b: number, c: number, d: number, w: number) => {
    const o = v * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d;
    Q[o + 9] += w * d * d;
  };

  /** Face normal (unnormalised) and twice-area, from the current positions. */
  const faceNormal = (f: number, out: Float64Array, sa: number, sb: number, tx: number, ty: number, tz: number) => {
    let i0 = fv[f * 3], i1 = fv[f * 3 + 1], i2 = fv[f * 3 + 2];
    const px = (i: number) => (i === sa || i === sb ? tx : pos[i * 3]);
    const py = (i: number) => (i === sa || i === sb ? ty : pos[i * 3 + 1]);
    const pz = (i: number) => (i === sa || i === sb ? tz : pos[i * 3 + 2]);
    const ax = px(i0), ay = py(i0), az = pz(i0);
    const ux = px(i1) - ax, uy = py(i1) - ay, uz = pz(i1) - az;
    const vx = px(i2) - ax, vy = py(i2) - ay, vz = pz(i2) - az;
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
  };

  const nrm = new Float64Array(3);
  for (let f = 0; f < nf; f++) {
    const a = fv[f * 3], b = fv[f * 3 + 1], c = fv[f * 3 + 2];
    vf[a].push(f); vf[b].push(f); vf[c].push(f);
    faceNormal(f, nrm, -1, -1, 0, 0, 0);
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
    if (len < 1e-12) continue;
    const nx = nrm[0] / len, ny = nrm[1] / len, nz = nrm[2] / len;
    const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
    const w = len * 0.5;
    addQuadric(a, nx, ny, nz, d, w);
    addQuadric(b, nx, ny, nz, d, w);
    addQuadric(c, nx, ny, nz, d, w);
  }

  // Open edges — a clipped solid should have none, but a hole left unconstrained unzips
  // the whole mesh from its rim, so they are pinned hard.
  const edgeFaces = new Map<number, number>();
  const ekey = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (let f = 0; f < nf; f++) {
    const a = fv[f * 3], b = fv[f * 3 + 1], c = fv[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = ekey(u, v);
      edgeFaces.set(k, (edgeFaces.get(k) ?? 0) + 1);
    }
  }
  for (let f = 0; f < nf; f++) {
    const a = fv[f * 3], b = fv[f * 3 + 1], c = fv[f * 3 + 2];
    faceNormal(f, nrm, -1, -1, 0, 0, 0);
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
    if (len < 1e-12) continue;
    const fx = nrm[0] / len, fy = nrm[1] / len, fz = nrm[2] / len;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      if ((edgeFaces.get(ekey(u, v)) ?? 0) !== 1) continue;
      let ex = pos[v * 3] - pos[u * 3];
      let ey = pos[v * 3 + 1] - pos[u * 3 + 1];
      let ez = pos[v * 3 + 2] - pos[u * 3 + 2];
      const el = Math.hypot(ex, ey, ez) || 1;
      ex /= el; ey /= el; ez /= el;
      // Plane through the rim edge, perpendicular to the face.
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const d = -(nx * pos[u * 3] + ny * pos[u * 3 + 1] + nz * pos[u * 3 + 2]);
      addQuadric(u, nx, ny, nz, d, el * el * 40);
      addQuadric(v, nx, ny, nz, d, el * el * 40);
    }
  }

  /** Cheapest of the two endpoints and the midpoint. Solving the 4x4 buys nothing here. */
  const best = (a: number, b: number) => {
    const oa = a * 10, ob = b * 10;
    const cand = [
      [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]],
      [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]],
      [(pos[a * 3] + pos[b * 3]) * 0.5,
       (pos[a * 3 + 1] + pos[b * 3 + 1]) * 0.5,
       (pos[a * 3 + 2] + pos[b * 3 + 2]) * 0.5],
    ];
    let bc = Infinity, bx = cand[0][0], by = cand[0][1], bz = cand[0][2];
    for (const [x, y, z] of cand) {
      const c = qErr(Q, oa, x, y, z) + qErr(Q, ob, x, y, z);
      if (c < bc) { bc = c; bx = x; by = y; bz = z; }
    }
    return { cost: bc < 0 ? 0 : bc, x: bx, y: by, z: bz };
  };

  const heap = new Heap();
  const pushEdge = (a: number, b: number) => {
    if (a === b || !alive[a] || !alive[b]) return;
    const lo = a < b ? a : b, hihi = a < b ? b : a;
    const r = best(lo, hihi);
    heap.push({ cost: r.cost, a: lo, b: hihi, va: ver[lo], vb: ver[hihi], x: r.x, y: r.y, z: r.z });
  };

  const seeded = new Set<number>();
  for (let f = 0; f < nf; f++) {
    const a = fv[f * 3], b = fv[f * 3 + 1], c = fv[f * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = ekey(u, v);
      if (seeded.has(k)) continue;
      seeded.add(k);
      pushEdge(u, v);
    }
  }

  let faces = nf;
  const n2 = new Float64Array(3);

  while (faces > targetTris) {
    const c = heap.pop();
    if (c === undefined) break;
    const { a, b } = c;
    if (!alive[a] || !alive[b] || ver[a] !== c.va || ver[b] !== c.vb) continue;

    // Reject anything that would fold a triangle back through itself.
    let ok = true;
    for (const side of [vf[a], vf[b]]) {
      for (const f of side) {
        if (fdead[f]) continue;
        const i0 = fv[f * 3], i1 = fv[f * 3 + 1], i2 = fv[f * 3 + 2];
        const hasA = i0 === a || i1 === a || i2 === a;
        const hasB = i0 === b || i1 === b || i2 === b;
        if (hasA && hasB) continue; // dies in the collapse
        faceNormal(f, nrm, -1, -1, 0, 0, 0);
        faceNormal(f, n2, a, b, c.x, c.y, c.z);
        const l1 = Math.hypot(nrm[0], nrm[1], nrm[2]);
        const l2 = Math.hypot(n2[0], n2[1], n2[2]);
        if (l2 < 1e-13 || l1 < 1e-13) { ok = false; break; }
        const dot = (nrm[0] * n2[0] + nrm[1] * n2[1] + nrm[2] * n2[2]) / (l1 * l2);
        if (dot < 0.2) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) continue;

    // --- collapse b into a -------------------------------------------------------------
    pos[a * 3] = c.x; pos[a * 3 + 1] = c.y; pos[a * 3 + 2] = c.z;
    if (thin[b] > thin[a]) thin[a] = thin[b];
    if (mail[b] > mail[a]) mail[a] = mail[b];
    dsp[a] = (dsp[a] + dsp[b]) * 0.5;
    const oa = a * 10, ob = b * 10;
    for (let i = 0; i < 10; i++) Q[oa + i] += Q[ob + i];

    for (const f of vf[b]) {
      if (fdead[f]) continue;
      const i0 = fv[f * 3], i1 = fv[f * 3 + 1], i2 = fv[f * 3 + 2];
      const hasA = i0 === a || i1 === a || i2 === a;
      if (hasA) { fdead[f] = 1; faces--; continue; }
      if (i0 === b) fv[f * 3] = a;
      if (i1 === b) fv[f * 3 + 1] = a;
      if (i2 === b) fv[f * 3 + 2] = a;
      vf[a].push(f);
    }
    vf[b].length = 0;
    alive[b] = 0;
    ver[a]++;
    ver[b]++;

    // Re-cost the ring around the survivor.
    const ring = new Set<number>();
    const keep: number[] = [];
    for (const f of vf[a]) {
      if (fdead[f]) continue;
      keep.push(f);
      for (let k = 0; k < 3; k++) {
        const v = fv[f * 3 + k];
        if (v !== a && alive[v]) ring.add(v);
      }
    }
    vf[a] = keep;
    for (const v of ring) pushEdge(a, v);
  }

  // --- compact -------------------------------------------------------------------------
  const remap = new Int32Array(nv).fill(-1);
  const out: CMesh = { pos: [], thin: [], mail: [], idx: [], face: [] };
  const outDisp: number[] = [];
  for (let f = 0; f < nf; f++) {
    if (fdead[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = fv[f * 3 + k];
      if (remap[v] < 0) {
        remap[v] = out.pos.length / 3;
        out.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        out.thin.push(thin[v]);
        out.mail.push(mail[v]);
        outDisp.push(dsp[v]);
      }
      out.idx.push(remap[v]);
    }
    out.face.push(src.face[f]);
  }
  return { m: out, disp: Float32Array.from(outDisp) };
}
