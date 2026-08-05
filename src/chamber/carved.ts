/**
 * PIECE: chamber — carved stone, swept rather than laid.
 *
 * The reference frame settles an argument the earlier rounds got wrong. The walls of
 * this room are not coursed rectangular blocks with dark mortar between them. They are
 * a dense screen of large SMOOTH ROUND SHAFTS, packed almost shoulder to shoulder,
 * each one a plain cylinder with a moulded swelling at the foot and an annulet where it
 * springs — and above the springing they lean inward, over the board, and are lost.
 * There is not a visible joint anywhere on them.
 *
 * So this module sweeps rather than stacks. A shaft is a radius profile carried along a
 * path; the mesh is emitted with analytic normals and per-vertex colour and merged into
 * one buffer per screen, which is both truer to the reference and far cheaper than the
 * few thousand instanced blocks it replaces — one draw call for a whole wall.
 *
 * No texture is sampled on any of it. Smooth carved stone has nothing to sample; the
 * form does the work, per-vertex tone carries the staining and the fall into darkness,
 * and dropping the fetch buys back the frame time the screens cost.
 *
 * Determinism: every field here is a pure function of position and of an fbm forked from
 * a stable string. Nothing reads a clock.
 */
import * as THREE from 'three';

/**
 * Metres of surface per tile of the grain map. Deliberately coarse: measured against the
 * reference this render already carries more fine detail than the film and less broad
 * structure, so the grain wants to sit low in the spectrum, not high.
 */
export const GRAIN_TILE = 2.3;

