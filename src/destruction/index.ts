/**
 * PIECE: destruction — a piece breaking apart: fracture, debris, dust, settle.
 * Round 0 placeholder. Owner may rewrite everything under src/destruction/.
 */
import * as THREE from 'three';
import type { Destruction, PieceFactory, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import { PALETTE } from '../core/constants';

interface Chunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
}

export function createDestruction(world: World, _deps: { pieces: PieceFactory }): Destruction {
  const group = new THREE.Group();
  group.name = 'destruction';
  const chunks: Chunk[] = [];
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.stoneFresh, roughness: 0.96 });
  const rng = world.rng.fork('destruction');

  world.onUpdate((_t, dt) => {
    for (const c of chunks) {
      if (c.resting) continue;
      c.vel.y -= 9.81 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y <= 0.2) {
        c.mesh.position.y = 0.2;
        c.vel.multiplyScalar(0.32);
        c.vel.y = Math.abs(c.vel.y) * 0.18;
        c.spin.multiplyScalar(0.4);
        if (c.vel.length() < 0.35) c.resting = true;
      }
    }
  });

  return {
    group,
    shatter(target: PieceInstance, impact: THREE.Vector3, force: number) {
      if (target.destroyed) return;
      target.destroyed = true;
      target.group.visible = false;
      const origin = target.group.position;
      const n = world.quality === 'high' ? 46 : 22;
      for (let i = 0; i < n; i++) {
        const s = rng.float(0.12, 0.62);
        const g = new THREE.BoxGeometry(s, s * rng.float(0.6, 1.4), s * rng.float(0.6, 1.4));
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.position.set(
          origin.x + rng.float(-0.5, 0.5),
          rng.float(0.3, target.height * 0.85),
          origin.z + rng.float(-0.5, 0.5),
        );
        group.add(m);
        chunks.push({
          mesh: m,
          vel: new THREE.Vector3(
            impact.x * force * rng.float(0.3, 1.1) + rng.gauss() * 0.8,
            rng.float(1.5, 6.0),
            impact.z * force * rng.float(0.3, 1.1) + rng.gauss() * 0.8,
          ),
          spin: new THREE.Vector3(rng.gauss() * 6, rng.gauss() * 6, rng.gauss() * 6),
          resting: false,
        });
      }
    },
    settled: () => chunks.every((c) => c.resting),
    dispose() {
      for (const c of chunks) (c.mesh.geometry as THREE.BufferGeometry).dispose();
      mat.dispose();
    },
  };
}
