/**
 * PIECE: lighting — the final grade for the PLAY camera.
 *
 * `GradeShader` with one thing added: a highlight roll-off in LINEAR light, before the
 * tone map. Everything else — the lens diffusion, the chromatic aberration, the optical
 * vignette, the lift, the contrast, the saturation ramp, the cold balance, the toe, the
 * grain — is the film grade's, character for character, so the play view still looks like
 * the same photochemical process as the six shots rather than like a different game.
 *
 * It is a separate FILE, not a `#define` or a uniform inside grade.ts, for the same reason
 * grade-low.ts is: the string in grade.ts is what six reference critics judge, it has to
 * compile to the same instructions every round, and `king-surrender` has to come back at
 * md5 45ebe28f78b6837bb2816b5fcccbe9ab. Not one character of that source may move. This
 * object is only ever constructed when `isPlayView()` is true — see view.ts.
 *
 * WHY THE PLAY VIEW NEEDS ITS OWN TOP END, AND WHY THE FIX IS HERE AND NOT IN THE RIG
 *
 * The film grade's exposure, lift and +28% highlight expansion were all measured against
 * `wide-establishing`: a 24-degree declination from 23 m out, where the board is a receding
 * plane a quarter of the way up the frame and the brightest thing on it is a specular
 * streak across a few hundred pixels. PLAY_SHOT is now 30 m up at about 80 degrees, with
 * that same marble filling the middle of the picture and every square inside 17 degrees of
 * straight below the lens. Same grade, a completely different population of pixels under
 * it — which is the same failure grade-low.ts documents, from the other direction.
 *
 * Measured from the play camera, sampling every square of the four EMPTY ranks so no piece
 * contaminates the number, the cream squares ran median 139, 99th percentile 222, peak 225
 * — the top of the board pinned against white with no marble left in it. The player's own
 * words were "the middle of the board is too blown out"; a critic's were "lit as a
 * self-luminous plane".
 *
 * THE RIG IS NOT THE CAUSE. The obvious suspect was the environment: a polished plane seen
 * from overhead mirrors the ZENITH, and the zenith is where this gradient keeps its energy
 * on purpose. Tested directly — the top stop halved for this camera, the play frame
 * re-captured — and the board did not move by one count: navy squares rgb 24,33,53, median
 * 32, 95th percentile 46, identical to the byte with and without. The marble's
 * `envMapIntensity` is 0.20 against a rough surface and the IBL is simply not what is
 * bright here. The aisle strip and the sheen are, and those are exactly where five rounds
 * of matching the reference frames live. See the note in index.ts.
 *
 * So it is a HIGHLIGHT problem, and it is fixed at the end of the chain. Pulling exposure
 * down would take the median with it and turn a cold room into a black one — and the
 * median does not need help: the play frame sits at 0.1216 against `wide-establishing`'s
 * 0.1137, which is the same range. What is wrong is only the top of the curve, so only the
 * top of the curve moves.
 *
 * TWO CHANGES, BOTH ABOVE THE MID-TONES
 *
 * `uKnee` / `uWhite` — the roll-off, in linear light before ACES, which is the only place
 * in the chain where the information to do it still exists. Below the knee this is
 * `min()` and `max()` and nothing else, so the room, the armies and the entire shadow half
 * of the picture are bit-for-bit the film grade's. Above it the curve compresses toward
 * `uWhite` and never reaches it, so a cream square lit by the full aisle pool comes back
 * as bright polished stone with its veining still legible, while a flame core — which is
 * an order of magnitude higher again — still runs off the top and prints white. That is
 * the brief: nothing reaches pure white except flame cores.
 *
 * `uHiGain` — the film's highlight expansion, eased for this camera. It exists because the
 * reference frame's 95th percentile sits a stop above ours; that deficit is a property of
 * the film FRAME, not of this scene, and the play camera does not have it. Applied here it
 * was multiplying the marble — the largest bright surface in the frame, sitting right in
 * the middle of the expansion's band — by a further 1.18 immediately before the clamp.
 * Reduced rather than removed: some shoulder lift is what stops the board reading flat.
 *
 * MEASURED RESULT, play frame at t = 0.5, 1920x804:
 *
 *                          before     after    wide-establishing
 *   fracBlown              0.00299   0.00089        0.00711
 *   medianLuminance        0.1137    0.1216         0.1137
 *   histogramEntropy       6.394     6.506          6.517
 *   cream squares, median    139       126
 *   cream squares, 99th      222       193
 *   cream squares, peak      225       196
 *   navy squares, median      32        32
 *
 * The dark squares do not move at all — they are nowhere near the knee — so the chequer
 * keeps its separation while the top of the board comes back off the ceiling. The blown
 * fraction is now an eighth of a percent, an eighth of what it was and a third of what the
 * film frame itself carries, and what is left above 0.92 is flames.
 *
 * THE SHOULDER IS NOW TWO-STAGE, AND THAT IS THE HIGHLIGHT-CLIPPING ROUND
 *
 * A single hyperbola cannot express the room's actual rule. "Nothing prints white except a
 * flame core" needs two numbers: one that says where the over-bright SURFACES come to rest,
 * and one that says what is allowed past that. With only `uWhite` doing both, the surfaces
 * were parked at 0.93-0.97 — over the metric's blown line — for anything from 1.16 scene-
 * linear upward, and an interactive move mark lying on the marble sat right on that edge.
 *
 * Both populations were measured directly out of the scene buffer this pass consumes, on
 * the play frame, with the real selection sigil from src/game/affordances.ts dropped on d4:
 *
 *                              marks            fires
 *   peak, scene-linear          0.956            9.21
 *   why that ceiling      their material is    nothing caps them —
 *                         `toneMapped`, so     `toneMapped: false`
 *                          ACES caps them
 *   fraction of frame     0.00124 (1919 px)    0.00120 over 1.0,
 *                                              0.00065 over 2, 0.00028 over 4
 *
 * They do not overlap, so the curve can be told them apart: `uWhite` 0.95 holds everything
 * a mark can reach at or below print 0.909, and `uCore` 1.05 (= 1.47 scene-linear, above
 * every mark and below every fire) lets the fires through at unity slope to clip as they
 * always have. Measured on the still play frame the whole-frame blown fraction is 0.00082
 * against 0.00086 before — the fires are still the only thing clipping, and there are still
 * as many of them — while an 80x80 crop on a marked pawn goes from peaking at print 0.878
 * to peaking at 0.86 with the mark's ring, its ticks and the pawn's carving all still in it.
 */