/** Accumulates triangles with explicit normals, uvs and vertex colours. */
export class CarvedMesh {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];

  get triangles(): number {
    return this.pos.length / 9;
  }

  vert(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    r: number, g: number, b: number,
  ) {
    this.pos.push(px, py, pz);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(r, g, b);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A small tiling grain map for the carved stone.
 *
 * Smooth does not mean featureless: a shaft with no surface at all reads as plaster,
 * and a clean render is an instant tell. This is genuinely periodic — every octave is a
 * lattice indexed modulo its own size — so it tiles over twelve metres of shaft with
 * RepeatWrapping and never shows a seam, and it costs one fetch.
 */
export function makeGrainNormal(seed: number, size: number): THREE.Texture {
  const h = new Float32Array(size * size);

  const smoothstep = (t: number) => t * t * (3 - 2 * t);
  let s = (seed ^ 0x6d2b79f5) >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let amp = 1.0;
  let norm = 0;
  for (let o = 0, n = 4; o < 5; o++, n *= 2) {
    const lat = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lat[i] = rand();
    const step = size / n;
    for (let y = 0; y < size; y++) {
      const fy = y / step;
      const y0 = Math.floor(fy) % n;
      const y1 = (y0 + 1) % n;
      const ty = smoothstep(fy - Math.floor(fy));
      for (let x = 0; x < size; x++) {
        const fx = x / step;
        const x0 = Math.floor(fx) % n;
        const x1 = (x0 + 1) % n;
        const tx = smoothstep(fx - Math.floor(fx));
        const a = lat[y0 * n + x0] * (1 - tx) + lat[y0 * n + x1] * tx;
        const b = lat[y1 * n + x0] * (1 - tx) + lat[y1 * n + x1] * tx;
        h[y * size + x] += (a * (1 - ty) + b * ty) * amp;
      }
    }
    norm += amp;
    amp *= 0.52;
  }
  for (let i = 0; i < h.length; i++) h[i] /= norm;

  const data = new Uint8Array(size * size * 4);
  const strength = 3.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      let nx = -(h[y * size + xp] - h[y * size + xm]) * strength;
      let ny = -(h[yp * size + x] - h[ym * size + x]) * strength;
      let nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv; ny *= inv; nz *= inv;
      const o = (y * size + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }

  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** One station on a shaft's path: where the axis is, and how thick it is there. */
export interface Station {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** Per-vertex tone. `fold` is 0 on the crown of a shaft, 1 deep in the hollow beside it. */
export type Tone = (x: number, y: number, z: number, fold: number) => [number, number, number];

/**
 * Sweep a circular profile of varying radius along a path.
 *
 * `refX/refZ` is the direction the shaft's zero angle points — the way it faces into the
 * room. `arc` is how much of the circumference to emit, centred on that direction: a
 * shaft engaged in a wall only ever shows its front, and the back of one is triangles
 * nobody will see. Normals account for the radius taper, so a moulded base reads as a
 * swelling and not as a step.
 */
export function sweepShaft(
  m: CarvedMesh,
  path: Station[],
  refX: number, refZ: number,
  radial: number,
  arc: number,
  tone: Tone,
): void {
  const n = path.length;
  if (n < 2) return;

  // Path frame at each station: tangent, then the reference direction made perpendicular
  // to it, then the binormal.
  const ux: number[] = [], uy: number[] = [], uz: number[] = [];
  const vx: number[] = [], vy: number[] = [], vz: number[] = [];
  const tx: number[] = [], ty: number[] = [], tz: number[] = [];
  const drds: number[] = [];

  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    tx.push(dx); ty.push(dy); tz.push(dz);
    drds.push((b.r - a.r) / dl);

    // reference direction, projected off the tangent
    const dot = refX * dx + refZ * dz;
    let px = refX - dx * dot, py = -dy * dot, pz = refZ - dz * dot;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-5) { px = 1; py = 0; pz = 0; pl = 1; }
    px /= pl; py /= pl; pz /= pl;
    ux.push(px); uy.push(py); uz.push(pz);
    // v = t x u
    vx.push(dy * pz - dz * py);
    vy.push(dz * px - dx * pz);
    vz.push(dx * py - dy * px);
  }

  const closed = arc >= Math.PI * 2 - 1e-6;
  const cols = radial + (closed ? 0 : 1);

  // Arc length along the path, so the grain does not stretch where the shaft bends.
  const along: number[] = [0];
  for (let i = 1; i < n; i++) {
    along.push(along[i - 1]
      + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z));
  }

  // Ring cache: two rows at a time.
  const mk = () => ({
    p: new Float32Array(cols * 3), nn: new Float32Array(cols * 3),
    t: new Float32Array(cols * 2), c: new Float32Array(cols * 3),
  });
  type Row = { p: Float32Array; nn: Float32Array; t: Float32Array; c: Float32Array };
  let prev = mk();
  let cur = mk();

  const ring = (i: number, out: Row) => {
    const s = path[i];
    const dr = drds[i];
    for (let k = 0; k < cols; k++) {
      const th = -arc / 2 + (arc * k) / radial;
      const ca = Math.cos(th), sa = Math.sin(th);
      // radial direction on the surface
      const rx = ca * ux[i] + sa * vx[i];
      const ry = ca * uy[i] + sa * vy[i];
      const rz = ca * uz[i] + sa * vz[i];
      const px = s.x + s.r * rx, py = s.y + s.r * ry, pz = s.z + s.r * rz;
      // n = radial - tangent * dr/ds
      let nx = rx - tx[i] * dr, ny = ry - ty[i] * dr, nz = rz - tz[i] * dr;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // Fold: 0 on the crown of the shaft, 1 once it has turned into the hollow beside
      // it. Saturates early — two shafts a hand's breadth apart occlude each other hard
      // long before either has turned a right angle, and that occlusion is what stops a
      // row of them reading as one rippled surface.
      const fold = Math.min(1, Math.abs(th) / (Math.PI * 0.46));
      const [cr, cg, cb] = tone(px, py, pz, fold);
      const o = k * 3;
      out.p[o] = px; out.p[o + 1] = py; out.p[o + 2] = pz;
      out.nn[o] = nx; out.nn[o + 1] = ny; out.nn[o + 2] = nz;
      out.c[o] = cr; out.c[o + 1] = cg; out.c[o + 2] = cb;
      const q = k * 2;
      out.t[q] = (th * s.r) / GRAIN_TILE;
      out.t[q + 1] = along[i] / GRAIN_TILE;
    }
  };

  ring(0, prev);
  for (let i = 1; i < n; i++) {
    ring(i, cur);
    for (let k = 0; k < radial; k++) {
      const k0 = k, k1 = (k + 1) % cols;
      const put = (R: Row, j: number) => {
        const o = j * 3, q = j * 2;
        m.vert(R.p[o], R.p[o + 1], R.p[o + 2], R.nn[o], R.nn[o + 1], R.nn[o + 2],
          R.t[q], R.t[q + 1], R.c[o], R.c[o + 1], R.c[o + 2]);
      };
      put(prev, k0); put(prev, k1); put(cur, k1);
      put(prev, k0); put(cur, k1); put(cur, k0);
    }
    const t = prev; prev = cur; cur = t;
  }
}

