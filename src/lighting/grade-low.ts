/**
 * PIECE: lighting — the interactive (low tier) final pass.
 *
 * This is `GradeShader` with `AtmosphereShader` folded into the front of it, three
 * deliberate economies, and one fix. It exists as a separate file rather than as a set of
 * `#define`s inside grade.ts for one reason: the 'high' path is what six film-reference
 * critics judge and it has to come out bit-for-bit identical, so not one character of the
 * shader source high compiles may change. Everything here is only ever constructed when
 * `world.quality !== 'high'`.
 *
 * Its numbers are not independent: every grade uniform is CLONED from `GradeShader` and
 * every veil uniform from `AtmosphereShader`, so the tone response of the two tiers can
 * never drift apart. What differs is only what the brief allows to differ — density and
 * resolution — plus the highlight roll-off below.
 *
 * WHAT IT SAVES
 *
 *   One full-screen pass. The chain was RenderPass -> atmosphere -> bloom -> grade; it is
 *   now RenderPass -> bloom -> (atmosphere+grade). At 1280x1067 that is one fewer
 *   read-and-write of a full-frame RGBA16F buffer per frame, and — because the pass that
 *   goes is the one that made the composer ping-pong — it also retires the second
 *   full-size HDR buffer and its depth texture entirely. See the note in index.ts.
 *
 *   Eight of thirteen texture fetches. The grade builds its chromatic aberration from
 *   three separate four-tap blurs (`blur4` at vUv+off, at vUv, at vUv-off). The fringe
 *   that buys is r2*uCA of a frame wide: 1.4 px at the corner of a 1920-wide capture, and
 *   0.4 px at the corner of the 512-wide buffer a phone actually renders. It is below the
 *   pixel pitch on any interactive frame, so at this tier the three blurs collapse to one
 *   and the lens diffusion — which is visible, and is doing real work against the CG
 *   micro-contrast tell — is kept in full.
 *
 * WHAT IT FIXES
 *
 *   The near pieces printing as paper white on a phone. The grade's exposure, lift and
 *   highlight expansion were all measured against `wide-establishing`, a frame whose
 *   nearest stone is twenty metres from the lens. Interactive play uses PLAY_SHOT, which
 *   sits at [0, 15, -21] with white's back rank six metres away and standing directly in
 *   the aisle pools and the flame lights. Same grade, a population of pixels four stops
 *   brighter: everything above about 4.6 in scene-linear leaves ACES at 0.973, and the
 *   lift, the cold balance and the +28% highlight expansion that follow carry it past 1.0.
 *   It is not that the low tier is graded differently — it is that the same grade is being
 *   handed a picture it was never measured on.
 *
 *   `uKnee`/`uWhite`/`uCore` are the answer, and they are applied in LINEAR light before the
 *   tone map, which is the only place in the chain where the information to do it still
 *   exists. Nothing below the knee moves by so much as a bit, so the room, the marble, the
 *   armies and the whole shadow half of the curve are exactly the high tier's. Above it the
 *   curve compresses toward `uWhite`, so a rook standing a metre from a fire comes back as
 *   very bright stone with carving still legible in it; above `uCore` it passes straight
 *   through, so a flame core still runs off the top and prints white, as it should.
 *
 *   AND, THIS ROUND, THE SAME CAMERA PRINTING TWO DIFFERENT WAYS ON THE TWO TIERS. The
 *   numbers above were sited when PLAY_SHOT was at [0, 15, -21]. It is now 30 m up at about
 *   80 degrees; grade-play.ts re-measured the shoulder and the highlight expansion for that
 *   camera and this file did not follow, so the tier a person actually plays on was a full
 *   stop hotter at the top than the tier the play view is judged on. Rendered side by side
 *   at 1920x804 the low tier crossed the blown line at a scene-linear of 0.488 against the
 *   play grade's 1.162 — the lit cream squares printed as white — giving whole-frame
 *   fracBlown 0.00168 against 0.00086 and a pawn's own 80x80 crop 1.34% blown at median
 *   0.808 against 0.588 with nothing drawn on its square at all. Drop an interactive move
 *   mark on that square and the whole disc goes over together: 14.95% blown at median
 *   0.851, a flat white puck. Every number in this file's shoulder is now grade-play.ts's,
 *   scaled by 0.788/0.716 so the two tiers agree in SCENE-linear and differ only by the
 *   exposure lift the thinned rig was measured to need. See the notes on each.
 */
