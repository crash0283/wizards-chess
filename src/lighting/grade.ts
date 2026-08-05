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
    uExposure: { value: 0.80 },
    uAspect: { value: 2.388 },
    uCA: { value: 0.0035 },
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
     * Eased off hard. Measured on the reference's picture area the top corners sit at a
     * deep-shadow fraction of 0.219 and 0.280; ours were at 0.488 and 0.782. Almost all
     * of our black was manufactured by this vignette rather than by anything in the room,
     * which is the tell: a dark ring around a frame that is otherwise uniformly legible
     * reads as a filter, where the reference's black is unlit architecture and lands in
     * irregular patches wherever no fire reaches.
     */
    uVigStrength: { value: 0.44 },
    uVigInner: { value: 0.44 },
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
    uSaturation: { value: 1.08 },
    uSatRamp: { value: new THREE.Vector2(0.03, 0.28) },
    /** Cold DI balance. Applied to everything the flames are not already warming. */
    uCoolBalance: { value: new THREE.Vector3(0.968, 1.013, 1.027) },
    uShadowTint: { value: new THREE.Vector3(0.004, 0.006, 0.011) },
    uHighlightTint: { value: new THREE.Vector3(0.006, 0.004, -0.004) },
    /** Print black: the picture's floor, which is never literal zero. */
    uToe: { value: 0.013 },
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

void main(){
  vec2 c = vUv - 0.5;

  // Chromatic aberration: nothing in the middle, a real smear at the edges.
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  vec2 off = c * r2 * uCA;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv + off).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv - off).b;

  // Lens diffusion, in linear light: a cross of taps a texel and a half out, mixed back
  // over the sharp image. Bright detail bleeds into its neighbours the way it does
  // through real glass, and the grain added at the end stays crisp on top of it.
  vec3 soft = texture2D(tDiffuse, vUv + vec2(uTexel.x * 1.5, 0.0)).rgb
            + texture2D(tDiffuse, vUv - vec2(uTexel.x * 1.5, 0.0)).rgb
            + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y * 1.5)).rgb
            + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y * 1.5)).rgb;
  col = mix(col, soft * 0.25, uDiffusion);

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
  float warmth = clamp((col.r - col.b) * 3.2, 0.0, 1.0);
  col *= mix(uCoolBalance, vec3(1.0), warmth);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // Saturation ramp: the deep cold shadows go near-neutral, the lit stone stays cold
  // blue. Firelight is exempt. A flame pool dies away through exactly the luminance band
  // this ramp neutralises, so applying it uniformly greys out the outer two-thirds of
  // every warm pool and the fires stop reading as sources — which is the whole gap.
  float warmSat = mix(uSatShadow, uSaturation, smoothstep(uSatRamp.x, uSatRamp.y, l));
  float sat = mix(warmSat, uSaturation, warmth * 0.6);
  col = mix(vec3(l), col, sat);

  // Print black. A negative never scans to zero and a release print carries base fog, so
  // the reference frame's darkest decile sits around 0.043 rather than on the floor —
  // its true zeros are the letterbox bars, not the picture. Rendering the corners and
  // the vault to literal black is a tell in its own right, and it costs a large chunk of
  // the shadow histogram. This lifts only the bottom of the curve and leaves the rest.
  col += uToe * (1.0 - smoothstep(0.0, 0.11, l));

  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hi = smoothstep(0.55, 1.0, l);
  col += uShadowTint * sh;
  col += uHighlightTint * hi;

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
