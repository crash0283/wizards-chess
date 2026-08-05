/**
 * PIECE: board — the 8x8 stone floor the game is played on.
 * Round 0 placeholder. Owner may rewrite everything under src/board/.
 */
import * as THREE from 'three';
import type { Board } from '../core/api';
import type { World } from '../core/world';
import { PALETTE, SQUARE, isLightSquare, squareCentre } from '../core/constants';

export function createBoard(world: World): Board {
  const group = new THREE.Group();
  group.name = 'board';

  const light = new THREE.MeshStandardMaterial({ color: PALETTE.stoneLight, roughness: 0.92 });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.stoneDark, roughness: 0.94 });
  const geo = new THREE.BoxGeometry(SQUARE * 0.985, 0.18, SQUARE * 0.985);
  const meshes = new Map<string, THREE.Mesh>();

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const { x, z } = squareCentre(f, r);
      const m = new THREE.Mesh(geo, isLightSquare(f, r) ? light : dark);
      m.position.set(x, 0.09, z);
      m.receiveShadow = true;
      m.castShadow = false;
      group.add(m);
      meshes.set(`${f},${r}`, m);
    }
  }

  return {
    group,
    squareMesh: (f, r) => meshes.get(`${f},${r}`) ?? null,
    markImpact() {
      /* placeholder: dust deposition and scoring land here */
    },
    dispose() {
      geo.dispose();
      light.dispose();
      dark.dispose();
    },
  };
}
