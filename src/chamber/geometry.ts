/**
 * PIECE: chamber — the unit geometries every instanced thing in the room is built from.
 *
 * The middle of the three detail scales lives here: a block is not a box. Each variant
 * has a chamfered arris, a front face broken into a small relief grid, and jittered
 * corners, so a course of them has a genuinely irregular silhouette instead of a
 * ruled line. A dozen variants, instanced, is what lets the walls carry ~5000 blocks.
 *
 * Convention for a block: x,y in [-0.5,0.5] (width, height), z in [-1,0] with the FRONT
 * face at z = 0. Instances scale by (w, h, depth) and position by the front-face centre,
 * so "put a 1.4 x 0.6 block with its face on the wall plane" is one matrix.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { CellRect } from './textures';

class MeshBuf {
  pos: number[] = [];
  uv: number[] = [];

  tri(
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
  ) {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.uv.push(au, av, bu, bv, cu, cv);
  }

  quad(
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    dx: number, dy: number, dz: number, du: number, dv: number,
  ) {
    this.tri(ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv);
    this.tri(ax, ay, az, au, av, cx, cy, cz, cu, cv, dx, dy, dz, du, dv);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Map block-face coordinates in [-0.5,0.5] to a texture cell. */
function faceUV(r: CellRect, x: number, y: number): [number, number] {
  return [r.u0 + (x + 0.5) * r.du, r.v0 + (y + 0.5) * r.dv];
}

/**
 * One masonry block. `div` splits the face into a relief grid; `rough` scales how far
 * the arrises wander. Chamfer depth is deliberately generous — in a room with no hard
 * key, the chamfer is what makes an individual block legible at forty metres.
 */
