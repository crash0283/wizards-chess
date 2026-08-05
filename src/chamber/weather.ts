/**
 * PIECE: chamber — age, written per block.
 *
 * The chamber is one material with one texture atlas, so everything that varies at the
 * scale of a *block* — the middle detail scale — is carried by per-instance colour:
 *
 *   damp staining running down from the string course and out of the arch heads,
 *   salt bloom blooming out of the plinth, soot gathering in the recesses,
 *   the whole wall losing itself into unresolved darkness above the arcade.
 *
 * Working in linear multipliers around 1.0: the material carries the stone's albedo,
 * this only bends it. Nothing here reads the clock; it is a pure function of position.
 */
import * as THREE from 'three';
import { makeFbm, hashString } from '../core/rng';

export interface Weather {
  /**
   * @param u   distance along the wall, metres
   * @param v   height above the chamber floor, metres
   * @param occ 0 for a face proud of the wall, 1 for the back of a deep recess
   */
  tone(u: number, v: number, occ: number, out: THREE.Color): THREE.Color;
  /** Scalar 0..1 used to decide which blocks are missing or cracked. */
  decay(u: number, v: number): number;
}

/** Height at which the wall stops being architecture and starts being darkness. */
export const DARK_START = 8.0;
export const DARK_FULL = 12.8;

export function makeWeather(tag: string, seed: number, source: number): Weather {
  const s = (hashString(tag) ^ seed) >>> 0;
  const broad = makeFbm(s, 4, 2.03, 0.5);
  const mid = makeFbm((s ^ 0x2545f491) >>> 0, 3, 2.11, 0.5);
  const streak = makeFbm((s ^ 0x7feb352d) >>> 0, 3, 2.31, 0.62);
  const salt = makeFbm((s ^ 0x846ca68b) >>> 0, 3, 2.07, 0.5);

  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  return {
    tone(u, v, occ, out) {
      // --- base value variation, block to block and across whole reaches of wall ---
      let r = 1 + 0.26 * broad(u * 0.085, v * 0.075, 4.1) + 0.21 * mid(u * 0.62, v * 0.55, 9.3);
      let g = r;
      let b = r;

      // --- damp, running DOWN from the string course and the arch heads --------------
      // Narrow vertical runs, strongest just below their source, fading as they go.
      const sv = streak(u * 1.15, v * 0.035, 17.7) + 0.5;
      const run = smooth(0.50, 0.90, sv);
      const below = smooth(source + 0.6, source - 1.2, v); // 0 above the source, 1 below
      const fade = smooth(0.4, 2.6, v); // dries out at the very bottom
      const damp = run * below * fade * (0.55 + 0.45 * mid(u * 0.9, v * 0.18, 41.0) + 0.5);
      const d = Math.max(0, Math.min(1, damp));
      r *= 1 - 0.42 * d;
      g *= 1 - 0.37 * d;
      b *= 1 - 0.33 * d;

      // --- salt bloom, wicking up out of the plinth ---------------------------------
      const wet = smooth(3.6, 0.5, v);
      const blotch = smooth(0.10, 0.62, salt(u * 0.75, v * 1.05, 63.9) + 0.5);
      const bloom = wet * blotch * 0.34;
      r += bloom * 0.86;
      g += bloom * 0.92;
      b += bloom * 1.0;

      // --- ambient occlusion by architecture: recesses, soffits, joints --------------
      const ao = 1 - 0.58 * occ;
      r *= ao;
      g *= ao;
      b *= ao;

      // --- the room loses its ceiling ------------------------------------------------
      const dark = 1 - 0.93 * smooth(DARK_START, DARK_FULL, v);
      r *= dark;
      g *= dark;
      b *= dark;

      return out.setRGB(Math.max(0.01, r), Math.max(0.01, g), Math.max(0.012, b));
    },

    decay(u, v) {
      // Decay clusters: whole patches of wall go, not scattered single blocks.
      const c = broad(u * 0.22, v * 0.19, 77.3) + 0.5;
      const f = mid(u * 1.7, v * 1.5, 88.1) + 0.5;
      return Math.max(0, Math.min(1, c * 0.62 + f * 0.55));
    },
  };
}
