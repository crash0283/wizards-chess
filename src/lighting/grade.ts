/**
 * PIECE: lighting — the final grade.
 *
 * One pass does the lot, in the order a lens and a film stock would:
 *   radial chromatic aberration -> exposure -> optical vignette (still linear, so the
 *   corners crush to true black) -> filmic tone map -> sRGB -> lifted mid-tones, gentle
 *   contrast, a saturation ramp that keeps the deep shadows near-neutral while the lit
 *   marble stays blue -> film grain weighted into the dark mid-tones.
 *
 * The target is the reference frame's histogram: deep true blacks in the vault and the
 * corners, a large dark field, lifted gentle mids, small blown highlights (the flames),
 * visible grain. Measured off the frame, its shadows are only ~0.18-0.33 saturated
 * while its lit marble sits at hue ~228 / sat ~0.18 — hence the ramp rather than one
 * global saturation number.
 */
import * as THREE from 'three';

export const GradeShader = {
  name: 'ChamberGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 0.668 },
    uAspect: { value: 2.388 },
    /**
     * Chromatic aberration. This used to sample the SHARP buffer once per channel at
     * +off / 0 / -off, which at the frame edge is a five-pixel spread. Aim that at a
     * sub-pixel repeating pattern — the board's inlaid border strip is exactly one — and
     * the three channels land on three different phases of the stripe, so the kerb came
     * back covered in saturated single-pixel red/green/blue confetti. That was the
     * "iridescent rainbow speckle" along the kerb and the lower-left edge.
     *
     * The fringe is now built as a difference of *blurred* taps (see `blur4` below), so
     * it carries only the low-frequency part of the split — which is all a real lens
     * fringe is — and cannot resolve the stripe at all.
     */
    uCA: { value: 0.0009 },
    /** One texel, so the diffusion tap radius is in pixels rather than in UV. */
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 804) },
    /**
     * Optical diffusion, mixed in *before* exposure so it behaves like light scattering
     * in the taking lens rather than like a blur on a finished picture. A spherical lens
     * on a film camera is never critically sharp at the pixel level and a scan adds its
     * own MTF rolloff; leaving micro-contrast at full render sharpness is one of the
     * loudest CG tells there is, and it shows up in the metrics as roughly double the
     * reference's high-frequency energy.
     */
    uDiffusion: { value: 0.30 },
    /**
     * Eased off again, and this time far enough to matter. On a like-for-like picture-area
     * comparison (the reference's letterbox bars stripped, so both images are 1920x804 of
     * actual picture) the frame divides into a 4x3 grid like this, deep-shadow fraction:
     *
     *            reference                     ours, before
     *   top    0.189 0.039 0.014 0.195     0.694 0.174 0.143 0.788
     *   mid    0.157 0.037 0.013 0.181     0.002 0.000 0.000 0.209
     *   bottom 0.066 0.020 0.024 0.152     0.001 0.000 0.000 0.074
     *
     * Every black pixel we had was in the top band and the outer edges — the shape of this
     * vignette — while the film spreads a little black through all twelve cells and keeps
     * its top corners at a fifth, not four fifths. The corners were being manufactured
     * here and the room was not being allowed to make any of its own.
     */
    uVigStrength: { value: 0.22 },
    uVigInner: { value: 0.52 },
    uVigOuter: { value: 0.95 },
    uVigAspect: { value: 1.25 },
    uLift: { value: 0.94 },
    uContrast: { value: 0.99 },
    /**
     * Saturation in the deep shadows. Less neutral than we had it: the reference's own
     * blacks still carry colour. Its per-region saturation never drops below 0.229 and
     * runs to 0.425, and its picture-area mean is 0.323 against our 0.294 — we were
     * reading as *under*-saturated once the letterbox bars (which are 25.4% of the
     * reference's pixels, at zero saturation, and drag its whole-frame figure down to
     * 0.242) are taken out of the comparison.
     */
    uSatShadow: { value: 0.40 },
    /** Saturation from the mid-tones up, where the cold marble has to read blue. */
    uSaturation: { value: 1.03 },
    uSatRamp: { value: new THREE.Vector2(0.03, 0.28) },
    /**
     * Cold DI balance, pushed further apart. On the picture-area comparison the film has
     * 43.5% of its pixels reading cool (blue channel clear of red) against our 31.3%,
     * and 13.9% reading warm against our 18.2% — the single largest colour gap in the
     * frame, and one the whole-frame numbers hid because a quarter of the reference's
     * pixels are letterbox and count as neither.
     */
    uCoolBalance: { value: new THREE.Vector3(0.905, 1.010, 1.066) },
    uShadowTint: { value: new THREE.Vector3(0.004, 0.006, 0.011) },
    uHighlightTint: { value: new THREE.Vector3(0.006, 0.004, -0.004) },
    /**
     * Highlight expansion, above the mid-tones only. The reference's histogram is not a
     * brighter version of ours, it is a WIDER one: its 5th, 10th, 25th and 75th
     * percentiles now sit on ours almost exactly (8/10/18/65 against 8/10/17/66) while
     * its 95th and 99th are at 160 and 218 to our 128 and 193. Its shadows and its
     * mid-tones are where we already are; its top end is a stop further out. Pulling the
     * whole exposure up to chase that would drag the median and the shadow fraction with
     * it, so the lift has to be confined to the top of the curve.
     */
    uHiGain: { value: 0.32 },
    uHiPivot: { value: 0.25 },
    /** Print black: the picture's floor, which is never literal zero. */
    uToe: { value: 0.019 },
    uGrain: { value: 0.013 },
    uSeed: { value: 0.0 },
    uFlash: { value: 0.0 },
  },
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
uniform float uExposure, uAspect, uCA, uDiffusion;
uniform vec2 uTexel;
uniform float uVigStrength, uVigInner, uVigOuter, uVigAspect;
uniform float uLift, uContrast, uSaturation, uSatShadow;
uniform vec2 uSatRamp;
uniform vec3 uCoolBalance, uShadowTint, uHighlightTint;
uniform float uGrain, uSeed, uFlash, uToe;
uniform float uHiGain, uHiPivot;
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

  // Lens diffusion, in linear light: a soft tap mixed back over the sharp image. Bright
  // detail bleeds into its neighbours the way it does through real glass, and the grain
  // added at the end stays crisp on top of it.
  vec3 sharp = texture2D(tDiffuse, vUv).rgb;
  vec3 soft = blur4(vUv);

  // Chromatic aberration, split into a displaced LOW-frequency image plus a shared
  // high-frequency residual. Only the blurred layer moves, so the fringe is the smooth
  // colour edge a real lens leaves, and the pixel-pitch detail — the inlaid border strip
  // along the kerb, the joints, the grain of the marble — is carried by a single
  // achromatic term that no channel displaces. It cannot go iridescent because by the
  // time the split happens there is nothing left at that spatial frequency to split.
  // (Displacing the sharp channels was the confetti; adding an un-normalised difference
  // on top of them, which is what this looked like a moment ago, is worse still — that
  // doubles the edge instead of moving it.)
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  vec2 off = c * r2 * uCA;
  vec3 lo = vec3(blur4(vUv + off).r, soft.g, blur4(vUv - off).b);
  vec3 col = lo + (sharp - soft) * (1.0 - uDiffusion);
  col = max(col, vec3(0.0));

  col *= uExposure * (1.0 + uFlash);

  // Optical vignette, applied while still linear so the corners genuinely go black.
  float vr = length(c * vec2(uVigAspect, 1.0));
  float vig = 1.0 - uVigStrength * smoothstep(uVigInner, uVigOuter, vr);
  col *= max(vig, 0.0);

  col = aces(col);
  col = toSRGB(col);

  // Lifted, gentle mid-tones — this is not a high-contrast image.
  col = pow(max(col, vec3(0.0)), vec3(uLift));
  col = max((col - 0.16) * uContrast + 0.16, 0.0);

  // Cold balance. The room is graded cold; anything already warm — a flame and the
  // stone it is lighting — keeps its own colour and is left alone. The warmth test has
  // to trip early and the push has to stay small, because the outer part of a firelit
  // pool is only barely warm: at the old sensitivity a pixel a hundredth above neutral
  // read as "not warm", took the full cold push, and came out of the grade measurably
  // *blue*. That single line was inverting most of the bounce light in the frame.
  // Warmth exempts a pixel from the cold DI balance. Gated on luminance as well as on
  // hue: right at a fire the stone is bright AND warm and must keep its colour, but the
  // long dim tail of every pool was also testing "warm", claiming the same exemption,
  // and between thirty-odd fires that tail is most of the floor. That is what put 17.8%
  // of the frame in the warm bin against the film's 13.9% while our cool bin ran 5 points
  // short — not the fires themselves, the ground they were faintly staining.
  // Luminance BEFORE the cool balance shifts the colour — the warm-pool test has to see
  // the light as it arrived, not as this pass has already re-tinted it.
  float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float warmth = clamp((col.r - col.b) * 2.2, 0.0, 1.0) * smoothstep(0.08, 0.40, l0);
  col *= mix(uCoolBalance, vec3(1.0), warmth);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // Saturation ramp: the deep cold shadows go near-neutral, the lit stone stays cold
  // blue. Firelight is exempt. A flame pool dies away through exactly the luminance band
  // this ramp neutralises, so applying it uniformly greys out the outer two-thirds of
  // every warm pool and the fires stop reading as sources — which is the whole gap.
  float warmSat = mix(uSatShadow, uSaturation, smoothstep(uSatRamp.x, uSatRamp.y, l));
  float sat = mix(warmSat, uSaturation, warmth * 0.28);
  col = mix(vec3(l), col, sat);

  // Print black. A negative never scans to zero and a release print carries base fog, so
  // the reference frame's darkest decile sits around 0.043 rather than on the floor —
  // its true zeros are the letterbox bars, not the picture. Rendering the corners and
  // the vault to literal black is a tell in its own right, and it costs a large chunk of
  // the shadow histogram. This lifts only the bottom of the curve and leaves the rest.
  col += uToe * (1.0 - smoothstep(0.0, 0.11, l));

  // Highlight expansion. Nothing below the pivot moves at all, and the gain tapers off
  // again at the very top: a plain rising ramp lifted the 99th percentile to 245 and
  // trebled the blown fraction while the 95th — the lit marble, which is what actually
  // needs the help — barely shifted. The reference's brightest few thousand pixels are
  // its flames and they are already where they belong; what is missing is the shoulder
  // just under them.
  float hi = smoothstep(uHiPivot, 0.62, l) * (1.0 - 0.75 * smoothstep(0.62, 0.95, l));
  col *= 1.0 + uHiGain * hi;
  col = min(col, vec3(1.0));

  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hiTint = smoothstep(0.55, 1.0, l);
  col += uShadowTint * sh;
  col += uHighlightTint * hiTint;

  // Grain: present everywhere, strongest through the dark mid-tones. Sampled at ~1.8 px
  // and interpolated rather than one independent value per pixel — real grain is clumped
  // at this resolution, and per-pixel white noise is both the wrong texture and an
  // enormous amount of spurious high-frequency energy in the detail metric.
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
