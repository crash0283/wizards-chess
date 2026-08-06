/**
 * PIECE: pieces — level of detail. LOW TIER ONLY.
 *
 * ONE CARVING, THREE DESCRIPTIONS OF IT
 *
 * A level is not a re-carve. The figure is lofted, refined, broken, chipped and weathered
 * exactly once, at exactly the resolution the low tier used before this existed — and the
 * levels are quadric decimations of that finished solid (see decimate.ts). So no two levels
 * can disagree about where this piece is broken, which arris is chipped off it or how it has
 * worn; crossing a threshold changes the triangle count and nothing else.
 *
 * The first thing tried here was cheaper SUBDIVISION per level, and it is worth recording
 * that it does not work: subdivision is only about half the triangles on a chessman. The
 * lofted solid itself — twenty-sided colonnettes, stepped plinth mouldings, merlons, mail
 * courses, the cross-slit visor — carries the rest, so a rook refined not at all still stood
 * at 4,900 triangles against 10,400 fully refined. Decimation reaches 940.
 *
 * WHAT ELSE THIS FILE DOES
 *
 * A pool. Two identical-type pieces on the same side do not each need their own unique
 * carve on a phone, so a handful of variants per type are carved and shared, and the
 * instances are pulled off the ranks by a per-instance yaw and a few centimetres of
 * placement so the rows still do not read as stamped.
 *
 * And a split. Body and arm are baked into ONE mesh, which halves the draw calls of every
 * piece that carries a weapon — but the arm is not merged away, because it animates: the
 * strike draws it back past the shoulder and drives it out, and the mated king lets it
 * fall. The moment an arm animation starts, the piece swaps to a body view and an arm view
 * that SHARE the merged geometry's buffers (drawRange over the same attributes, so the
 * split costs no GPU memory at all) and the arm swings on its pivot as before.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import { PIECE_HEIGHT, type PieceType } from '../core/constants';
import type { Rng } from '../core/rng';
import { buildForm } from './forms';
import {
  analyse,
  boundsY,
  displaceMesh,
  mergeMeshes,
  orientOutward,
  scaleMesh,
  subdivide,
  toGeometry,
  type CMesh,
} from './mesh';
import { applyPlanes, chipPlanes, planeIsLocal } from './carve';
import { decimate } from './decimate';
import type { Stone } from './stone';
import { makeWeather } from './weather';

export interface LodLevel {
  /** Fraction of the base carve's triangles this level keeps. 1 = the base itself. */
  ratio: number;
  /** Use this level while the piece is nearer than this many metres from the camera. */
  upTo: number;
}

/**
 * The ladder, and where the play camera actually puts things.
 *
 * The camera sits 15 m up and 21 m back, so NOTHING is ever close: white's back rank
 * measures 19.7–21.4 m out, white's pawns 22.8, black's pawns 31.8 and black's back rank
 * 32.9–33.9. A pawn therefore stands about 190 px tall on a phone, which is well under one
 * triangle per pixel even at the coarsest level here. The thresholds are placed so that all
 * three levels are in use at once across a normal board — the rank in front of you, your
 * own pawns, and the enemy half — rather than one of them being resident and never drawn.
 */
export const LOW_LODS: readonly LodLevel[] = [
  { ratio: 0.34, upTo: 24 },
  { ratio: 0.16, upTo: 32.4 },
  { ratio: 0.09, upTo: Infinity },
];

/** Never decimate a solid below this, however small a fraction is asked for. */
const MIN_TRIS = 260;
/** The arm is a blade and a gauntlet — thin things, and cheap. It is cut back gently. */
const ARM_MIN_RATIO = 0.34;

/** The level a piece is pinned to while its arm is animating — see `splitViews`. */
export const SPLIT_LEVEL = 0;

/**
 * How many distinct carves exist per type, per side.
 *
 * Pawns are eight of the sixteen men and stand in a solid row, so they get the variants.
 * The pairs (rook, knight, bishop) sit at opposite ends of the back rank behind that row,
 * 14 m apart and 30 m from the lens; one carve each, jittered, is not readable as a repeat.
 */
export const LOW_VARIANTS: Readonly<Record<PieceType, number>> = {
  pawn: 3,
  rook: 1,
  knight: 1,
  bishop: 1,
  queen: 1,
  king: 1,
};

export interface CarvedLevels {
  /** Merged body+arm, finest first. */
  levels: THREE.BufferGeometry[];
  /** Vertex count belonging to the body in each level. The arm is the tail. */
  bodyVerts: number[];
  hasArm: boolean;
  armPivot: THREE.Vector3;
  tip: THREE.Vector3;
  comY: number;
  baseHalf: number;
  /** Built on first use; shares `levels[SPLIT_LEVEL]`'s attribute buffers. */
  split: { body: THREE.BufferGeometry; arm: THREE.BufferGeometry } | null;
}

const ATTRS = ['position', 'normal', 'color', 'aRough', 'aThin', 'aMail'] as const;

/**
 * Two geometries over ONE set of buffers: the body triangles and the arm triangles of the
 * merged level. No attribute is copied, so nothing new is uploaded to the GPU and the
 * split costs bytes only in the two BufferGeometry objects themselves.
 */
export function splitViews(c: CarvedLevels): { body: THREE.BufferGeometry; arm: THREE.BufferGeometry } | null {
  if (!c.hasArm) return null;
  if (c.split) return c.split;
  const src = c.levels[SPLIT_LEVEL];
  const total = src.getAttribute('position').count;
  const bodyN = c.bodyVerts[SPLIT_LEVEL];
  const view = (start: number, count: number) => {
    const g = new THREE.BufferGeometry();
    for (const a of ATTRS) {
      const at = src.getAttribute(a);
      if (at) g.setAttribute(a, at);
    }
    g.setDrawRange(start, count);
    // Left for three.js to derive from the shared attribute — a superset of this view's
    // own extent, so culling stays conservative and a swinging arm is never popped away.
    return g;
  };
  c.split = { body: view(0, bodyN), arm: view(bodyN, total - bodyN) };
  return c.split;
}

