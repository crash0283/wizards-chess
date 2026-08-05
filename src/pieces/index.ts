/**
 * PIECE: pieces — the carved stone chessmen.
 *
 * Pipeline for one chessman, all of it deterministic off world.rng.fork(id):
 *
 *   forms.ts    blocky lofted solids, one Part per anatomical mass
 *   subdivide   conforming refinement to ~10 cm triangles, per part
 *   clipMesh    one or two SIGNIFICANT pre-existing breaks (an ear, a merlon, a crown
 *               point, a corner of the plinth) then 5–9 smaller chips found automatically
 *               at convex arrises. Every cut face is tagged as fresh stone.
 *   weather.ts  chisel-facet + erosion displacement, then vertex colour / roughness
 *   toGeometry  exploded to face normals — the facets are the carving
 *   stone.ts    triplanar mm-grain in normal and roughness, two genuinely different stones
 *   motion.ts   heavy grinding walk, committed strike, the king's blade falling
 *
 * Heights land exactly on PIECE_HEIGHT; the base sits on FLOOR_Y.
 */
import * as THREE from 'three';
import type { PieceFactory, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import {
  FLOOR_Y,
  PIECE_HEIGHT,
  squareCentre,
  type PieceType,
  type Side,
} from '../core/constants';
import type { Rng } from '../core/rng';
import { buildForm } from './forms';
import {
  analyse,
  boundsY,
  clipMesh,
  cornerVertices,
  displaceMesh,
  mergeMeshes,
  orientOutward,
  scaleMesh,
  subdivide,
  toGeometry,
  type CMesh,
} from './mesh';
import { createStone, type Stone } from './stone';
import { Motion } from './motion';
import { makeWeather } from './weather';

/** Would this plane shave a corner, or amputate half the piece? Only the former is a chip. */
function planeIsLocal(
  m: CMesh,
  n: THREE.Vector3,
  d: number,
  at: THREE.Vector3,
  maxFrac: number,
  maxReach: number,
): boolean {
  const nv = m.pos.length / 3;
  let cut = 0;
  const r2 = maxReach * maxReach;
  for (let i = 0; i < nv; i++) {
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    if (n.x * x + n.y * y + n.z * z - d <= 0) continue;
    cut++;
    const dx = x - at.x, dy = y - at.y, dz = z - at.z;
    if (dx * dx + dy * dy + dz * dz > r2) return false;
    if (cut > nv * maxFrac) return false;
  }
  return cut > 0;
}

/** Knock chips off convex arrises. Planes are chosen up front, then applied in sequence. */
function chip(
  m: CMesh,
  rng: Rng,
  count: number,
  minSep: number,
  depthLo: number,
  depthHi: number,
): CMesh {
  const info = analyse(m);
  const cands = cornerVertices(m, info, 0.44);
  if (cands.length === 0) return m;
  // Deterministic shuffle.
  for (let i = cands.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const t = cands[i]; cands[i] = cands[j]; cands[j] = t;
  }
  const taken: THREE.Vector3[] = [];
  const planes: Array<{ n: THREE.Vector3; d: number }> = [];
  for (const vi of cands) {
    if (planes.length >= count) break;
    const p = new THREE.Vector3(m.pos[vi * 3], m.pos[vi * 3 + 1], m.pos[vi * 3 + 2]);
    let clash = false;
    for (const t of taken) if (t.distanceToSquared(p) < minSep * minSep) { clash = true; break; }
    if (clash) continue;
    const n = new THREE.Vector3(info.nrm[vi * 3], info.nrm[vi * 3 + 1], info.nrm[vi * 3 + 2]);
    n.x += rng.float(-0.34, 0.34);
    n.y += rng.float(-0.34, 0.34);
    n.z += rng.float(-0.34, 0.34);
    if (n.lengthSq() < 1e-6) continue;
    n.normalize();
    const depth = rng.float(depthLo, depthHi);
    const d = n.dot(p) - depth;
    if (!planeIsLocal(m, n, d, p, 0.028, 0.42)) continue;
    taken.push(p);
    planes.push({ n, d });
  }
  let out = m;
  for (const pl of planes) out = clipMesh(out, pl.n, pl.d, 1);
  return out;
}

export function createPieceFactory(world: World): PieceFactory {
  const live: PieceInstance[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const stones: Record<Side, Stone> = {
    white: createStone(world, 'white'),
    black: createStone(world, 'black'),
  };
  const hi = world.quality === 'high';
  const detail = hi ? 0.105 : 0.19;

  function carve(type: PieceType, side: Side, id: string) {
    const rng = world.rng.fork(id);
    const form = buildForm(type, rng.fork('form'), detail);
    const stone = stones[side];

    let body = mergeMeshes(
      form.body.map((p) => {
        const mm = p.mesh();
        orientOutward(mm);
        return subdivide(mm, p.detail);
      }),
    );
    let arm: CMesh | null = form.arm
      ? mergeMeshes(
          form.arm.map((p) => {
            const mm = p.mesh();
            orientOutward(mm);
            return subdivide(mm, p.detail);
          }),
        )
      : null;

    // Normalise the carved height onto PIECE_HEIGHT before any damage is taken, so a
    // broken crown makes a piece shorter rather than making the contract a lie.
    let top = boundsY(body).hi;
    if (arm) top = Math.max(top, boundsY(arm).hi);
    const s = PIECE_HEIGHT[type] / top;
    scaleMesh(body, s);
    if (arm) scaleMesh(arm, s);
    const armPivot = form.armPivot.clone().multiplyScalar(s);
    const tip = form.tip.clone().multiplyScalar(s);
    const comY = form.comY * s;

    // --- the significant, pre-existing break(s) -----------------------------------
    const dr = rng.fork('damage');
    const sites = form.breaks.slice();
    for (let i = sites.length - 1; i > 0; i--) {
      const j = dr.int(0, i + 1);
      const t = sites[i]; sites[i] = sites[j]; sites[j] = t;
    }
    const nBig = dr.bool(0.35) ? 2 : 1;
    let done = 0;
    for (const site of sites) {
      if (done >= nBig) break;
      const n = site.n.clone().normalize();
      n.x += dr.float(-0.20, 0.20);
      n.y += dr.float(-0.20, 0.20);
      n.z += dr.float(-0.20, 0.20);
      n.normalize();
      const p = site.p.clone().multiplyScalar(s);
      const d = n.dot(p) - site.depth * s * dr.float(0.4, 1.8);
      if (!planeIsLocal(body, n, d, p, 0.075, 1.05)) continue;
      body = clipMesh(body, n, d, 1);
      done++;
    }

    // --- chips and broken arrises --------------------------------------------------
    body = chip(body, dr, hi ? dr.int(6, 11) : 5, 0.30, 0.014, 0.085);
    if (arm) arm = chip(arm, dr.fork('arm'), 3, 0.22, 0.010, 0.045);

    // Refine the raw break faces, which arrive from the clipper as coarse fans.
    body = subdivide(body, detail * 1.15);
    if (arm) arm = subdivide(arm, detail * 1.15);

    // --- weathering ----------------------------------------------------------------
    const weather = makeWeather(stone.spec, rng.fork('weather'), 1);
    const bi = analyse(body);
    const bd = displaceMesh(body, bi, weather.displace);
    const bodyGeo = toGeometry(body, bd, weather.shade);
    geos.push(bodyGeo);

    let armGeo: THREE.BufferGeometry | null = null;
    if (arm) {
      const ai = analyse(arm);
      const ad = displaceMesh(arm, ai, weather.displace);
      armGeo = toGeometry(arm, ad, weather.shade);
      geos.push(armGeo);
    }

    // Widest point of the plinth — the edge the piece rocks onto when it walks.
    let baseHalf = 0.5;
    for (let i = 0; i < body.pos.length; i += 3) {
      if (body.pos[i + 1] > 0.30) continue;
      const r = Math.hypot(body.pos[i], body.pos[i + 2]);
      if (r > baseHalf) baseHalf = r;
    }

    return { bodyGeo, armGeo, armPivot, tip, comY, baseHalf, stone };
  }

  function make(type: PieceType, side: Side, id: string): PieceInstance {
    const { bodyGeo, armGeo, armPivot, tip, comY, baseHalf, stone } = carve(type, side, id);

    const group = new THREE.Group();
    group.name = id;
    const bodyMesh = new THREE.Mesh(bodyGeo, stone.material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    let armNode: THREE.Object3D | null = null;
    if (armGeo) {
      armNode = new THREE.Group();
      armNode.name = `${id}-arm`;
      armNode.position.copy(armPivot);
      const am = new THREE.Mesh(armGeo, stone.material);
      am.position.copy(armPivot).multiplyScalar(-1);
      am.castShadow = true;
      am.receiveShadow = true;
      armNode.add(am);
      group.add(armNode);
    }

    const facing = side === 'white' ? 0 : Math.PI;
    const motion = new Motion(
      {
        group,
        arm: armNode,
        height: PIECE_HEIGHT[type],
        comY,
        baseHalf,
        facing,
        rng: world.rng.fork(`${id}:motion`),
        emit: (e, p) => world.emit(e, p),
        id,
      },
      armPivot,
      tip,
      armNode ? 1.35 : 0,
    );
    group.position.y = FLOOR_Y;

    const inst: PieceInstance = {
      id,
      type,
      side,
      group,
      height: PIECE_HEIGHT[type],
      destroyed: false,
      setSquare(f, r) {
        const { x, z } = squareCentre(f, r);
        motion.setSquare(x, z);
      },
      walkTo(f, r, seconds) {
        const { x, z } = squareCentre(f, r);
        return motion.walkTo(x, z, seconds, world.time);
      },
      strike(target) {
        return motion.strike(target.group.position.x, target.group.position.z, world.time);
      },
      update(t) {
        if (inst.destroyed) return;
        motion.update(t);
      },
    };
    if (type === 'king') inst.surrender = () => motion.surrender(world.time);

    live.push(inst);
    world.scene.add(group);
    return inst;
  }

  return {
    make,
    all: () => live.filter((p) => !p.destroyed),
    dispose() {
      for (const g of geos) g.dispose();
      geos.length = 0;
      stones.white.dispose();
      stones.black.dispose();
      for (const p of live) world.scene.remove(p.group);
      live.length = 0;
    },
  };
}
