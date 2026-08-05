/**
 * PIECE: chamber — the great portal, and the dark it leads into.
 *
 * Concentric orders stepping inward around a black opening: outermost order flush with
 * the wall face, each inner order set back and struck on a smaller radius, so the whole
 * thing reads as thickness rather than as a shape cut out of a plane. Past the innermost
 * order the passage runs back four metres to a door carrying a geometric relief. Nothing
 * in there is lit. That is what makes it an entrance and not a decoration.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { InstanceSink } from './sink';
import type { Weather } from './weather';
import { BACK_Z } from './wall';

export interface PortalSpec {
  centre: number;
  /** Clear half-width of the opening. */
  half: number;
  spring: number;
  /** Local x limits of the bay this portal sits in. */
  bayU0: number;
  bayU1: number;
  wallTop: number;
}

const ORDERS = [
  { grow: 0.00, z: -1.55, ring: 0.46 },
  { grow: 0.46, z: -0.86, ring: 0.46 },
  { grow: 0.92, z: -0.17, ring: 0.52 },
];

/** Half-width of the whole portal (outermost order) at height v. */
export function portalHalfWidth(spec: PortalSpec, v: number): number {
  const o = ORDERS[ORDERS.length - 1];
  const r = spec.half + o.grow + o.ring;
  if (v <= spec.spring) return v < 0 ? 0 : r;
  const dy = v - spec.spring;
  if (dy >= r) return 0;
  return Math.sqrt(Math.max(0, r * r - dy * dy));
}

/** Lay the orders into the wall's own instance sink so they share its material. */
export function buildPortalOrders(
  sink: InstanceSink, rng: Rng, weather: Weather, spec: PortalSpec, hi: boolean,
) {
  const col = new THREE.Color();

  for (let k = 0; k < ORDERS.length; k++) {
    const o = ORDERS[k];
    const r = spec.half + o.grow;
    const occ = 0.62 - k * 0.24;
    const depth = o.z - (BACK_Z - 1.6);

    // jambs: coursed masonry up the sides of this order
    for (const s of [-1, 1]) {
      let v = 0;
      let c = 0;
      while (v < spec.spring - 0.05) {
        const ch = Math.min(rng.float(0.55, 0.78), spec.spring - v);
        if (ch < 0.2) break;
        weather.tone(spec.centre + s * r, v + ch / 2, occ, col);
        sink.block(1300 + k * 17 + c, spec.centre + s * (r + o.ring / 2), v + ch / 2,
          o.z + rng.float(-0.02, 0.03), o.ring - 0.05, ch - 0.05, depth,
          0, 0, 0, col);
        v += ch;
        c++;
      }
    }

    // arch ring
    const n = hi ? 17 : 12;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI;
      const t1 = ((i + 1) / n) * Math.PI;
      const tm = (t0 + t1) * 0.5;
      const rm = r + o.ring * 0.5;
      const x = spec.centre + Math.cos(tm) * rm;
      const y = spec.spring + Math.sin(tm) * rm;
      weather.tone(x, y, occ, col);
      sink.block(1360 + k * 23 + i, x, y, o.z + rng.float(-0.02, 0.03),
        (t1 - t0) * rm - 0.05, o.ring - 0.05, depth, 0, 0, tm - Math.PI / 2, col);
    }
  }

  // A hood mould running over the outermost arch and returning horizontally.
  const outer = ORDERS[ORDERS.length - 1];
  const rH = spec.half + outer.grow + outer.ring;
  const nH = hi ? 19 : 13;
  for (let i = 0; i < nH; i++) {
    const t0 = (i / nH) * Math.PI;
    const t1 = ((i + 1) / nH) * Math.PI;
    const tm = (t0 + t1) * 0.5;
    const rm = rH + 0.16;
    const x = spec.centre + Math.cos(tm) * rm;
    const y = spec.spring + Math.sin(tm) * rm;
    weather.tone(x, y, 0.0, col);
    sink.block(1440 + i, x, y, 0.16, (t1 - t0) * rm - 0.04, 0.30, 0.16 - BACK_Z,
      0, 0, tm - Math.PI / 2, col);
  }
  for (const s of [-1, 1]) {
    weather.tone(spec.centre + s * (rH + 0.5), spec.spring, 0.0, col);
    sink.block(1470, spec.centre + s * (rH + 0.5), spec.spring - 0.1, 0.16,
      1.0, 0.30, 0.16 - BACK_Z, 0, 0, 0, col);
  }
}

/**
 * The passage behind the opening: a black box with a relief door at the far end. Built
 * as separate meshes because none of it should take the room's stone material — the
 * whole point is that no light comes back out.
 */
export function buildPortalPassage(
  spec: PortalSpec, stone: THREE.Material, hi: boolean,
): { object: THREE.Object3D; geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const g = new THREE.Group();
  g.name = 'portal-passage';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const dark = new THREE.MeshStandardMaterial({
    color: 0x05060a, roughness: 1.0, metalness: 0, side: THREE.BackSide,
  });
  materials.push(dark);

  const inner = ORDERS[0];
  const halfW = spec.half + inner.grow;
  const top = spec.spring + halfW;
  const backZ = inner.z - 4.2;

  // side reveals + soffit + floor of the passage, inward facing
  const box = new THREE.BoxGeometry(halfW * 2, top + 1.0, 4.2);
  geometries.push(box);
  const shell = new THREE.Mesh(box, dark);
  shell.position.set(spec.centre, (top + 1.0) / 2 - 0.5, inner.z - 2.1);
  g.add(shell);

  // the door itself, set at the far end, carrying a geometric relief
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x141310, roughness: 0.86, metalness: 0 });
  materials.push(doorMat);
  const doorGeo = new THREE.BoxGeometry(halfW * 2 - 0.3, top - 0.2, 0.4);
  geometries.push(doorGeo);
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(spec.centre, (top - 0.2) / 2, backZ + 0.2);
  g.add(door);

  // relief: a diaper of lozenges, instanced
  const bossGeo = new THREE.BoxGeometry(1, 1, 1);
  geometries.push(bossGeo);
  const cols = hi ? 7 : 5;
  const rows = hi ? 9 : 6;
  const boss = new THREE.InstancedMesh(bossGeo, stone, cols * rows);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const w = (halfW * 2 - 1.0) / cols;
  const h = (top - 1.2) / rows;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      e.set(0, 0, Math.PI / 4);
      q.setFromEuler(e);
      const s = Math.min(w, h) * 0.52;
      m.compose(
        new THREE.Vector3(
          spec.centre - halfW + 0.5 + (c + 0.5) * w,
          0.6 + (r + 0.5) * h,
          backZ + 0.42,
        ),
        q,
        new THREE.Vector3(s, s, 0.16),
      );
      boss.setMatrixAt(i, m);
      col.setRGB(0.20, 0.19, 0.18);
      boss.setColorAt(i, col);
      i++;
    }
  }
  boss.instanceMatrix.needsUpdate = true;
  if (boss.instanceColor) boss.instanceColor.needsUpdate = true;
  boss.castShadow = false;
  boss.receiveShadow = false;
  g.add(boss);

  return { object: g, geometries, materials };
}
