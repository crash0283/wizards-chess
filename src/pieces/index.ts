/**
 * PIECE: pieces — the carved stone chessmen (geometry, material, motion).
 * Round 0 placeholder. Owner may rewrite everything under src/pieces/.
 */
import * as THREE from 'three';
import type { PieceFactory, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import { PALETTE, PIECE_HEIGHT, type PieceType, type Side, squareCentre } from '../core/constants';

export function createPieceFactory(world: World): PieceFactory {
  const live: PieceInstance[] = [];
  const matWhite = new THREE.MeshStandardMaterial({ color: PALETTE.stoneLight, roughness: 0.93 });
  const matBlack = new THREE.MeshStandardMaterial({ color: PALETTE.stoneDark, roughness: 0.95 });

  function silhouette(type: PieceType): THREE.BufferGeometry {
    const h = PIECE_HEIGHT[type];
    // Lathe profile — crude stand-in for real carved geometry.
    const pts: THREE.Vector2[] = [];
    const add = (r: number, y: number) => pts.push(new THREE.Vector2(r, y * h));
    add(0.86, 0.0); add(0.84, 0.05); add(0.66, 0.09); add(0.6, 0.16);
    add(0.4, 0.26); add(0.36, 0.5);
    if (type === 'pawn') { add(0.44, 0.68); add(0.5, 0.78); add(0.34, 0.9); add(0.16, 0.99); add(0, 1); }
    else if (type === 'rook') { add(0.5, 0.7); add(0.62, 0.82); add(0.62, 1.0); add(0.3, 1.0); add(0, 1.0); }
    else if (type === 'bishop') { add(0.46, 0.72); add(0.4, 0.86); add(0.24, 0.95); add(0.1, 1.0); add(0, 1.0); }
    else if (type === 'knight') { add(0.5, 0.66); add(0.56, 0.84); add(0.4, 0.96); add(0.18, 1.0); add(0, 1.0); }
    else if (type === 'queen') { add(0.46, 0.7); add(0.56, 0.84); add(0.5, 0.93); add(0.2, 1.0); add(0, 1.0); }
    else { add(0.46, 0.7); add(0.58, 0.84); add(0.5, 0.92); add(0.26, 0.98); add(0, 1.0); }
    return new THREE.LatheGeometry(pts, 28);
  }

  const geoCache = new Map<PieceType, THREE.BufferGeometry>();

  function make(type: PieceType, side: Side, id: string): PieceInstance {
    let geo = geoCache.get(type);
    if (!geo) geoCache.set(type, (geo = silhouette(type)));

    const group = new THREE.Group();
    group.name = id;
    const mesh = new THREE.Mesh(geo, side === 'white' ? matWhite : matBlack);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    group.rotation.y = side === 'white' ? 0 : Math.PI;

    let anim: { fromX: number; fromZ: number; toX: number; toZ: number; t0: number; dur: number } | null = null;

    const inst: PieceInstance = {
      id, type, side, group,
      height: PIECE_HEIGHT[type],
      destroyed: false,
      setSquare(f, r) {
        const { x, z } = squareCentre(f, r);
        group.position.set(x, 0.18, z);
      },
      async walkTo(f, r, seconds) {
        const { x, z } = squareCentre(f, r);
        anim = { fromX: group.position.x, fromZ: group.position.z, toX: x, toZ: z, t0: world.time, dur: seconds };
        await new Promise<void>((res) => setTimeout(res, 0));
      },
      async strike() {
        /* placeholder: attack animation lands here */
      },
      update(t) {
        if (!anim) return;
        const k = Math.min(1, (t - anim.t0) / anim.dur);
        const e = k * k * (3 - 2 * k);
        group.position.x = anim.fromX + (anim.toX - anim.fromX) * e;
        group.position.z = anim.fromZ + (anim.toZ - anim.fromZ) * e;
        if (k >= 1) anim = null;
      },
    };
    live.push(inst);
    world.scene.add(group);
    return inst;
  }

  return {
    make,
    all: () => live.filter((p) => !p.destroyed),
    dispose() {
      for (const g of geoCache.values()) g.dispose();
      matWhite.dispose();
      matBlack.dispose();
    },
  };
}
