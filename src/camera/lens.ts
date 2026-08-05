/**
 * PIECE: camera — the lens itself.
 *
 * `src/core/shots.ts` gives every shot a focus distance in metres and an f-number. This
 * file is what turns those two numbers into a circle of confusion, so that focus and
 * stop mean what they mean on a lens: open the iris one stop and the background blur
 * doubles; move the focal plane and the sharp band moves with it.
 *
 * The geometry is the textbook thin-lens one. For a point at axial distance z, focused
 * at F, with focal length f and aperture diameter A = f/N, the blur circle on the sensor
 * has diameter
 *
 *     c = A · f/(F − f) · |z − F| / z
 *
 * Note the shape of that: the depth-dependent part, (z − F)/z, is +1 in the limit of an
 * infinitely far object and goes negative in front of the focal plane. So the whole
 * per-frame lens state collapses to ONE number — the radius, in pixels, that the blur
 * tends to at infinity — and the shader just multiplies it by (z − F)/z. Signed, so the
 * sign tells the bokeh pass which side of focus a sample is on, which is what lets the
 * near field spill over the far field instead of being clipped by it.
 *
 * ANAMORPHIC. A 2× anamorphic squeezes horizontally, so the iris — round in lens space —
 * unsqueezes into an oval taller than it is wide. That oval is the single most legible
 * signature of the format, more than the aspect ratio itself, and it is why out-of-focus
 * flames in the reference frames read as vertical smudges rather than discs.
 */

export const LENS = {
  /** Super 35 frame height, metres. Sets the relationship between fov and focal length. */
  sensorHeight: 0.0186,

  /**
   * Bokeh scale.
   *
   * Honest note, because this is the one place the model is deliberately not physical.
   * These shots are framed wide — 38° to 44° vertical — which on a 35mm-height sensor is
   * a 25–28mm lens, and a 25mm lens at T2 focused at 7.6m is very nearly deep focus: the
   * far arches would come out around a pixel and a half of blur. The reference frames put
   * that background 20–30 pixels soft. Film gets there by shooting a much longer lens
   * from much further back, in a room far deeper than this chamber is. We cannot move the
   * camera without re-aiming the shot, so the aperture is scaled instead: everything below
   * behaves exactly like a lens, just one on a format about twelve times larger than the
   * frame it is exposing. Focus and stop stay meaningful and relative depth stays exactly
   * right; only the absolute amount is dialled to the bar.
   */
  bokehGain: 14.5,

  /** Blur radius ceiling, in pixels of a 1920×804 frame. Bounds the gather cost. */
  maxCocPx: 15.0,

  /**
   * The near field is compressed above this radius, toward `nearMaxPx`.
   *
   * This is the one asymmetry in the model and it is worth being explicit about. The
   * circle of confusion is symmetric in the maths but not in its consequences: behind the
   * focal plane it converges on a finite limit, while in front of it, it runs away —
   * (z − F)/z has no bound as z falls. Scaled up by `bokehGain`, a plinth three metres
   * from the lens computes a thirty-pixel circle and dissolves into a featureless mass.
   *
   * Check that against the frames: in `knight-looking-up` the nearest object in shot is a
   * chainmail cape and every ring on it is legible; the plinths at the frame edge are
   * sharp enough to read their mouldings and their rust. The film's foreground is not
   * blurred at all — its softness is all behind the subject, because the camera is much
   * further from the front rank than ours can be without re-aiming the shot.
   *
   * So the far field keeps the scaling that earns the background these frames show, and
   * the near field is rolled off above a knee: mild foreground defocus stays exactly
   * physical, and only the runaway end is compressed.
   */
  nearKneePx: 3.0,
  nearMaxPx: 6.0,

  /**
   * Anamorphic squeeze applied to the bokeh: horizontal radius = vertical / this.
   * 2.0 is a hard vintage look; this sits just inside it. It is also the reason the
   * reference frame measures far more directional in its gradients than a spherical
   * render does — an oval bokeh keeps vertical edges while dissolving horizontal ones.
   */
  squeeze: 1.8,
} as const;

/** Focal length in metres for a vertical fov on the sensor above. */
export function focalLength(fovDeg: number, sensorHeight = LENS.sensorHeight): number {
  return (sensorHeight * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * The far-field blur RADIUS in pixels — the single per-frame lens constant.
 * Multiply by (z − F)/z in the shader to get the signed circle of confusion.
 */
export function cocConstantPx(
  fovDeg: number,
  fstop: number,
  focusMetres: number,
  frameHeightPx: number,
): number {
  const f = focalLength(fovDeg);
  const F = Math.max(focusMetres, f * 1.05);
  const N = Math.max(0.7, fstop);
  // c_infinity (diameter, sensor metres) = (f/N) · f/(F − f)
  const cDiameter = ((f / N) * f) / (F - f);
  const radiusFrames = cDiameter * 0.5 / LENS.sensorHeight; // as a fraction of frame height
  return radiusFrames * frameHeightPx * LENS.bokehGain;
}
