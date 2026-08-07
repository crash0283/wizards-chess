/**
 * PIECE: camera — the PLAY view's parallel projection.
 *
 * WHY THIS EXISTS. A critic measured piece identity from the play view by cropping the
 * eight men of White's back rank at 80x80 on their projected centres, normalising each
 * crop to zero mean and unit variance and taking the mean absolute difference across every
 * pair. The result came out INVERTED — same-type pairs 0.9499, different-type pairs
 * 0.8818. Two rooks looked LESS alike than a rook and a bishop.
 *
 * The carved heraldic devices were not the problem. The PROJECTION was. The play camera
 * sat on the board's centre line, so the two men of every same-type pair are related by a
 * horizontal mirror, and each man's 0.85 m of body above the plinth displaced his top by a
 * signed, antisymmetric amount: a1 +9.9 px, h1 -10.0, b1 +7.0, g1 -7.1, c1 +4.2, f1 -4.2
 * against a 94.6 px file pitch. The same-type score tracked that separation almost exactly
 * — bishops at ±4.2 px scored 0.667, rooks at ±9.9 px scored 1.007. The device collar on
 * its own measured 1.196, the most inverted region in the frame; horizontally flipping the
 * four men past the centre line turned that same annulus into 0.718. That flip is the
 * proof: what was being measured was parallax, not carving.
 *
 * A parallel projection has no parallax to measure. Under an orthographic frustum a piece
 * at a1 and the same piece at h1 photograph IDENTICALLY — same silhouette, same size, same
 * displacement of the crown over the plinth, whatever square they stand on. A device is
 * then a device wherever it is, which is the whole point of carving one.
 *
 * WHAT THIS IS NOT. It is interactive-only, and it is the play view only. The six film
 * shots are perspective and are not touched by a line of this: `applyShot` switches on the
 * shot id, so `wide-establishing` and the rest reach exactly the code they always did, and
 * under `world.capturing` this module is never enabled at all.
 *
 * HOW IT IS INSTALLED, and why it is not simply a second camera object. `World.camera` is
 * a `THREE.PerspectiveCamera` held in frozen core, and the lighting piece's `RenderPass`
 * captured THAT object at construction. Handing anything else a different camera would
 * mean reaching into another piece's code. So the projection is installed ON the world
 * camera instead: `updateProjectionMatrix` is overridden on the instance to build an
 * orthographic matrix, and the two duck-typing flags every consumer branches on are
 * swapped with it. That last part is not cosmetic — `THREE.Raycaster.setFromCamera` picks
 * its ray construction off `isOrthographicCamera`, and the game's picking goes through it.
 * A camera that projects in parallel but raycasts as a pinhole would put every click about
 * half a square away from the piece it landed on.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import { PIECE_HEIGHT, RENDER, SQUARE } from '../core/constants';
import { PLAY_SHOT } from '../core/shots';

/**
 * Height above the board that the near plane cuts through, metres — the CEILING of the
 * play view, and the single most consequential number in this file after the projection
 * itself.
 *
 * Under a perspective camera the near plane is a formality: it sits at 0.1 m, an inch in
 * front of the eye, and clips nothing that matters. Under a parallel projection it is a
 * flat slab lying across the entire picture at a constant depth, which makes it a tool
 * rather than a formality — and here it is the tool that solves a problem the projection
 * itself creates.
 *
 * The chamber's near-field piers lean seven metres in over the board, and are cut back for
 * the play view by `chamber/playview.ts`. Read that file's construction: it clears the
 * SIGHT CONE from the play eye at [0, 30, -5.2], so a shaft may lean in exactly as far as
 * the ray through it still clears the box holding the board and the men — which means the
 * heads are allowed to converge on the eye point as they rise. That is airtight for a
 * pinhole and void for a parallel projection, because a parallel projection has no eye
 * point to converge on. Worked through: the clamp permits a head at z = -8.84 at y = 13.8,
 * and a vertical ray through it lands on rank 2. Tilting does not save it either — swing
 * the projection one way and the near row falls across White, swing it the other and the
 * far row falls across Black. Rendered, it is precisely the picket fence of black bars
 * over White's back rank that playview.ts was written to remove.
 *
 * So the parallel projection cuts the fence off instead: everything hanging above the men
 * is simply not in the picture. That is not a workaround, it is what a top-down parallel
 * view IS — the room's vault is not something a player is looking at, and geometry that
 * spans the frame at a constant depth can be sectioned at a constant height. Shadows are
 * unaffected (they are cast from the lights' own cameras, not this one), so the stone that
 * is cut away still darkens the board exactly as it did.
 *
 * 7.0 m is measured at the WORST point of the board. The slab is perpendicular to the view
 * axis and the axis is tilted about 8.8° off vertical, so the cut runs from 7.0 m over
 * White's back rank to about 9.9 m over Black's; the tallest man is a 4.55 m king, which
 * leaves better than two metres of headroom everywhere for a lift, a hop or a promotion
 * tablet. Lower, and a king's crown is in danger; higher, and the piers' lean — which
 * begins at 5.15 m — starts to come back into frame.
 */
