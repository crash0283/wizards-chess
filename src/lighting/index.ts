/**
 * PIECE: lighting — firelight, atmosphere, tone response, post chain.
 * Round 0 placeholder. Owner may rewrite everything under src/lighting/.
 */
import * as THREE from 'three';
import type { Board, Chamber, Lighting } from '../core/api';
import type { World } from '../core/world';
import { PALETTE } from '../core/constants';

export function createLighting(world: World, _deps: { chamber: Chamber; board: Board }): Lighting {
  const group = new THREE.Group();
  group.name = 'lighting';

  const ambient = new THREE.HemisphereLight(PALETTE.fireDeep, PALETTE.shadowFill, 0.28);
  group.add(ambient);

  const braziers: THREE.PointLight[] = [];
  const spots: Array<[number, number]> = [
    [-12.5, -14.0], [12.5, -14.0], [-12.5, 14.0], [12.5, 14.0], [0, -17.0],
  ];
  for (const [x, z] of spots) {
    const l = new THREE.PointLight(PALETTE.fireMid, 260, 46, 2);
    l.position.set(x, 1.7, z);
    l.castShadow = true;
    l.shadow.mapSize.set(world.quality === 'high' ? 1024 : 512, world.quality === 'high' ? 1024 : 512);
    l.shadow.bias = -0.0016;
    group.add(l);
    braziers.push(l);
  }

  const rng = world.rng.fork('lighting-flicker');
  const phases = braziers.map(() => rng.float(0, Math.PI * 2));

  world.onUpdate((t) => {
    braziers.forEach((l, i) => {
      const p = phases[i];
      const f =
        Math.sin(t * 7.3 + p) * 0.5 +
        Math.sin(t * 11.7 + p * 1.7) * 0.3 +
        Math.sin(t * 3.1 + p * 0.6) * 0.2;
      l.intensity = 260 * (1 + f * 0.09);
    });
  });

  return {
    group,
    render() {
      world.renderer.render(world.scene, world.camera);
    },
    setSize(w, h) {
      world.renderer.setSize(w, h, false);
    },
    flare() {
      /* placeholder: impact flash lands here */
    },
    dispose() {
      for (const l of braziers) l.dispose();
      ambient.dispose();
    },
  };
}
