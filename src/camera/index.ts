/**
 * PIECE: camera — lens character, handheld weight, focus, shake, film response.
 * Round 0 placeholder. Owner may rewrite everything under src/camera/.
 */
import * as THREE from 'three';
import type { CameraRig } from '../core/api';
import type { World } from '../core/world';
import { getShot } from '../core/shots';

export function createCameraRig(world: World): CameraRig {
  const cam = world.camera;
  const tmp = new THREE.Vector3();

  return {
    applyShot(shotId, _t) {
      const s = getShot(shotId);
      cam.position.set(s.eye[0], s.eye[1], s.eye[2]);
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
      cam.lookAt(tmp.set(s.target[0], s.target[1], s.target[2]));
    },
    free(spec) {
      const n = spec.split(',').map(Number);
      if (n.length < 6 || n.some((v) => !Number.isFinite(v))) return;
      cam.position.set(n[0], n[1], n[2]);
      if (n[6]) {
        cam.fov = n[6];
        cam.updateProjectionMatrix();
      }
      cam.lookAt(tmp.set(n[3], n[4], n[5]));
    },
    shake() {
      /* placeholder: handheld impulse lands here */
    },
    update() {
      /* placeholder: handheld drift + focus breathing land here */
    },
  };
}