export function makeBlockGeometry(rng: Rng, rect: CellRect, div: number, rough: number): THREE.BufferGeometry {
  const b = new MeshBuf();
  const c = 0.10 + rng.float(-0.025, 0.025); // chamfer inset, in unit-block terms
  const rim = -0.14; // z of the outer rim; the chamfer runs from here out to the face
  const back = -1.0;

  // Corner jitter on the outer rim: the block's silhouette against its neighbours.
  const j = () => rng.float(-0.012, 0.012) * rough;
  const rx = [-0.5 + j(), 0.5 + j()];
  const ry = [-0.5 + j(), 0.5 + j()];

  // --- front relief grid ------------------------------------------------------------
  const fx: number[] = [];
  const fy: number[] = [];
  for (let i = 0; i <= div; i++) {
    fx.push(-0.5 + c + (i / div) * (1 - 2 * c));
    fy.push(-0.5 + c + (i / div) * (1 - 2 * c));
  }
  const fz: number[][] = [];
  for (let i = 0; i <= div; i++) {
    fz.push([]);
    for (let k = 0; k <= div; k++) {
      const edge = i === 0 || k === 0 || i === div || k === div;
      fz[i].push(edge ? 0 : rng.float(-0.024, 0.009) * rough);
    }
  }
  for (let i = 0; i < div; i++) {
    for (let k = 0; k < div; k++) {
      const x0 = fx[i], x1 = fx[i + 1], y0 = fy[k], y1 = fy[k + 1];
      const [u0, v0] = faceUV(rect, x0, y0);
      const [u1, v1] = faceUV(rect, x1, y0);
      const [u2, v2] = faceUV(rect, x1, y1);
      const [u3, v3] = faceUV(rect, x0, y1);
      b.quad(
        x0, y0, fz[i][k], u0, v0,
        x1, y0, fz[i + 1][k], u1, v1,
        x1, y1, fz[i + 1][k + 1], u2, v2,
        x0, y1, fz[i][k + 1], u3, v3,
      );
    }
  }

  // --- chamfer ring: rim (z = rim, full extent) out to the face -----------------------
  const fL = fx[0], fR = fx[div], fB = fy[0], fT = fy[div];
  const uvR = (x: number, y: number) => faceUV(rect, x, y);
  const ch = (
    x0: number, y0: number, x1: number, y1: number, // face edge
    X0: number, Y0: number, X1: number, Y1: number, // rim edge
    z0: number, z1: number,
  ) => {
    const [a0, a1] = uvR(x0, y0);
    const [c0, c1] = uvR(x1, y1);
    const [d0, d1] = uvR(X1, Y1);
    const [e0, e1] = uvR(X0, Y0);
    b.quad(X0, Y0, rim, e0, e1, X1, Y1, rim, d0, d1, x1, y1, z1, c0, c1, x0, y0, z0, a0, a1);
  };
  ch(fL, fB, fR, fB, rx[0], ry[0], rx[1], ry[0], fz[0][0], fz[div][0]);            // bottom
  ch(fR, fT, fL, fT, rx[1], ry[1], rx[0], ry[1], fz[div][div], fz[0][div]);        // top
  ch(fR, fB, fR, fT, rx[1], ry[0], rx[1], ry[1], fz[div][0], fz[div][div]);        // right
  ch(fL, fT, fL, fB, rx[0], ry[1], rx[0], ry[0], fz[0][div], fz[0][0]);            // left

  // --- sides, rim back to the bed -----------------------------------------------------
  const su = (t: number) => rect.u0 + rect.du * (0.08 + 0.10 * t);
  const sv = (t: number) => rect.v0 + rect.dv * (0.10 + 0.72 * t);
  // bottom (-y)
  b.quad(rx[0], ry[0], back, su(0), sv(1), rx[1], ry[0], back, su(1), sv(1),
    rx[1], ry[0], rim, su(1), sv(0), rx[0], ry[0], rim, su(0), sv(0));
  // top (+y)
  b.quad(rx[1], ry[1], back, su(0), sv(1), rx[0], ry[1], back, su(1), sv(1),
    rx[0], ry[1], rim, su(1), sv(0), rx[1], ry[1], rim, su(0), sv(0));
  // right (+x)
  b.quad(rx[1], ry[0], back, su(0), sv(1), rx[1], ry[1], back, su(1), sv(1),
    rx[1], ry[1], rim, su(1), sv(0), rx[1], ry[0], rim, su(0), sv(0));
  // left (-x)
  b.quad(rx[0], ry[1], back, su(0), sv(1), rx[0], ry[0], back, su(1), sv(1),
    rx[0], ry[0], rim, su(1), sv(0), rx[0], ry[1], rim, su(0), sv(0));

  // --- bed (rarely seen, but a hole in a wall must not show sky) ----------------------
  b.quad(rx[1], ry[0], back, su(0), sv(0), rx[0], ry[0], back, su(1), sv(0),
    rx[0], ry[1], back, su(1), sv(1), rx[1], ry[1], back, su(0), sv(1));

  return b.build();
}

/**
 * One bay of blind arcade: two colonnettes and a semicircular head in shallow relief.
 * Unit width 1, base at y = 0, springing at y = SPRING_FRAC. Projects along +z.
 */
