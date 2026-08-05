/**
 * PIECE: board — dimensions and the swept surround profile.
 *
 * Everything here is derived from src/core/constants.ts. Nothing invents scale.
 *
 * Section through the near edge of the board, board centre to the left:
 *
 *        marble slab            joint          border            kerb
 *   ______________________                ____________        ________
 *   |  TOP_Y = 0.018                     |                   |  0.300
 *   |                      \___________ /                    |
 *   |                       BED_Y=0.004                     /
 *   ------------------------------------------------------/           floor y = 0
 *
 * The whole assembly sits 1.8 cm above the nominal floor plane so the mortar bed can be
 * *below* the marble and still hide the chamber's floor: a joint you can look down into
 * is the single biggest reason this reads as set-in stone rather than as tiles painted
 * on a slab. 1.8 cm on a 2.35 m square is 0.8 % — flush, at this scale.
 */
import * as THREE from 'three';
import { BOARD_SIZE } from '../core/constants';

/** Half the playing field, 9.4 m. */
export const HALF = BOARD_SIZE / 2;

/** The mortar bed: the surface you see down inside an open joint. */
export const BED_Y = 0.0085;
/** Nominal polished marble surface. Individual slabs vary a few mm either side. */
export const TOP_Y = 0.018;
/** Open joint between two slabs, before their chamfers widen it. */
export const JOINT = 0.024;
/** Chamfer running round the top edge of every slab. */
export const CHAMFER = 0.016;

/**
 * Width of the inlaid tessera band worked into the polished top of every slab, along
 * each of its four edges — the single finest detail in the reference frame.
 *
 * In the film the joint between two squares is not a plain line: a dense band of small
 * alternating light/dark tesserae runs down both sides of it, so a joint reads as
 * `marble | inlay | thin dark line | inlay | marble`. The band is worked into the slab's
 * own polished face rather than laid in a separate strip, which is both how the real
 * floor is cut and why it costs no extra geometry here: two neighbouring slabs each
 * contribute half of it and it can never z-fight with anything.
 *
 * 45 mm each side plus the 56 mm physical gap gives a 146 mm band across a joint — 6 % of
 * a 2.35 m square, which is what the reference measures.
 */
export const INLAY_W = 0.045;

/** Along-band pitch of one tessera. ~30 elements to a square edge, as in the frame. */
export const TESS_CELL = 0.0784;
/** Top of the kerb the fires burn on (lighting puts its kerb flames at y = 0.30). */
export const KERB_Y = 0.30;

/** Half-extent of the dust / impact map, in metres. Covers field, border and kerb. */
export const MAP_EXTENT = 12.4;

/** Radii, board centre outwards. */
export const R = {
  /** Outer edge of the marble field, i.e. the far side of the last joint. */
  field: HALF + JOINT / 2,
  filletIn: 9.46,
  filletOut: 9.97,
  kerbFoot: 9.99,
  kerbTopIn: 10.06,
  kerbTopOut: 11.02,
  kerbTread: 11.10,
  kerbTreadOut: 11.44,
  kerbFall: 11.54,
} as const;

export interface ProfilePoint {
  /** Distance from board centre along the outward axis. */
  r: number;
  y: number;
  /** Across-band coordinate handed to the shader. */
  u: number;
  /** Start a new smoothing group — the previous point is duplicated with a hard edge. */
  hard?: boolean;
}

const SIDES: Array<{ ox: number; oz: number; ax: number; az: number }> = [
  { ox: 0, oz: -1, ax: 1, az: 0 },
  { ox: 1, oz: 0, ax: 0, az: 1 },
  { ox: 0, oz: 1, ax: -1, az: 0 },
  { ox: -1, oz: 0, ax: 0, az: -1 },
];

/**
 * Sweep a profile around the square ring that bounds the board, mitred at the corners.
 *
 * Each of the four sides is an independent strip running corner to corner, so the
 * across-band coordinate (uv.x) and the along-band coordinate (uv.y, in metres, measured
 * from the side's own centre) are continuous per side and break cleanly at the mitres —
 * which is how real border inlay is laid.
 */
export function sweepRing(profile: ProfilePoint[], segsPerSide: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  // Expand hard edges into duplicated rings so the moulding keeps its arrises: the first
  // copy closes the previous segment, the second opens the next one.
  const rings: ProfilePoint[] = [];
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i];
    rings.push(p);
    if (p.hard && i > 0 && i < profile.length - 1) rings.push({ ...p });
  }

  for (const side of SIDES) {
    const base = pos.length / 3;
    for (let i = 0; i < rings.length; i++) {
      const p = rings[i];
      // Profile tangent, for the normal. Use neighbouring points; duplicated points
      // (hard edges) take the tangent of the segment they belong to.
      const prev = rings[Math.max(0, i - 1)];
      const next = rings[Math.min(rings.length - 1, i + 1)];
      let dr = next.r - prev.r;
      let dy = next.y - prev.y;
      if (i > 0 && rings[i - 1].r === p.r && rings[i - 1].y === p.y) {
        dr = next.r - p.r;
        dy = next.y - p.y;
      } else if (i < rings.length - 1 && rings[i + 1].r === p.r && rings[i + 1].y === p.y) {
        dr = p.r - prev.r;
        dy = p.y - prev.y;
      }
      const tl = Math.hypot(dr, dy) || 1;
      dr /= tl;
      dy /= tl;

      for (let s = 0; s <= segsPerSide; s++) {
        const v = (s / segsPerSide - 0.5) * 2 * p.r;
        pos.push(
          side.ax * v + side.ox * p.r,
          p.y,
          side.az * v + side.oz * p.r,
        );
        // Surface normal = cross(alongDir, profileTangent), with the profile tangent
        // (dr along the outward axis, dy up) mapped into this side's frame. A flat band
        // (dy = 0) therefore faces straight up; a riser faces back towards the board.
        const tx = side.ox * dr;
        const tz = side.oz * dr;
        const cx = -side.az * dy;
        const cy = side.az * tx - side.ax * tz;
        const cz = side.ax * dy;
        const cl = Math.hypot(cx, cy, cz) || 1;
        nrm.push(cx / cl, cy / cl, cz / cl);
        uvs.push(p.u, v);
      }
    }
    const stride = segsPerSide + 1;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let s = 0; s < segsPerSide; s++) {
        const a = base + i * stride + s;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

