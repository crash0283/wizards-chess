/**
 * PIECE: chamber — what has come off the walls and stayed there.
 *
 * Scree gathers where the floor meets the wall and piles up in the corners, thickest
 * under the places the masonry has actually lost blocks. Below that, grit: a fine
 * scatter that softens the line where the plinth lands. This is the only clutter the
 * room gets — no props, no furniture, nothing that was ever carried in.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { InstanceSink } from './sink';
import type { Weather } from './weather';

export interface ScreeLine {
  /** Start and end of the wall base in world xz. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit vector pointing into the room. */
  nx: number;
  nz: number;
  /** Local x of blocks that have fallen out of this wall, in wall parameter space. */
  losses: number[];
  /** Local x of the wall's start, so `losses` can be mapped onto the line. */
  uMin: number;
  uMax: number;
}

export function buildScree(
  sink: InstanceSink, rng: Rng, weather: Weather, lines: ScreeLine[], hi: boolean,
): void {
  const col = new THREE.Color();
  const perMetre = hi ? 3.1 : 1.4;
  const gritPerMetre = hi ? 3.4 : 1.4;

  for (const line of lines) {
    const dx = line.bx - line.ax;
    const dz = line.bz - line.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;

    // extra weight under losses, plus a general talus along the base
    const hotspots = line.losses.map((u) => (u - line.uMin) / (line.uMax - line.uMin));

    const n = Math.round(len * perMetre);
    for (let i = 0; i < n; i++) {
      let t = rng();
      // bias toward the corners and toward places the wall has lost blocks
      if (rng.bool(0.34)) t = rng.bool(0.5) ? t * t * 0.22 : 1 - t * t * 0.22;
      else if (hotspots.length && rng.bool(0.45)) {
        t = Math.max(0, Math.min(1, rng.pick(hotspots) + rng.gauss() * 0.014));
      }
      const off = 0.10 + Math.abs(rng.gauss()) * 0.52;
      const s = 0.10 + Math.pow(rng(), 2.6) * 1.05;
      const x = line.ax + ux * (t * len) + line.nx * off;
      const z = line.az + uz * (t * len) + line.nz * off;
      // Nothing may end up on the board.
      if (Math.abs(x) < 10.2 && Math.abs(z) < 10.2) continue;
      weather.tone(x * 0.7 + 91, 0.5, 0.42, col);
      col.multiplyScalar(0.88);
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(x, s * rng.float(0.20, 0.42), z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng.float(0, 6.283), rng.float(0, 6.283), rng.float(0, 6.283)),
        ),
        new THREE.Vector3(s, s * rng.float(0.5, 0.9), s * rng.float(0.7, 1.3)),
      );
      sink.add((i * 5) | 0, m, col);
    }

    const g = Math.round(len * gritPerMetre);
    for (let i = 0; i < g; i++) {
      const t = rng();
      const off = 0.12 + Math.abs(rng.gauss()) * 0.9;
      const s = 0.035 + Math.pow(rng(), 2.0) * 0.13;
      const x = line.ax + ux * (t * len) + line.nx * off;
      const z = line.az + uz * (t * len) + line.nz * off;
      if (Math.abs(x) < 10.2 && Math.abs(z) < 10.2) continue;
      weather.tone(x * 0.7 + 13, 0.4, 0.30, col);
      col.multiplyScalar(0.94);
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(x, s * 0.35, z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng.float(0, 6.283), rng.float(0, 6.283), rng.float(0, 6.283)),
        ),
        new THREE.Vector3(s, s * 0.55, s * rng.float(0.8, 1.4)),
      );
      sink.add((i * 3 + 1) | 0, m, col);
    }
  }
}
