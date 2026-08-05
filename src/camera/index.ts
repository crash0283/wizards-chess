/**
 * PIECE: camera — lens character, handheld weight, focus, shake.
 *
 * The round-0 rig set a position and a lookAt, and that alone was enough to mark every
 * frame in this project as CG: a locked-off pinhole with infinite depth of field is a
 * thing that does not exist. Nothing was wrong with the framing — the shots in
 * `src/core/shots.ts` are the frames, and this file does not re-aim them by a single
 * degree. What it adds is everything between the scene and the negative:
 *
 *   `lens.ts`      focus distance and f-number turned into a real circle of confusion
 *   `bokeh.ts`     that circle gathered into anamorphic bokeh, before bloom and grain
 *   `operator.ts`  a body holding the rig — inertia, drift, correction, and the flinch
 *   `noise.ts`     the broadband, non-repeating noise all of the above is driven by
 *
 * The division of labour with the lighting piece: lighting owns the GRADE — tone curve,
 * vignette, chromatic aberration, grain. This owns the GLASS and the OPERATOR. Nothing
 * here touches the composer's passes, and nothing here duplicates the grade.
 *
 * Determinism: the operator's noise is a fork of `world.rng`, everything animated is a
 * function of `world.time` and the fixed capture timestep. No clocks.
 */
import * as THREE from 'three';
import type { CameraRig } from '../core/api';
import type { World } from '../core/world';
import { getShot } from '../core/shots';
import { createBokeh } from './bokeh';
import { createOperator } from './operator';

export function createCameraRig(world: World): CameraRig {
  const cam = world.camera;
  const operator = createOperator(world.rng.fork('camera-operator').int(0, 0x7fffffff));
  const bokeh = createBokeh(world);

  // The nominal shot, held separately from the camera so the operator's offsets are
  // always applied to the frozen framing rather than accumulating on top of themselves.
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  let baseFov = 40;
  let baseFocus = 0;
  let baseFstop = 2.8;

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();

  /** Put the camera exactly on the nominal shot — no character, used as the base pose. */
  function nominal() {
    cam.position.copy(eye);
    cam.fov = baseFov;
    cam.up.copy(WORLD_UP);
    cam.updateProjectionMatrix();
    cam.lookAt(target);
  }

  function compose(t: number, dt: number) {
    const pose = operator.update(t, dt, baseFov);

    fwd.copy(target).sub(eye);
    const dist = Math.max(0.05, fwd.length());
    fwd.divideScalar(dist);
    right.crossVectors(fwd, WORLD_UP);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, fwd).normalize();

    // The rig translates as well as rotates. This is the part that cannot be faked with a
    // 2-D shake: a few millimetres of sway with the aim held on the subject moves the
    // background against the foreground, and that parallax is what says "handheld".
    pos.copy(eye)
      .addScaledVector(right, pose.dx)
      .addScaledVector(up, pose.dy)
      .addScaledVector(fwd, pose.dz);

    cam.position.copy(pos);
    cam.up.copy(WORLD_UP);
    cam.lookAt(target);
    cam.rotateY(pose.yaw);
    cam.rotateX(pose.pitch);
    cam.rotateZ(pose.roll);

    cam.fov = baseFov * pose.fovScale;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // focus 0 in the shot definition means "hold the subject" — measure it off the aim.
    const nominalFocus = baseFocus > 0 ? baseFocus : dist;
    bokeh.set(nominalFocus * pose.focusScale, baseFstop, cam.fov);
  }

  return {
    applyShot(shotId, _t) {
      const s = getShot(shotId);
      eye.set(s.eye[0], s.eye[1], s.eye[2]);
      target.set(s.target[0], s.target[1], s.target[2]);
      baseFov = s.fov;
      baseFocus = s.focus;
      baseFstop = s.fstop;
      nominal();
    },

    free(spec) {
      const n = spec.split(',').map(Number);
      if (n.length < 6 || n.slice(0, 6).some((v) => !Number.isFinite(v))) return;
      eye.set(n[0], n[1], n[2]);
      target.set(n[3], n[4], n[5]);
      if (Number.isFinite(n[6]) && n[6] > 0) baseFov = n[6];
      // A free camera has no shot definition to read a stop off; hold the subject at a
      // moderate aperture so the lens still behaves like a lens.
      baseFocus = 0;
      baseFstop = 2.8;
      nominal();
    },

    /**
     * A blade landed. Not a wobble — a whip and a settle, with the settle arriving late
     * and overshooting, because the operator corrects the correction. The impulse goes
     * into velocity and velocity integrates before position, so the strike frame itself
     * is already off-composed; a perfectly composed frame of an impact is animation.
     */
    shake(amount) {
      operator.kick(amount);
    },

    update(t, dt) {
      compose(t, dt);
    },
  };
}