const CEILING_Y = 7.0;

/** The far plane. The chamber's deepest stone sits ~35 m from this eye; this is slack. */
const FAR = 140;

/** Margin left around the board inside the frame. */
const MARGIN = 1.05;

/**
 * What the board demands of the frame, in METRES on the camera's own image plane.
 *
 * Solved once, from the FROZEN shot's eye and target, and deliberately not re-solved
 * against the live camera: the operator's handheld drift is a fraction of a degree and its
 * flinch a little over one, and re-solving every frame would breathe the framing in time
 * with the shake. The margin covers it instead.
 *
 * A parallel projection has no distance term, so unlike the perspective fit this is a
 * straight extent of the board's own corner box — the eight corners of the board at the
 * play surface, and the same eight at the height of the tallest crown that can stand on
 * one, measured along the camera's right and up axes.
 */
const FIT = (() => {
  const eye = new THREE.Vector3(...PLAY_SHOT.eye);
  const fwd = new THREE.Vector3(...PLAY_SHOT.target).sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

  const half = SQUARE * 4;
  const crown = PIECE_HEIGHT.king;
  const v = new THREE.Vector3();
  let halfX = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0, crown]) {
        v.set(sx * half, y, sz * half).sub(eye);
        halfX = Math.max(halfX, Math.abs(v.dot(right)));
        const ty = v.dot(up);
        lo = Math.min(lo, ty);
        hi = Math.max(hi, ty);
      }
    }
  }
  /**
   * Where to put the near plane, as a distance from the eye along the view axis.
   *
   * Solved at the point of the board where the slab hangs LOWEST — the near edge, since
   * the axis tilts toward Black — so `CEILING_Y` is a floor on the headroom everywhere
   * rather than an average of it.
   *
   * It has to clear one thing that is not this piece's, and does, with room to spare: the
   * game's checkmate dim is a quad held `max(0.4, near * 4)` in front of the lens and sized
   * off `fov`, a formula that describes a size but not a scale under a parallel projection.
   * A near plane of ~22 m puts that quad ~88 m out at ~97 m across, against a 20 m frame —
   * so the overlay still covers the screen without the game piece knowing anything about
   * the projection. (It is drawn with `depthTest: false`, so only its size matters.)
   */
  const near = new THREE.Vector3(0, CEILING_Y, -half).sub(eye).dot(fwd);

  return {
    halfX: halfX * MARGIN,
    halfY: ((hi - lo) / 2) * MARGIN,
    // The board is not centred on the lens axis: the far rank's crowns push the top of the
    // band up without moving the bottom. Shifting the frustum by that difference is what
    // keeps the board in the MIDDLE of the picture instead of hard against the bottom edge.
    centreY: (hi + lo) / 2,
    near,
  };
})();

export interface OrthoView {
  /** True while the parallel projection is installed on the world camera. */
  readonly active: boolean;
  /** Install it. Idempotent. */
  enable(): void;
  /** Restore the perspective projection exactly as it was found. Idempotent. */
  disable(): void;
  /**
   * Overall frame scale, so the operator's flinch still breathes the framing the way its
   * `fovScale` does under a perspective lens. 1 = the solved fit.
   */
  setScale(scale: number): void;
  dispose(): void;
}

