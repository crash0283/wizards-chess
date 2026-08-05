/**
 * PIECE: chamber — the floor the board is set into.
 *
 * Large irregular flags, laid to broken joints, each one sitting a millimetre or two off
 * its neighbours so the floor catches raking flame-light along its joints instead of
 * reading as one polished sheet. The board's own square is left out: the board piece
 * owns that. A continuous dark slab sits underneath everything so no joint ever shows
 * the void through it.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { InstanceSink } from './sink';
import type { Weather } from './weather';

export interface FloorOpts {
  halfWidth: number;
  halfDepth: number;
  /** Half-extent of the hole left for the board. */
  boardHalf: number;
  hi: boolean;
}

export function buildFloor(
  sink: InstanceSink, rng: Rng, weather: Weather, o: FloorOpts,
): void {
  const col = new THREE.Color();
  const k = o.hi ? 1.0 : 1.4;
  const nominal = 1.45 * k;
  const joint = 0.045;
  // A little past the walls, so a camera outside the room never finds the floor's edge.
  const xLim = o.halfWidth + 2.6;
  const zLim = o.halfDepth + 2.6;

  let z = -zLim;
  let row = 0;
  while (z < zLim - 0.05) {
    const d = Math.min(nominal * rng.float(0.78, 1.3), zLim - z);
    if (d < 0.3) break;
    let x = -xLim - rng.float(0, nominal * 0.8);
    let guard = 0;
    while (x < xLim - 0.02 && guard++ < 200) {
      let w = nominal * rng.float(0.72, 1.5);
      const s = Math.max(x, -xLim);
      let e = Math.min(x + w, xLim);
      x += w;
      if (xLim - x < nominal * 0.4) {
        e = xLim;
        x = xLim;
      }
      w = e - s;
      if (w < 0.25) continue;

      const cx = (s + e) * 0.5;
      const cz = z + d * 0.5;
      // leave the board its ground
      if (Math.abs(cx) < o.boardHalf + w * 0.5 && Math.abs(cz) < o.boardHalf + d * 0.5) continue;

      // Flags darken and grit up as they approach the walls; the middle of the room is
      // scoured by traffic and reads a shade lighter.
      const edge = Math.max(Math.abs(cx) / o.halfWidth, Math.abs(cz) / o.halfDepth);
      const occ = Math.max(0, Math.min(0.55, (edge - 0.62) * 1.5));
      weather.tone(cx * 0.8 + 41.0, 0.9 + cz * 0.06, occ, col);
      col.multiplyScalar(0.40);

      // The flag lies in the xz-plane: rotate the block face (which points +z) up to +y.
      sink.block(
        (row * 7 + guard * 3) | 0,
        cx, -0.004 + rng.float(-0.014, 0.010), cz,
        w - joint, d - joint, 0.55,
        -Math.PI / 2 + rng.float(-0.006, 0.006), rng.float(-0.005, 0.005), rng.float(-0.008, 0.008),
        col,
      );
    }
    z += d;
    row++;
  }
}

/** The slab under the flags — nothing more than a guarantee of no holes. */
export function buildFloorSlab(halfWidth: number, halfDepth: number): {
  mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material;
} {
  const geometry = new THREE.PlaneGeometry((halfWidth + 5) * 2, (halfDepth + 5) * 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 1.0, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.34;
  mesh.receiveShadow = true;
  mesh.name = 'chamber-floor-slab';
  return { mesh, geometry, material };
}