export function makeBlindArchGeometry(rect: CellRect, segments: number): THREE.BufferGeometry {
  const b = new MeshBuf();
  const proj = 1.0;               // scaled by the instance
  const springY = 0.52;
  const rIn = 0.34;
  const rOut = 0.50;
  const shaftW = 0.085;

  const uv = (x: number, y: number): [number, number] => [
    rect.u0 + rect.du * (0.5 + x * 0.9),
    rect.v0 + rect.dv * (0.06 + y * 0.86),
  ];

  // colonnettes at both edges of the unit
  for (const cx of [-0.5, 0.5]) {
    const x0 = cx - shaftW * 0.5;
    const x1 = cx + shaftW * 0.5;
    const [a0, a1] = uv(x0, 0);
    const [c0, c1] = uv(x1, springY);
    b.quad(x0, 0, proj, a0, a1, x1, 0, proj, c0, a1, x1, springY, proj, c0, c1, x0, springY, proj, a0, c1);
    // right face (+x)
    b.quad(x1, 0, proj, a0, a1, x1, 0, 0, c0, a1, x1, springY, 0, c0, c1, x1, springY, proj, a0, c1);
    // left face (-x)
    b.quad(x0, 0, 0, a0, a1, x0, 0, proj, c0, a1, x0, springY, proj, c0, c1, x0, springY, 0, a0, c1);
  }

  // semicircular head, an extruded half annulus
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI;
    const t1 = ((i + 1) / segments) * Math.PI;
    const p = (r: number, t: number): [number, number] => [Math.cos(t) * r, springY + Math.sin(t) * r];
    const [ax, ay] = p(rIn, t0);
    const [bx, by] = p(rIn, t1);
    const [cx2, cy2] = p(rOut, t1);
    const [dx, dy] = p(rOut, t0);
    const [au, av] = uv(ax, ay);
    const [bu, bv] = uv(bx, by);
    const [cu, cv] = uv(cx2, cy2);
    const [du, dv] = uv(dx, dy);
    // face
    b.quad(ax, ay, proj, au, av, dx, dy, proj, du, dv, cx2, cy2, proj, cu, cv, bx, by, proj, bu, bv);
    // soffit (inner edge) — this is the shadow line that makes the band read
    b.quad(ax, ay, 0, au, av, ax, ay, proj, bu, bv, bx, by, proj, cu, cv, bx, by, 0, du, dv);
    // outer edge
    b.quad(dx, dy, proj, au, av, dx, dy, 0, bu, bv, cx2, cy2, 0, cu, cv, cx2, cy2, proj, du, dv);
  }

  return b.build();
}

/** Angular rubble: an icosahedron beaten out of shape, flat-shaded. Radius ~0.5. */
export function makeChunkGeometry(rng: Rng, rect: CellRect): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = src.getAttribute('position');
  const v = new THREE.Vector3();
  const sx = rng.float(0.6, 1.5);
  const sy = rng.float(0.4, 1.1);
  const sz = rng.float(0.6, 1.5);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + rng.float(-0.36, 0.36);
    pos.setXYZ(i, v.x * sx * k, v.y * sy * k, v.z * sz * k);
  }
  const g = src.toNonIndexed();
  src.dispose();
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = rect.u0 + rect.du * (0.5 + p.getX(i) * 0.8);
    uv[i * 2 + 1] = rect.v0 + rect.dv * (0.5 + p.getZ(i) * 0.8);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * The vault: an elliptical barrel springing from the long walls and running the length
 * of the room, with a rib over every pier. Nothing in any shot resolves it — that is
 * the point. It exists so the top of frame is a real unlit ceiling and not a missing
 * polygon, and so the room has a measurable height.
 */
export function makeVaultGeometry(
  halfWidth: number, halfDepth: number, spring: number, rise: number, segs: number, lengthSegs: number,
): THREE.BufferGeometry {
  const b = new MeshBuf();
  const y = (t: number) => spring + rise * Math.sqrt(Math.max(0, 1 - t * t));
  for (let i = 0; i < segs; i++) {
    const t0 = -1 + (2 * i) / segs;
    const t1 = -1 + (2 * (i + 1)) / segs;
    const x0 = t0 * halfWidth, x1 = t1 * halfWidth;
    const y0 = y(t0), y1 = y(t1);
    for (let k = 0; k < lengthSegs; k++) {
      const z0 = -halfDepth + (2 * halfDepth * k) / lengthSegs;
      const z1 = -halfDepth + (2 * halfDepth * (k + 1)) / lengthSegs;
      // wound so the lit side faces down into the room
      b.quad(x0, y0, z0, 0, 0, x1, y1, z0, 1, 0, x1, y1, z1, 1, 1, x0, y0, z1, 0, 1);
    }
  }
  return b.build();
}
