/**
 * PIECE: pieces — damage planes, shared by both quality tiers.
 *
 * The breakage a chessman carries is a LIST OF HALF-SPACES, not a mesh operation. Pulling
 * that list out of the meshing is what makes level-of-detail possible: the same planes cut
 * the same corner off the same figure whether the solid underneath carries eleven thousand
 * triangles or four hundred, so a decimated level is the SAME broken silhouette rather than
 * a differently broken one.
 *
 * Nothing here consumes randomness except `chipPlanes`, and it consumes exactly what the
 * old inline chipper consumed, in exactly the same order.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { analyse, clipMesh, cornerVertices, type CMesh } from './mesh';

export interface Plane {
  n: THREE.Vector3;
  d: number;
}

/** Would this plane shave a corner, or amputate half the piece? Only the former is a chip. */
export function planeIsLocal(
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

/**
 * Knock chips off convex arrises. Planes are chosen up front against `m`, then returned
 * so the caller can apply them to as many resolutions of the same solid as it likes.
 */
export function chipPlanes(
  m: CMesh,
  rng: Rng,
  count: number,
  minSep: number,
  depthLo: number,
  depthHi: number,
): Plane[] {
  const info = analyse(m);
  const cands = cornerVertices(m, info, 0.44);
  if (cands.length === 0) return [];
  // Deterministic shuffle.
  for (let i = cands.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const t = cands[i]; cands[i] = cands[j]; cands[j] = t;
  }
  const taken: THREE.Vector3[] = [];
  const planes: Plane[] = [];
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
    if (!planeIsLocal(m, n, d, p, 0.014, 0.26)) continue;
    taken.push(p);
    planes.push({ n, d });
  }
  return planes;
}

export function applyPlanes(m: CMesh, planes: readonly Plane[]): CMesh {
  let out = m;
  for (const pl of planes) out = clipMesh(out, pl.n, pl.d, 1);
  return out;
}