/** Distance -> level, with a metre of hysteresis so a walking piece cannot flicker. */
export function pickLevel(dist: number, current: number, lods: readonly LodLevel[]): number {
  let want = lods.length - 1;
  for (let i = 0; i < lods.length; i++) {
    if (dist < lods[i].upTo) { want = i; break; }
  }
  if (want === current) return current;
  // Only cross a boundary once a metre past it, in whichever direction we are moving.
  const lo = current > 0 ? lods[current - 1].upTo : -Infinity;
  const hi = lods[current].upTo;
  if (dist > hi + 1 || dist < lo - 1) return want;
  return current;
}

interface OrientedPart {
  mm: CMesh;
  d: number;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Carve one figure, then decimate it down the ladder.
 *
 * The order of operations is exactly the single-resolution path — loft, refine, normalise
 * the height, take the significant break(s), chip the arrises, refine the break faces,
 * weather — run ONCE. Every level is then a quadric decimation of that finished, weathered
 * solid, which is why the levels cannot disagree about where the piece is broken or how it
 * has worn: they are the same carving, described with fewer triangles.
 */
export function carveLevels(
  world: World,
  stone: Stone,
  type: PieceType,
  key: string,
  detail: number,
  floor: number,
  lods: readonly LodLevel[],
): CarvedLevels {
  const rng = world.rng.fork(key);
  const form = buildForm(type, rng.fork('form'), detail);

  // Orient ONCE. orientOutward flips winding in place, so calling it per level would
  // hand every other level an inside-out solid.
  const bodyParts: OrientedPart[] = form.body.map((p) => {
    const mm = p.mesh();
    orientOutward(mm);
    return { mm, d: p.detail };
  });
  const armParts: OrientedPart[] | null = form.arm
    ? form.arm.map((p) => {
        const mm = p.mesh();
        orientOutward(mm);
        return { mm, d: p.detail };
      })
    : null;

  const build = (parts: OrientedPart[]) =>
    mergeMeshes(parts.map((p) => subdivide(p.mm, Math.max(floor, p.d))));

  let body = build(bodyParts);
  let arm: CMesh | null = armParts ? build(armParts) : null;

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

  // --- the significant, pre-existing break(s) ----------------------------------------
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
    const d = n.dot(p) - site.depth * s * dr.float(0.35, 1.35);
    if (!planeIsLocal(body, n, d, p, 0.045, 0.72)) continue;
    body = applyPlanes(body, [{ n, d }]);
    done++;
  }

  // --- chips and broken arrises ------------------------------------------------------
  body = applyPlanes(body, chipPlanes(body, dr, 4, 0.34, 0.010, 0.048));
  if (arm) arm = applyPlanes(arm, chipPlanes(arm, dr.fork('arm'), 2, 0.24, 0.008, 0.026));

  // Refine the raw break faces, which arrive from the clipper as coarse fans.
  body = subdivide(body, detail * 1.15);
  if (arm) arm = subdivide(arm, detail * 1.15);

  // Widest point of the plinth — the edge the piece rocks onto when it walks.
  let baseHalf = 0.5;
  for (let i = 0; i < body.pos.length; i += 3) {
    if (body.pos[i + 1] > 0.30) continue;
    const r = Math.hypot(body.pos[i], body.pos[i + 2]);
    if (r > baseHalf) baseHalf = r;
  }

  // --- weathering, once ---------------------------------------------------------------
  const weather = makeWeather(stone.spec, rng.fork('weather'), 1);
  const bodyDisp = displaceMesh(body, analyse(body), weather.displace);
  const armDisp = arm ? displaceMesh(arm, analyse(arm), weather.displace) : null;
  const baseBodyTris = body.idx.length / 3;
  const baseArmTris = arm ? arm.idx.length / 3 : 0;

  // --- and now the ladder --------------------------------------------------------------
  const levels: THREE.BufferGeometry[] = [];
  const bodyVerts: number[] = [];

  for (const lod of lods) {
    const b = decimate(body, bodyDisp, Math.max(MIN_TRIS, Math.round(baseBodyTris * lod.ratio)));
    const a = arm && armDisp
      ? decimate(arm, armDisp, Math.max(MIN_TRIS, Math.round(baseArmTris * Math.max(lod.ratio, ARM_MIN_RATIO))))
      : null;

    const bodyTris = b.m.idx.length / 3;
    // Merge AFTER the damage and the decimation: the two solids share no vertices, so
    // `analyse` welds each one exactly as it would have on its own, and the arm lands as a
    // contiguous tail that a drawRange can address.
    const union = a ? mergeMeshes([b.m, a.m]) : b.m;
    const disp = a ? concat(b.disp, a.disp) : b.disp;
    // Analyse AFTER displacement: the normals that shade the piece have to belong to the
    // weathered surface, not to the smooth one it was cut from.
    levels.push(toGeometry(union, disp, weather.shade, analyse(union)));
    bodyVerts.push(bodyTris * 3);
  }

  return {
    levels,
    bodyVerts,
    hasArm: !!armParts,
    armPivot,
    tip,
    comY,
    baseHalf,
    split: null,
  };
}

/** Per-instance placement jitter, so a pooled rank does not read as stamped. */
export function jitter(rng: Rng): { yaw: number; dx: number; dz: number } {
  return {
    yaw: rng.float(-0.115, 0.115),
    dx: rng.float(-0.085, 0.085),
    dz: rng.float(-0.075, 0.075),
  };
}
