/**
 * PIECE: board — is this run being drawn for the PLAY camera or for a judged film frame.
 *
 * The board carries two things that exist only for a person sitting behind White: the
 * carved rank-and-file marks cut into the border band, and the wider band they are cut
 * into. Neither appears in any reference frame, so neither may reach a capture.
 *
 * WHY NOT a bare `world.capturing === false`. That flag is true whenever the app is driven
 * by `?shot=&t=`, and `tools/capture.mjs --shot=play` is exactly that — it is the only way
 * this work can be rendered and looked at on a box with no GPU. Gating on `capturing`
 * alone would make the play view unmeasurable while still, by accident rather than by
 * construction, leaving the film shots alone.
 *
 * Gating on WHICH SHOT is aimed says what is actually meant: the six judged frames get the
 * board they have always had, `play` and interactive get the marks. It mirrors main.ts's
 * own choice of camera exactly —
 *
 *     camera.applyShot(req.shot || (req.capturing ? 'wide-establishing' : 'play'))
 *
 * — so it can never disagree with what is in front of the lens. `src/lighting/view.ts`
 * reached the same conclusion for the same reason; this is that test, owned here, because
 * a piece does not import another piece's internals.
 *
 * The decision is taken once, at construction, from the URL. Nothing about it varies per
 * frame, so a film shot never so much as compiles the glyph code.
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