import * as THREE from 'three';
import { AtmosphereShader } from './atmosphere';
import { GradeShader } from './grade';

/** Veil uniforms the atmosphere pass owns. `tDiffuse` is the grade's, not duplicated. */
const ATMO_KEYS = [
  'tDepth', 'uProjInv', 'uViewInv', 'uCamPos',
  'uHazeColor', 'uExtinct', 'uDensity', 'uStrength', 'uHazeScale', 'uHazeFloor',
] as const;

function buildUniforms(): Record<string, { value: unknown }> {
  const u = THREE.UniformsUtils.clone(GradeShader.uniforms as any) as Record<
    string,
    { value: unknown }
  >;
  const atmo = THREE.UniformsUtils.clone(AtmosphereShader.uniforms as any) as Record<
    string,
    { value: unknown }
  >;
  for (const k of ATMO_KEYS) u[k] = atmo[k];
  /**
   * Where the highlight roll-off starts, in linear light after exposure.
   *
   * THIS TIER RENDERS THE PLAY CAMERA AND NOTHING ELSE, and until this round it was still
   * graded for a camera that no longer exists. 0.90 was sited against PLAY_SHOT at
   * [0, 15, -21] — a 33-degree view where only the near rank was over the line. PLAY_SHOT
   * is now 30 m up at about 80 degrees with the marble filling the middle of the frame, and
   * grade-play.ts re-sited the same knee at 0.55 for exactly that reason. This tier never
   * followed, so the two tiers of the SAME camera were carrying tone curves a stop apart —
   * which is the one thing the quality-tier brief says must not happen.
   *
   * What that cost, measured on the play frame at 1920x804 with the two tiers rendered
   * side by side: the low tier crossed the metric's blown line (print luminance 0.92) at a
   * scene-linear of 0.488 against the play grade's 1.162, so the lit cream squares — which
   * live between 0.3 and 0.9 — printed AS WHITE. Whole-frame fracBlown 0.00168 against
   * 0.00086, an 80x80 crop on a pawn 1.34% blown before anything was even drawn on its
   * square, and the pawn's own crop median 0.808 against 0.588.
   *
   * Put an interactive move mark on that square and the disc goes over the line with it:
   * the same crop measured 14.95% blown at median 0.851 — a flat white puck with the
   * carving gone — while the identical unmarked pawn nearby sat at median 0.365. That is
   * the reported "the highlight erases the thing it is highlighting", and it was never the
   * mark: the mark is a small additive plane that tops out at 1.14 scene-linear, and it is
   * this curve that decided 1.14 prints white.
   *
   * 0.605 is grade-play.ts's 0.55 expressed at this tier's exposure (0.55 * 0.788/0.716),
   * so the two tiers now hold the same SCENE-linear knee and differ only by the 10%
   * exposure lift below, which is what the tier brief asks for.
   */
  u.uKnee = { value: 0.605 };
  /**
   * Exposure, and it is the one grade value that is deliberately NOT the high tier's.
   *
   * The rig this tier renders has ten spots in it where the capture rig has nineteen, and
   * although each surviving light carries the flux of the ones it replaced, a thinner rig
   * lands a little less light in the corners of the room that used to be covered by two
   * sources overlapping. Measured in a 4x3 grid over the play frame, the thinned rig came
   * back within a couple of percent on the board and the armies and between 7% and 19% down
   * on the outer cells — the piers, the leaning screens, the far arcade. Frame mean 46.4
   * against 50.9, median 29 against 33.
   *
   * A global exposure lift is the honest correction for that, and it is only available at
   * all because of the roll-off above: the reason exposure could not simply be raised
   * before is that the top of this frame was already clipping, and a lift would have made
   * a bigger hole. With the shoulder in place the lift lands on the shadows and the
   * mid-tones, which is where the deficit is, and the highlights stay where the roll-off
   * put them. 0.716 * 1.10.
   */
  u.uExposure = { value: 0.788 };
  /**
   * The shoulder's asymptote — where the over-bright SURFACES come to rest.
   *
   * It was 5.2, on the same reasoning `uWhite` carried in grade-play.ts before this round:
   * one number doing two jobs, set high enough that a flame still clips, which necessarily
   * parks everything a third as bright against white as well. See the note on the two-stage
   * shoulder in grade-play.ts — this is the same curve, and the numbers here are that
   * file's multiplied by 0.788/0.716 so the two tiers agree in SCENE-linear.
   */
  u.uWhite = { value: 1.046 };
  /**
   * Where the picture runs away to white again: above this, unity slope, so the fires
   * clip. 1.156 post-exposure is 1.47 scene-linear — above every additive mark the
   * interactive layer can draw (they are `toneMapped`, so ACES caps them at 1.0 before
   * they reach this pass; measured peak on this tier 1.14) and below every fire (frame
   * peak 8.2 scene-linear, with 0.00091 of pixels over 1.0 and 0.00027 over 4).
   */
  u.uCore = { value: 1.156 };
  /**
   * The film's highlight expansion, at the play camera's setting instead of the film's.
   *
   * This is the single biggest lever on how hot the board prints, and it was the one thing
   * grade-play.ts changed that this file never picked up: cloned straight from the film
   * grade it stood at 0.28, multiplying everything in the 0.25-0.62 output band — which is
   * where the lit marble of a near-top-down view sits — by up to 1.28 in the last lines of
   * the shader, immediately before the clamp. On its own it moved this tier's blown line
   * from a scene-linear of 0.488 to 1.022; with the shoulder above it lands at 1.229.
   *
   * The expansion exists to widen a histogram against the reference FRAME's top end, which
   * is a property of the film stock and not of this scene, and the play camera does not
   * have that deficit. Reduced rather than removed, for the reason grade-play.ts gives:
   * the band also carries the lit masonry, and at zero the room flattens.
   */
  u.uHiGain = { value: 0.10 };
  return u;
}