export function createOrthoView(world: World): OrthoView {
  // `isPerspectiveCamera` is declared readonly on the class — correct for a camera nobody
  // reprojects, and exactly what is being changed here. The two flags are widened to
  // writable booleans for this reference only.
  const cam = world.camera as Omit<THREE.PerspectiveCamera, 'isPerspectiveCamera'> & {
    isPerspectiveCamera: boolean;
    isOrthographicCamera: boolean;
    reversedDepth?: boolean;
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };

  let installed = false;
  let scale = 1;
  let savedNear = cam.near;
  let savedFar = cam.far;

  /**
   * Build the orthographic frustum for the viewport the camera currently believes in.
   *
   * main.ts owns the PERSPECTIVE aspect fit (`fitFov` there widens the vertical fov on a
   * frame narrower than the 2.39:1 reference). That mechanism has no meaning for a
   * parallel projection, so the frustum is solved here from `aspect` alone: the vertical
   * extent is whatever holds the board, opened further only if the frame is so narrow that
   * the board's WIDTH would otherwise run off the sides. From 1.3:1 to 2.4:1 the width
   * never binds, so the board holds a constant size on screen and only the room around it
   * grows and shrinks — which is exactly what a player wants and what a per-aspect zoom
   * solve does not give.
   *
   * `zoom` and `view` are deliberately ignored. The game piece solves both for the
   * perspective play camera in tangent units off the lens axis; neither quantity converts,
   * and half of the pair applied without the other would push the board off centre. This
   * module frames the board itself, so there is nothing left for them to correct.
   */
  function build() {
    const a = Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : RENDER.aspect;
    const k = Math.max(0.5, Math.min(2, scale));
    const halfH = Math.max(FIT.halfY, FIT.halfX / a) * k;
    const halfW = halfH * a;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = FIT.centreY + halfH;
    cam.bottom = FIT.centreY - halfH;
    cam.projectionMatrix.makeOrthographic(
      cam.left,
      cam.right,
      cam.top,
      cam.bottom,
      cam.near,
      cam.far,
      cam.coordinateSystem,
      cam.reversedDepth === true,
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  /**
   * The instance override. Everything in the app that changes the frame — main.ts's
   * fitFov, the game's per-frame aspect write and its zoom/view solve, the rig's own
   * compose — ends in a call to this, so there is exactly one place the projection is
   * decided and no path that can leave a stale perspective matrix behind.
   */
  const perspective = THREE.PerspectiveCamera.prototype.updateProjectionMatrix;
  function updateProjectionMatrix(this: THREE.PerspectiveCamera) {
    if (!installed) {
      perspective.call(this);
      return;
    }
    build();
  }

  return {
    get active() {
      return installed;
    },

    enable() {
      if (installed) return;
      savedNear = cam.near;
      savedFar = cam.far;
      cam.near = FIT.near;
      cam.far = FAR;
      // Duck typing is the interface here: three and every consumer in this app branch on
      // these two booleans, not on the class. Swapping them is what makes the raycaster
      // build a parallel pick ray, and it is what makes the board's planar reflection —
      // whose oblique near-plane clip is derived for a perspective matrix and produces
      // nonsense from a parallel one — stand down instead of drawing something wrong.
      cam.isPerspectiveCamera = false;
      cam.isOrthographicCamera = true;
      cam.updateProjectionMatrix = updateProjectionMatrix;
      installed = true;
      build();
    },

    disable() {
      if (!installed) return;
      installed = false;
      cam.near = savedNear;
      cam.far = savedFar;
      cam.isPerspectiveCamera = true;
      cam.isOrthographicCamera = false;
      delete (cam as { left?: number }).left;
      delete (cam as { right?: number }).right;
      delete (cam as { top?: number }).top;
      delete (cam as { bottom?: number }).bottom;
      // Hand the method back to the prototype rather than leaving a wrapper in place, so a
      // camera that is not in the play view is bit-for-bit the object core handed us.
      delete (cam as { updateProjectionMatrix?: () => void }).updateProjectionMatrix;
      cam.updateProjectionMatrix();
    },

    setScale(s: number) {
      scale = Number.isFinite(s) && s > 0 ? s : 1;
    },

    dispose() {
      this.disable();
    },
  };
}
