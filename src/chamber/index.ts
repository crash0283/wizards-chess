/**
 * PIECE: chamber — the stone hall itself.
 * Round 0 placeholder. Owner may rewrite everything under src/chamber/.
 */
import * as THREE from 'three';
import type { Chamber } from '../core/api';
import type { World } from '../core/world';
import { CHAMBER, PALETTE } from '../core/constants';

export function createChamber(world: World): Chamber {
  const group = new THREE.Group();
  group.name = 'chamber';
  const surfaces: THREE.Object3D[] = [];

  const stone = new THREE.MeshStandardMaterial({
    color: PALETTE.stoneDark,
    roughness: 0.95,
    metalness: 0.0,
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CHAMBER.halfWidth * 2, CHAMBER.halfDepth * 2),
    stone,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  surfaces.push(floor);

  const wallGeo = new THREE.PlaneGeometry(CHAMBER.halfWidth * 2, CHAMBER.wallHeight);
  const mk = (x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(wallGeo, stone);
    m.position.set(x, CHAMBER.wallHeight / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
    surfaces.push(m);
  };
  mk(0, -CHAMBER.halfDepth, 0);
  mk(0, CHAMBER.halfDepth, Math.PI);
  mk(-CHAMBER.halfWidth, 0, Math.PI / 2);
  mk(CHAMBER.halfWidth, 0, -Math.PI / 2);

  world.scene.fog = new THREE.FogExp2(0x0a0906, 0.012);

  return {
    group,
    surfaces,
    dispose() {
      stone.dispose();
      wallGeo.dispose();
    },
  };
}