export const LowGradeShader = {
  name: 'ChamberGradeLow',
  uniforms: buildUniforms(),
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uHazeColor;
uniform float uDensity, uStrength, uHazeScale, uHazeFloor, uExtinct;
uniform float uExposure, uAspect, uDiffusion;
uniform vec2 uTexel;
uniform float uVigStrength, uVigAspect;
uniform float uLift, uContrast, uSaturation, uSatShadow;
uniform vec2 uSatRamp;
uniform vec3 uCoolBalance, uShadowTint, uHighlightTint;
uniform float uGrain, uSeed, uFlash, uToe;
uniform float uHiGain, uHiPivot;
uniform float uKnee, uWhite, uCore;
varying vec2 vUv;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(0.41666)) - 0.055,
             step(vec3(0.0031308), c));
}

float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Four diagonal taps ~1.35 texels out. Low-passes away anything at pixel pitch. */
vec3 blur4(vec2 uv){
  vec2 a = uTexel * 1.35;
  return 0.25 * (texture2D(tDiffuse, uv + vec2( a.x,  a.y)).rgb
               + texture2D(tDiffuse, uv + vec2(-a.x,  a.y)).rgb
               + texture2D(tDiffuse, uv + vec2( a.x, -a.y)).rgb
               + texture2D(tDiffuse, uv + vec2(-a.x, -a.y)).rgb);
}

