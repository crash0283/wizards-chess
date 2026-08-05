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
    uExposure: { value: 0.8 },
    uAspect: { value: 2.388 },
    uCA: { value: 0.0035 },
    uVigStrength: { value: 0.84 },
    uVigInner: { value: 0.3 },
    uVigOuter: { value: 0.95 },
    uVigAspect: { value: 1.25 },
    uLift: { value: 0.94 },
    uContrast: { value: 1.0 },
    /** Saturation in the deep shadows — the film's blacks are close to neutral. */
    uSatShadow: { value: 0.42 },
    /** Saturation from the mid-tones up, where the cold marble has to read blue. */
    uSaturation: { value: 1.08 },
    uSatRamp: { value: new THREE.Vector2(0.03, 0.28) },
    uShadowTint: { value: new THREE.Vector3(0.004, 0.006, 0.011) },
    uHighlightTint: { value: new THREE.Vector3(0.012, 0.002, -0.014) },
    uGrain: { value: 0.017 },
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
uniform float uExposure, uAspect, uCA;
uniform float uVigStrength, uVigInner, uVigOuter, uVigAspect;
uniform float uLift, uContrast, uSaturation, uSatShadow;
uniform vec2 uSatRamp;
uniform vec3 uShadowTint, uHighlightTint;
uniform float uGrain, uSeed, uFlash;
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

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // Saturation ramp: the deep shadows go near-neutral, the lit stone stays cold blue.
  float sat = mix(uSatShadow, uSaturation, smoothstep(uSatRamp.x, uSatRamp.y, l));
  col = mix(vec3(l), col, sat);

  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hi = smoothstep(0.55, 1.0, l);
  col += uShadowTint * sh;
  col += uHighlightTint * hi;

  // Grain: present everywhere, strongest through the dark mid-tones.
  float g = hash21(gl_FragCoord.xy + vec2(uSeed, uSeed * 1.7)) - 0.5;
  float weight = 0.30 + 1.55 * smoothstep(0.0, 0.10, l) * (1.0 - smoothstep(0.10, 0.62, l));
  col += g * uGrain * weight;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
