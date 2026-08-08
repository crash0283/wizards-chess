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
 *   `ortho.ts`     the PLAY view's parallel projection — interactive only, never a film shot
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
import { PLAY_SHOT, getShot } from '../core/shots';
import { createBokeh } from './bokeh';
import { createOperator } from './operator';
import { createOrthoView } from './ortho';

export function createCameraRig(world: World): CameraRig {
  const cam = world.camera;
  const operator = createOperator(world.rng.fork('camera-operator').int(0, 0x7fffffff));
  const bokeh = createBokeh(world);
  const ortho = createOrthoView(world);

  // The nominal shot, held separately from the camera so the operator's offsets are
  // always applied to the frozen framing rather than accumulating on top of themselves.
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  let baseFov = 40;
  let baseFocus = 0;
  let baseFstop = 2.8;
  /** True while the play view is aimed: the operator is bypassed entirely. */
  let locked = false;

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  /** Scratch for the push-in's aim point. */
  const subject = new THREE.Vector3();
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

  /**
   * The play view, switched on WHICH SHOT IS AIMED and on nothing else.
   *
   * This used to also require `!world.capturing`, and that clause was a hole rather than a
   * safety belt. `tools/capture.mjs --shot=play` is the only way the play view can be
   * rendered to a file and measured at all, and with the clause in place that render came
   * back through the PERSPECTIVE frustum — so every number ever taken off the "play frame"
   * described a picture no player has ever seen. Two rounds of highlight work were tuned
   * against it.
   *
   * The film shots need no protection from this test: their ids are not `play`, so they
   * reach exactly the code they always did. Gating on the shot id says what is meant —
   * the six judged frames are photographed, `play` is played — and it is the same test
   * `lighting/view.ts` already uses to pick the play grade, which is why the two can no
   * longer disagree about which camera is in front of the room.
   */
  function wantsOrtho(shotId: string): boolean {
    return shotId === PLAY_SHOT.id;
  }

  /**
   * The play view is LOCKED OFF, and deliberately.
   *
   * The operator — inertia, drift, correction, the flinch on an impact — is what stops the
   * six film frames reading as CG, and it stays exactly as it is for them. But a player is
   * pointing at 90-pixel targets on a board that fills the screen, and a rig that sways and
   * kicks under them is a rig that moves the thing they are aiming at. It also fights the
   * parallel projection: the whole point of orthographic here is that a piece photographs
   * identically wherever it stands, which a moving camera quietly undoes.
   *
   * So in play the pose is the identity: no sway, no drift, no shake. shake() still accepts
   * its impulse and still feeds the lighting flash — the room reacts to a blow — the LENS
   * simply does not.
   */
  const STILL = { dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, roll: 0, fovScale: 1, focusScale: 1 };
  /** Reused so a locked frame allocates nothing. */
  const held = { ...STILL };

  /**
   * The capture push-in, and why it is a FRUSTUM move rather than a camera move.
   *
   * "See them fight" is the part of the play view a locked overhead frame cannot give: two
   * men meet on one square, four metres of board across, inside a picture nineteen metres
   * wide. The obvious answer — fly the camera down to them — is the one answer this room
   * cannot take. The play build depends on where the camera stands in four separate places:
   * the parallel frustum's ceiling cut (which sections the leaning near-field piers off the
   * top of frame), the chamber's pier cutback, the height threshold that swaps the whole
   * near field to its play build, and the wall culls. Measured, a dive toward the board
   * drops that ceiling slab through the 5.2 m promotion tablets and then through a 4.55 m
   * king, and below 18 m of camera height the piers come back as black bars across White's
   * own back rank.
   *
   * Under a parallel projection none of that is necessary, because the frame's EXTENT and
   * the camera's POSITION are independent. Tightening the frustum onto the two men and
   * recentring it gives the whole push-in — they get bigger, they fill more of the screen —
   * while the eye never moves a millimetre, so every one of those four solves is untouched
   * by construction rather than by care.
   *
   * It self-terminates on elapsed time and holds no reference to the game. A lost promise,
   * an interrupted move or a reset cannot strand the frame pushed in.
   */
  /** How tight, as a multiplier on the solved frame extent. 0.5 is ortho's own floor. */
  const PUSH_K = 0.58;
  /** Ramp out, as a share of the fight's own length. */
  const PUSH_OUT = 0.7;
  let pushT0 = -1;
  let pushIn = 0.7;
  let pushHold = 0.7;
  let pushOut = 0.7;
  let pushX = 0;
  let pushZ = 0;

  /**
   * The ORBIT, and the envelope it is allowed to move in.
   *
   * The play camera's default is 50 degrees of declination looking straight down the files,
   * which shows the men as standing figures. Some positions want to be looked at more
   * obliquely than that and some want to be looked down on, so the player can swing it —
   * but not anywhere, because outside a narrow band this room stops working, and the limits
   * below are measured rather than chosen:
   *
   *   66 deg  the ceiling. Past it the ratio of a man's screen height to the rank pitch
   *           falls under 0.5 and the view is heading back into the plan drawing that an
   *           earlier 80-degree camera already proved unplayable. The near pier row and the
   *           side screens also un-cull at 63.2 and 63.3 degrees respectively, so the top of
   *           the band is where stone starts reappearing behind White.
   *   47 deg  the floor. The north wall — the one carrying the portal — culls when the eye
   *           passes z = -18.10, which at this radius is 45.9 degrees, and White's own king
   *           standing in front of his own pawn clears him by only 0.25 m of screen there.
   *           Below 40.4 degrees that clearance goes negative and the pawn is buried.
   *   +-18 deg of azimuth. The plinths of file-neighbours (a king and a bishop side by side
   *           are 2.215 m of stone against a 2.350 m file pitch) begin to overlap on screen
   *           at 19.5 degrees, and the rank and file letters are carved into the marble in
   *           WORLD space — they are cut to be read from behind White and they rotate with
   *           the board, so a large azimuth turns the board's own labelling sideways.
   *
   * The radius never changes. It is 26 m because that is how far the film camera stands
   * from the board, and the atmosphere veils quadratically with range — see PLAY_SHOT.
   */
  const ORBIT = { minDecl: 47, maxDecl: 66, maxAz: 18 };
  /**
   * The rest pose, DERIVED from PLAY_SHOT rather than written down again. The shot is the
   * one statement of where the play camera lives; a second copy here would be a second
   * thing to forget when it moves.
   */
  const { restDecl, orbitRadius } = (() => {
    const dx = PLAY_SHOT.eye[0] - PLAY_SHOT.target[0];
    const dy = PLAY_SHOT.eye[1] - PLAY_SHOT.target[1];
    const dz = PLAY_SHOT.eye[2] - PLAY_SHOT.target[2];
    const r = Math.hypot(dx, dy, dz);
    return { restDecl: (Math.asin(dy / r) * 180) / Math.PI, orbitRadius: r };
  })();
  let orbitAz = 0;
  let orbitDecl = restDecl;
  /** Which shot the rig is currently holding, so the pose is seeded once and not per frame. */
  let aimed = '';

  /** Rebuild `eye` from the orbit angles, about the shot's own target. */
  function aimOrbit() {
    const a = (orbitAz * Math.PI) / 180;
    const d = (orbitDecl * Math.PI) / 180;
    eye.set(
      target.x + orbitRadius * Math.cos(d) * Math.sin(a),
      target.y + orbitRadius * Math.sin(d),
      target.z - orbitRadius * Math.cos(d) * Math.cos(a),
    );
  }

  /**
   * 0 at rest, 1 fully pushed in. A raised-cosine either side of the hold.
   *
   * The three durations come from the CALLER, because the fight they are timing is not a
   * fixed length. game/interactive.ts stretches every phase of a capture to a minimum
   * number of measured FRAMES — a beat shorter than a frame is a beat nobody sees — so on a
   * slow renderer the poise, the strike and the follow-through all run far past their
   * nominal seconds. A camera move hard-coded at 2.3 s would be over before the blade
   * landed on exactly the machines that need it most. Measured here: on this software
   * renderer a shatter can drop the loop to about one frame a second, and at 1280x720 to
   * roughly one frame in a minute.
   */
  function pushAmount(now: number): number {
    if (pushT0 < 0) return 0;
    const age = now - pushT0;
    const total = pushIn + pushHold + pushOut;
    if (age < 0 || age >= total) { pushT0 = -1; return 0; }
    if (age < pushIn) return 0.5 - 0.5 * Math.cos((age / pushIn) * Math.PI);
    if (age < pushIn + pushHold) return 1;
    const k = (age - pushIn - pushHold) / pushOut;
    return 0.5 + 0.5 * Math.cos(k * Math.PI);
  }

  function compose(t: number, dt: number) {
    // The operator's springs are stepped EVERY frame whether or not the play view uses the
    // result — they are a physical system, and a system integrated only on the frames
    // somebody looks at is a system with a different answer.
    const full = operator.update(t, dt, baseFov);
    let pose: typeof full | typeof held = full;

    if (locked) {
      // Locked off, with one exception: the flinch. The drift, the sway and the correction
      // are what move a 90-pixel target under a player's cursor and they stay out. The blow
      // does not — a camera that does not react when a blade lands is what makes a capture
      // read as two models intersecting rather than as an impact.
      held.yaw = full.flinchYaw;
      held.pitch = full.flinchPitch;
      held.roll = full.flinchRoll;
      held.dz = full.flinchDz;
      pose = held;
    }

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
    // Under the parallel projection `fov` describes nothing, so the flinch's slight zoom
    // is handed to the frustum instead — same gesture, expressed in metres of frame rather
    // than degrees of cone. `fov` itself is still kept current above, because the game's
    // full-frame overlay sizes itself off it.
    ortho.setScale(pose.fovScale);

    // The push-in, in image-plane metres. Solved AFTER the basis above, so it tracks the
    // rig's own right/up rather than a world axis — and on `world.realTime`, because it is
    // an interactive gesture and `t` is the clamped scene clock (a frame that takes a
    // second advances `t` by at most 0.05, which would stretch a 2.3 s move to a minute).
    const amount = locked ? pushAmount(world.realTime) : 0;
    if (amount > 0) {
      subject.set(pushX, 0.9, pushZ).sub(eye);
      ortho.setFocus(subject.dot(right), subject.dot(up), 1 + (PUSH_K - 1) * amount, amount);
    } else {
      ortho.setFocus(0, 0, 1, 0);
    }

    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // focus 0 in the shot definition means "hold the subject" — measure it off the aim.
    const nominalFocus = baseFocus > 0 ? baseFocus : dist;
    bokeh.set(nominalFocus * pose.focusScale, baseFstop, cam.fov);
  }

  return {
    applyShot(shotId, _t) {
      const s = getShot(shotId);
      // Seeded on a shot CHANGE, not every frame, and that distinction is what makes an
      // orbit possible at all. main.ts calls this from inside `frame()`, so re-reading the
      // frozen eye here unconditionally — which is what it used to do — overwrites any
      // camera state sixty times a second. The film shots are unaffected either way: their
      // eye is a constant, so re-seeding it and not re-seeding it are the same thing.
      if (shotId !== aimed) {
        aimed = shotId;
        eye.set(s.eye[0], s.eye[1], s.eye[2]);
        target.set(s.target[0], s.target[1], s.target[2]);
        orbitAz = 0;
        orbitDecl = restDecl;
      }
      baseFov = s.fov;
      baseFocus = s.focus;
      baseFstop = s.fstop;
      locked = wantsOrtho(s.id);
      if (wantsOrtho(s.id)) {
        // Hand the projection the pose BEFORE installing it. The frustum extents and the
        // near plane are both solved from where the camera stands, and `enable()` only ever
        // runs its body once — so a pose delivered afterwards would never reach the near
        // plane at all.
        ortho.setPose(eye, target);
        ortho.enable();
        // f/11 already puts the circle of confusion under a pixel across the board, and a
        // parallel projection does not write the depth the gather's reconstruction assumes.
        bokeh.bypass(true);
      } else {
        ortho.disable();
        bokeh.bypass(false);
      }
      nominal();
    },

    free(spec) {
      const n = spec.split(',').map(Number);
      if (n.length < 6 || n.slice(0, 6).some((v) => !Number.isFinite(v))) return;
      // A free camera is a debug pinhole wherever it is pointed — never the play frustum.
      ortho.disable();
      bokeh.bypass(false);
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

    /**
     * A capture is about to happen on this square: push the frame onto it.
     *
     * Called at the end of the attacker's APPROACH, not at the click — an approach runs
     * anywhere from 0.65 to 9.4 seconds depending on how far the man has to walk, and a
     * push-in that started at the click would be over before the blow landed.
     *
     * Deliberately takes a bare world point and no game objects. The rig cannot ask the
     * game anything, and the game cannot leave the rig holding a reference to a man who is
     * about to be shattered.
     *
     * Ignored outside the play view: the six film shots are frozen framings and this is
     * exactly the kind of thing that must never reach them.
     */
    /**
     * Swing the play view. Degrees, relative to where it is now, clamped to the envelope.
     *
     * Ignored outside the play view, so a film shot cannot be dragged off its framing. The
     * pose is handed to the projection immediately rather than at the next `applyShot`,
     * because the frustum's extents AND its near plane are both solved from where the
     * camera stands — the near plane is the slab that sections the leaning piers off the
     * top of the picture, and it has to follow the camera or a lower angle puts it through
     * the men.
     */
    orbit(dAzDeg, dDeclDeg) {
      if (!locked) return;
      orbitAz = Math.max(-ORBIT.maxAz, Math.min(ORBIT.maxAz, orbitAz + dAzDeg));
      orbitDecl = Math.max(ORBIT.minDecl, Math.min(ORBIT.maxDecl, orbitDecl + dDeclDeg));
      aimOrbit();
      ortho.setPose(eye, target);
    },

    /** Put the play view back where it started. */
    recentre() {
      if (!locked) return;
      orbitAz = 0;
      orbitDecl = restDecl;
      aimOrbit();
      ortho.setPose(eye, target);
    },

    closeOn(x, z, fightSeconds) {
      if (!locked) return;
      pushX = x;
      pushZ = z;
      // Arrive with the blow: in over the poise and the windup, held through contact and
      // the follow-through, out over the step onto the cleared square.
      const fight = Math.max(0.3, Math.min(12, fightSeconds));
      pushIn = fight * 0.45;
      pushHold = fight * 0.55;
      pushOut = fight * PUSH_OUT;
      pushT0 = world.realTime;
    },

    update(t, dt) {
      compose(t, dt);
    },
  };
}