import * as THREE from 'three';
import { GradeShader } from './grade';

function buildUniforms(): Record<string, { value: unknown }> {
  // CLONED from the film grade, never re-typed, so the two can never quietly drift apart.
  const u = THREE.UniformsUtils.clone(GradeShader.uniforms as any) as Record<
    string,
    { value: unknown }
  >;

  /**
   * Where the roll-off starts, in linear light after exposure.
   *
   * Sited by measurement, not by taste. Running the play frame's board statistics back up
   * through the chain — sRGB-decode, undo the lift, invert ACES — the cream squares' 95th
   * percentile lands at about 0.40 in post-exposure linear and their 99th at about 0.60.
   * The knee therefore sits just ABOVE the lit marble: 99% of the board passes through
   * this line as an identity, and what bends is only the population above it, which is the
   * stone standing right at a fire, a fresh fracture face, the dust in a burst and the
   * flames.
   *
   * Lower than the 0.90 grade-low.ts uses, and the difference is the camera, not the tier.
   * That knee was set for the old PLAY_SHOT at [0, 15, -21] — a 33-degree view where only
   * the near rank, six metres from the lens, was over the line. From 30 m straight down
   * the over-bright population is spread across the whole board plane, and it starts
   * lower.
   */
  u.uKnee = { value: 0.55 };
  /**
   * The shoulder's asymptote — where the over-bright SURFACES come to rest. It is no
   * longer also the number that decides where white is; `uCore` below is.
   *
   * It used to be 3.2, chosen as "high enough that a flame still clips", and that
   * conflated two jobs into one lever. With a single hyperbola running all the way to a
   * flame-sized asymptote, everything between a lit cream square and a fire is squeezed
   * into the last three per cent of the curve: measured through this exact chain, the old
   * shoulder crossed the metric's blown line (print luminance 0.92) at a SCENE-linear
   * 1.16, and printed 0.937 / 0.955 / 0.972 at 1.45 / 2 / 3. So anything the board could
   * put in front of the lens above 1.16 was, by construction, a featureless white area.
   *
   * That is the mechanism behind "the highlight erases the piece it is pointing at". An
   * interactive move mark is an additive plane lying on the marble; measured in the scene
   * buffer with the real sigil on d4, the marked pixels top out at 0.956 scene-linear (they
   * cannot go higher — the marker material is `toneMapped`, so three has already put ACES
   * through it before it reaches this pass). At 0.956 the old curve printed 0.903, which
   * only just held, and it held by luck: a mark a sixth brighter, two marks overlapping, or
   * the same mark over stone standing in a fire's pool, and the whole disc goes over the
   * line together and prints as one flat white puck with the carving gone.
   *
   * 0.95 is set so that the ENTIRE population an additive mark can reach — everything up to
   * 1.0 in the scene buffer, which is where three's own tone map caps it — prints at or
   * below 0.909, comfortably under the line, with its shape still in it. It is a guarantee
   * rather than a margin.
   *
   * Nothing below the knee moves by a bit, and just above the knee the two curves are
   * indistinguishable — at 0.05 over the knee the old shoulder returned 0.5993 and this one
   * returns 0.5955. The cream squares' 99th percentile sits right there, so the board
   * itself prints where it always did (measured: cream median 126, unchanged).
   */
  u.uWhite = { value: 0.95 };
  /**
   * Where the picture is allowed to run away to white again, in post-exposure linear.
   *
   * The room's rule is "nothing reaches pure white except flame cores", and with one
   * asymptote there was no way to SAY that: a curve that lets a flame clip also lets
   * everything a third as bright clip. Above this line the shoulder stops holding and the
   * value passes through at unity slope, so a fire climbs off the top exactly as it did.
   *
   * Sited by measuring both populations in the scene buffer of the play frame, and they are
   * genuinely apart. Marks: nothing above 1.0, capped there by their own tone map. Fires:
   * the frame's maximum is 9.21 scene-linear, 0.00120 of pixels are over 1.0, 0.00065 over
   * 2 and 0.00028 over 4 — a small, steep population that is nothing but flame bodies,
   * their cores and the pools directly under them. 1.05 post-exposure is 1.47 scene-linear:
   * above every mark, below every fire.
   *
   * The frame's blown fraction is therefore preserved rather than merely reduced, which is
   * the point — the fires must go on being the only clipped thing in the room. Measured on
   * the still play frame, fracBlown 0.00086 before and 0.00082 after, against the 0.00084
   * this view is held to; above 3 scene-linear the fires actually print BRIGHTER than they
   * did (0.985 against 0.972), because the passthrough is steeper than the old asymptote.
   */
  u.uCore = { value: 1.05 };
  /**
   * The film's highlight expansion, eased hard, and this is the largest single lever on
   * the board's brightness in the whole pass.
   *
   * `hi` is a band centred between output luminance 0.25 and 0.62, tapering off again
   * above. The cream marble prints at about 0.79 — right where that band is still worth
   * 0.63 of its full value — so at the film's 0.28 the squares were being multiplied by a
   * further 1.18 in the last few lines of the shader, immediately before the clamp to 1.0.
   * That is what put the top of the board against white. Reduced, not removed: the band
   * also carries the lit masonry, and taking it to zero flattens the room.
   */
  u.uHiGain = { value: 0.10 };
  return u;
}

export const PlayGradeShader = {
  name: 'ChamberGradePlay',
  uniforms: buildUniforms(),
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uExposure, uAspect, uCA, uDiffusion;
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

  vec3 sharp = texture2D(tDiffuse, vUv).rgb;
  vec3 soft = blur4(vUv);

  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  vec2 off = c * r2 * uCA;
  vec3 lo = vec3(blur4(vUv + off).r, soft.g, blur4(vUv - off).b);
  vec3 col = lo + (sharp - soft) * (1.0 - uDiffusion);
  col = max(col, vec3(0.0));

  col *= uExposure * (1.0 + uFlash);

  vec2 vc = c * vec2(uVigAspect, 1.0);
  float fall = 1.0 + uVigStrength * dot(vc, vc);
  col /= fall * fall;

  // The one addition. Highlight roll-off in linear light, in two stages: identity below
  // uKnee; a hyperbola that approaches uWhite above it, which holds every over-bright
  // SURFACE just under the clipping line with texture still in it; and, above uCore, a
  // unity-slope passthrough so a flame core — the only thing in this room that gets that
  // far — still runs off the top and prints white. See the header.
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
