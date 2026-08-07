/**
 * PIECE: lighting — which camera is this run being lit for.
 *
 * There are two cameras in this project and they want opposite things from the rig.
 *
 * The six FILM shots are low, oblique and long-lensed. Their tone response has taken five
 * rounds to converge on the reference frames — within 0.004 of the film on median
 * luminance and 1.6 degrees on hue — and `king-surrender` has to come back bit-for-bit
 * identical every round. Nothing in this piece may change for them, ever.
 *
 * PLAY_SHOT is the one a person actually sits behind, and since this round it is
 * near-top-down: 30 m up, about 80 degrees of declination, looking straight down at a
 * polished marble plane. That is the single worst angle for this rig. The board's specular
 * mirrors whatever is directly ABOVE it into the lens — which is where the environment
 * gradient keeps its energy (COLD.envTop) and where the whole aisle rig hangs — so from
 * the play camera the marble returns the brightest part of the room over its entire
 * surface at once, on top of the diffuse level that was set for a grazing view. The film
 * shots never see that because they look ACROSS the board from 10 m, where the same stone
 * mirrors the dark horizon band instead.
 *
 * So: the play camera gets its own highlight response and its own zenith, and the film
 * path is not touched.
 *
 * WHY NOT `world.capturing`. That flag is true whenever the app is driven by
 * `?shot=&t=`, and `tools/capture.mjs --shot=play` is exactly that — it is how the play
 * view gets measured at all. Gating the play work on `capturing === false` would make the
 * play view unmeasurable, and would still leave the film shots untouched by accident
 * rather than by construction. Gating on WHICH SHOT is aimed says what is actually meant:
 * the six judged frames keep the film response, `play` and interactive get the play one.
 *
 * This mirrors main.ts's own choice of camera exactly:
 *     camera.applyShot(req.shot || (req.capturing ? 'wide-establishing' : 'play'))
 * so it can never disagree with what is in front of the lens.
 */
import type { World } from '../core/world';

export function isPlayView(world: World): boolean {
  let shot: string | null = null;
  try {
    if (typeof location !== 'undefined') {
      shot = new URLSearchParams(location.search).get('shot');
    }
  } catch {
    shot = null;
  }
  // An explicit shot id decides it. With none, main.ts uses PLAY_SHOT interactively and
  // wide-establishing under capture.
  if (shot) return shot === 'play';
  return !world.capturing;
}
