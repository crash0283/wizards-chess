/**
 * PIECE: destruction — the cloth.
 *
 * Both reference frames put torn dark-red fabric among the stone: in `aftermath-rubble`
 * one shred is still in the air at the top of the cloud and another has already landed
 * and lies draped on the marble, and it is the only thing in the wreckage that is not
 * grey. It matters because it is the one element that says a *figure* was destroyed
 * rather than a rock: capes and tabards, torn off and thrown.
 *
 * A shred is a torn quad — jagged on all four edges, folded across its length so it
 * catches light on one face and shadows the other — and it moves nothing like stone:
 * heavy air drag, a sailing wander, and it lands flat instead of stacking.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';

export interface Shred {
  geometry: THREE.BufferGeometry;
  support: Float32Array;
  radius: number;
  volume: number;
}

/** Dull, dark, desaturated: this is stone-carved drapery, not silk. */
const CLOTH = [0x5e2721, 0x6d332a, 0x4a2320, 0x55302c] as const;

export function createFabricMaterials(): { materials: THREE.MeshStandardMaterial[]; dispose(): void } {
  const materials = CLOTH.map((hex, i) => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHex(hex, THREE.SRGBColorSpace),
      roughness: 0.94,
      metalness: 0,
      side: THREE.DoubleSide,
      dithering: true,
    });
    m.name = `torn-fabric-${i}`;
    return m;
  });
  return {
    materials,
    dispose() {
      for (const m of materials) m.dispose();
    },
  };
}

/**
 * One torn shred, centred on its own centroid, lying roughly in the XZ plane so it
 * settles draped rather than on edge.
 */
export function buildShred(rng: Rng, scale: number): Shred {
  const w = rng.float(0.15, 0.40) * scale;
  const h = rng.float(0.36, 0.95) * scale;
  const NU = 5, NV = 8;
  const pos: number[] = [];
  const nor: number[] = [];

  // Torn edges: the outline wanders, and it wanders more at the ends than the middle.
  const edge = (u: number, side: number) => {
    const t = Math.sin(u * Math.PI);
    return side * (0.5 + rng.float(-0.20, 0.14) * (1.15 - t));
  };
  const left: number[] = [], right: number[] = [];
  for (let j = 0; j <= NV; j++) {
    left.push(edge(j / NV, -1));
    right.push(edge(j / NV, 1));
  }

  // Cloth never lies flat: a fold along the length, a crumple across it, and a curl at
  // one end where it tore away. Without these it renders as a coloured kite.
  const fold = rng.float(0.16, 0.40) * scale;
  const crump = rng.float(0.30, 0.85);
  const curl = rng.float(0.25, 0.95);
  const ph = rng.float(0, 6.283);
  const ph2 = rng.float(0, 6.283);
  const pt = (i: number, j: number): THREE.Vector3 => {
    const u = i / NU;
    const v = j / NV;
    const x = (left[j] + (right[j] - left[j]) * u) * w;
    const z = (v - 0.5) * h;
    const y = Math.sin(u * Math.PI * 1.4 + ph) * fold * Math.sin(v * Math.PI)
      + Math.sin(v * Math.PI * 2.6 + ph2) * fold * crump * 0.7
      + curl * fold * (v * v) * 1.6;
    return new THREE.Vector3(x, y, z);
  };

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    e1.subVectors(q, p); e2.subVectors(r, p);
    n.crossVectors(e1, e2).normalize();
    for (const v of [p, q, r]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
    }
  };

  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      a.copy(pt(i, j)); b.copy(pt(i + 1, j)); c.copy(pt(i + 1, j + 1));
      tri(a, b, c);
      b.copy(pt(i + 1, j + 1)); c.copy(pt(i, j + 1));
      tri(a, b, c);
    }
  }

  // Centre it.
  let cx = 0, cy = 0, cz = 0;
  const n3 = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
  cx /= n3; cy /= n3; cz /= n3;
  let radius = 0;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= cz;
    radius = Math.max(radius, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  geometry.computeBoundingSphere();

  // Support points: the corners and the mid-edges are all a flat thing needs.
  const dirs: Array<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [0.7, 0.2, 0.7], [-0.7, 0.2, 0.7], [0.7, 0.2, -0.7], [-0.7, 0.2, -0.7],
    [0.7, -0.2, 0.7], [-0.7, -0.2, 0.7], [0.7, -0.2, -0.7], [-0.7, -0.2, -0.7],
    [0, 1, 0], [0, -1, 0],
  ];
  const support = new Float32Array(dirs.length * 3);
  for (let k = 0; k < dirs.length; k++) {
    const [dx, dy, dz] = dirs[k];
    let best = -Infinity, bx = 0, by = 0, bz = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const d = pos[i] * dx + pos[i + 1] * dy + pos[i + 2] * dz;
      if (d > best) { best = d; bx = pos[i]; by = pos[i + 1]; bz = pos[i + 2]; }
    }
    support[k * 3] = bx; support[k * 3 + 1] = by; support[k * 3 + 2] = bz;
  }

  return { geometry, support, radius, volume: w * h * 0.006 };
}