/**
 * A flat strip lofted along a path — the web behind a screen of shafts, so the gaps
 * between them read as a deep shadowed groove and never as a hole through to nothing.
 * `along` is the direction the strip runs; the path supplies the section.
 */
export function sweepWeb(
  m: CarvedMesh,
  path: { x: number; y: number; z: number }[],
  alongX: number, alongZ: number,
  s0: number, s1: number,
  normX: number, normZ: number,
  tone: Tone,
): void {
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const v0 = run / GRAIN_TILE;
    const v1 = (run + seg) / GRAIN_TILE;
    run += seg;
    const pts: [number, number, number, number, number][] = [
      [a.x + alongX * s0, a.y, a.z + alongZ * s0, s0 / GRAIN_TILE, v0],
      [b.x + alongX * s0, b.y, b.z + alongZ * s0, s0 / GRAIN_TILE, v1],
      [b.x + alongX * s1, b.y, b.z + alongZ * s1, s1 / GRAIN_TILE, v1],
      [a.x + alongX * s1, a.y, a.z + alongZ * s1, s1 / GRAIN_TILE, v0],
    ];
    const emit = (p: [number, number, number, number, number], s: number) => {
      const [cr, cg, cb] = tone(p[0], p[1], p[2], 1);
      m.vert(p[0], p[1], p[2], normX * s, 0, normZ * s, p[3], p[4], cr, cg, cb);
    };
    // Wound both ways. A web is a backdrop seen from one side only, but which side that
    // is depends on the screen it belongs to, and a silently back-faced backdrop shows
    // as a hole straight through the room.
    emit(pts[0], 1); emit(pts[1], 1); emit(pts[2], 1);
    emit(pts[0], 1); emit(pts[2], 1); emit(pts[3], 1);
    emit(pts[0], -1); emit(pts[2], -1); emit(pts[1], -1);
    emit(pts[0], -1); emit(pts[3], -1); emit(pts[2], -1);
  }
}

/**
 * A ring moulding — a torus swept about a vertical axis. Used for the roll at the head
 * of a shaft screen and for the annulets that band a bundle of shafts together.
 */
export function ringMoulding(
  m: CarvedMesh,
  cx: number, cy: number, cz: number,
  major: number, minor: number,
  a0: number, a1: number,
  segMajor: number, segMinor: number,
  tone: Tone,
): void {
  for (let i = 0; i < segMajor; i++) {
    const p0 = a0 + ((a1 - a0) * i) / segMajor;
    const p1 = a0 + ((a1 - a0) * (i + 1)) / segMajor;
    for (let k = 0; k < segMinor; k++) {
      const t0 = (Math.PI * 2 * k) / segMinor;
      const t1 = (Math.PI * 2 * (k + 1)) / segMinor;
      const P = (p: number, t: number): number[] => {
        const rr = major + minor * Math.cos(t);
        return [
          cx + rr * Math.cos(p), cy + minor * Math.sin(t), cz + rr * Math.sin(p),
          Math.cos(t) * Math.cos(p), Math.sin(t), Math.cos(t) * Math.sin(p),
          (p * major) / GRAIN_TILE, (t * minor) / GRAIN_TILE,
        ];
      };
      const q = [P(p0, t0), P(p1, t0), P(p1, t1), P(p0, t1)];
      const emit = (v: number[]) => {
        const [cr, cg, cb] = tone(v[0], v[1], v[2], 0.5);
        m.vert(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], cr, cg, cb);
      };
      emit(q[0]); emit(q[1]); emit(q[2]);
      emit(q[0]); emit(q[2]); emit(q[3]);
    }
  }
}