void main(){
  vec2 c = vUv - 0.5;

  // --- the lens: diffusion only. See the header for why the CA taps are gone here.
  vec3 sharp = texture2D(tDiffuse, vUv).rgb;
  vec3 soft = blur4(vUv);
  vec3 col = max(soft + (sharp - soft) * (1.0 - uDiffusion), vec3(0.0));

  // --- the air: the atmosphere pass, inlined. Same reconstruction, same numbers.
  float d = texture2D(tDepth, vUv).x;
  if (d < 0.99995) {
    vec4 clip = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 view = uProjInv * clip;
    view /= view.w;
    vec3 world = (uViewInv * view).xyz;
    float dist = length(world - uCamPos);
    float base = 1.0 - exp(-dist * dist * uDensity * uDensity);
    float height = exp(-max(0.0, world.y - uHazeFloor) / uHazeScale);
    float veil = clamp(base * height * uStrength, 0.0, 0.94);
    col = col * (1.0 - veil * uExtinct) + uHazeColor * veil;
  }

  col *= uExposure * (1.0 + uFlash);

  // Optical vignette, applied while still linear. cos^4 of the field angle.
  vec2 vc = c * vec2(uVigAspect, 1.0);
  float fall = 1.0 + uVigStrength * dot(vc, vc);
  col /= fall * fall;

  // Highlight roll-off, in linear light, two-stage and identical in shape to the one in
  // grade-play.ts — this tier renders the same camera. Below uKnee it is the identity —
  // min() and max() and nothing else — so the room's whole tone response is the high
  // tier's. Between uKnee and uCore it bends toward uWhite and never reaches it, which is
  // what holds an over-bright surface (stone in a fire's pool, a fracture face, a move
  // mark lying on the marble) under the clipping line with its shape still in it. Above
  // uCore it passes at unity slope, so the fires still run off the top and print white.
  vec3 over = max(col - uKnee, 0.0);
  vec3 span = vec3(max(uWhite - uKnee, 1e-4));
  col = min(col, vec3(uKnee)) + span * (over / (over + span)) + max(col - uCore, vec3(0.0));

  col = aces(col);
  col = toSRGB(col);

  col = pow(max(col, vec3(0.0)), vec3(uLift));
  col = max((col - 0.16) * uContrast + 0.16, 0.0);

  float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float warmth = clamp((col.r - col.b) * 2.2, 0.0, 1.0) * smoothstep(0.13, 0.48, l0);
  col *= mix(uCoolBalance, vec3(1.0), warmth);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

  float warmSat = mix(uSatShadow, uSaturation, smoothstep(uSatRamp.x, uSatRamp.y, l));
  float sat = mix(warmSat, uSaturation, warmth * 0.28);
  col = mix(vec3(l), col, sat);

  col += uToe * (1.0 - smoothstep(0.0, 0.11, l));

  float hi = smoothstep(uHiPivot, 0.62, l) * (1.0 - 0.75 * smoothstep(0.62, 0.95, l));
  col *= 1.0 + uHiGain * hi;
  col = min(col, vec3(1.0));

  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hiTint = smoothstep(0.55, 1.0, l);
  col += uShadowTint * sh;
  col += uHighlightTint * hiTint;

  vec2 gp = (gl_FragCoord.xy + vec2(uSeed * 3.1, uSeed * 1.7)) / 1.8;
  vec2 gi = floor(gp), gf = fract(gp);
  gf = gf * gf * (3.0 - 2.0 * gf);
  float g = mix(mix(hash21(gi), hash21(gi + vec2(1.0, 0.0)), gf.x),
                mix(hash21(gi + vec2(0.0, 1.0)), hash21(gi + vec2(1.0, 1.0)), gf.x), gf.y) - 0.5;
  float weight = 0.30 + 1.55 * smoothstep(0.0, 0.10, l) * (1.0 - smoothstep(0.10, 0.62, l));
  col += g * uGrain * weight;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
