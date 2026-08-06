/**
 * PIECE: lighting — the flame system.
 *
 * The frames show MANY small individual flames (roughly 0.4-0.6 m) burning directly on
 * the board's raised kerb, on plinths and in the rubble behind the ranks. Each is
 * intensely bright but lights only a metre or two around itself; together they do NOT
 * warm the room. So: a lot of emissive geometry, and a small pool of real point lights
 * assigned to whichever flames matter for the current camera.
 *
 * Everything here is a function of `world.time` and forks of `world.rng`.
 */
import * as THREE from 'three';
import { BOARD_SIZE } from '../core/constants';
import { makeNoise3, type Rng } from '../core/rng';
import type { World } from '../core/world';
import { FIRE } from './palette';

export interface Flame {
  index: number;
  pos: THREE.Vector3;
  /** Flame height in metres, base to tip, at rest. */
  size: number;
  phase: number;
  /**
   * 0..1 colour temperature. 0 is a guttering deep-orange fire, 1 is a hot pale one.
   * Real fires in one room are never the same colour as each other.
   */
  temp: number;
  /** Multiplier on this flame's own flicker rate — some race, some breathe. */
  rate: number;
  /** Colour of the point light this flame casts, derived from `temp`. */
  tint: THREE.Color;
  /** 0..1, refreshed every frame. Irregular, not a clean sine. */
  flicker: number;
  /** Standing on flat polished stone, so it burns a pool and casts a reflection. */
  ground: boolean;
}

/** Cold end and hot end of the fire gamut, in sRGB. Every flame lands between them. */
const TEMP_COOL = new THREE.Color(0xff7a1e);
const TEMP_HOT = new THREE.Color(0xffd7a8);

export interface FlameSystem {
  group: THREE.Object3D;
  flames: Flame[];
  /** The pool of real point lights. Fixed length so the shader never recompiles. */
  lights: THREE.PointLight[];
  /** Advance flicker. Call from world.onUpdate. */
  tick(t: number): void;
  /** Re-point the light pool at the flames that matter for this camera. */
  assign(camera: THREE.Camera): void;
  dispose(): void;
}

const HALF = BOARD_SIZE / 2; // 9.4 m

/**
 * Deterministic layout: the kerb ring, plus rubble and plinth flames behind the ranks.
 *
 * `ground` marks a fire that is standing on a flat polished surface — the kerb tread —
 * and therefore gets a contact pool and a reflection. Fires sitting in a rubble heap or
 * up on a plinth have nothing flat under them and would show a pool floating in mid air.
 */
function layout(
  rng: Rng,
): Array<{ x: number; y: number; z: number; size: number; ground: boolean }> {
  const out: Array<{ x: number; y: number; z: number; size: number; ground: boolean }> = [];
  const kerb = HALF + 0.78;
  const along = [-7.85, -4.72, -1.58, 1.58, 4.72, 7.85];
  // The two ends the armies stand behind carry fewer fires than the long sides — in the
  // reference the ranks themselves, not a row of flames, close off those edges.
  const acrossEnds = [-6.3, 0.4, 6.9];

  // Four kerb runs. These are the flames that read biggest in the wide shot. They are
  // jittered along and across the kerb: evenly spaced fires read as birthday candles.
  // Sizes are drawn from a wide, skewed range rather than a tight one. Evenly-sized
  // fires read as a manufactured set; a real kerb carries a couple of big ones and a lot
  // of small ones, and squaring a uniform draw gives exactly that distribution.
  const j = () => rng.float(-0.62, 0.62);
  const k = () => rng.float(-0.16, 0.16);
  // The exponent, not the range, is what makes a population of fires read as a set of
  // individuals. u*u pushes nearly everything to the bottom of the range, which gave a
  // kerb of near-identical small fires with the occasional outlier — birthday candles with
  // one exception. u^1.35 over a wider span gives what a real kerb carries: a scatter of
  // little ones, a working majority at mid size, and two or three genuinely big fires that
  // dominate their stretch of stone.
  const pick = (lo: number, hi: number) => {
    const u = rng.float(0, 1);
    return lo + (hi - lo) * Math.pow(u, 1.35);
  };
  for (const a of along) {
    out.push({ x: -kerb + k(), y: 0.3, z: a + j(), size: pick(0.20, 0.92), ground: true });
    out.push({ x: kerb + k(), y: 0.3, z: a + j(), size: pick(0.20, 0.94), ground: true });
  }
  for (const a of acrossEnds) {
    out.push({ x: a + j(), y: 0.3, z: -kerb + k(), size: pick(0.18, 0.66), ground: true });
    out.push({ x: a + j(), y: 0.3, z: kerb + k(), size: pick(0.18, 0.66), ground: true });
  }
  // Corners of the kerb.
  for (const sx of [-1, 1]) {
    for (const sk of [-1, 1]) {
      out.push({ x: sx * kerb, y: 0.32, z: sk * kerb, size: pick(0.30, 0.86), ground: true });
    }
  }
  // Burning in the accumulated rubble heaps behind each army.
  for (const sz of [-1, 1]) {
    for (const x of [-6.1, -2.0, 2.0, 6.1]) {
      out.push({
        x: x + rng.float(-0.6, 0.6),
        y: rng.float(0.45, 1.05),
        z: sz * rng.float(12.0, 13.6),
        size: pick(0.26, 0.86),
        ground: false,
      });
    }
  }
  // A few small ones scattered up on plinth level among the ranks, either side.
  for (const sz of [-1, 1]) {
    for (const x of [-8.4, -4.0, 4.0, 8.4]) {
      out.push({
        x: x + rng.float(-0.4, 0.4),
        y: rng.float(0.55, 0.95),
        z: sz * rng.float(8.6, 10.0),
        size: pick(0.16, 0.56),
        ground: false,
      });
    }
  }
  // The heap at the FAR END of the room — the bank of accumulated debris along the foot of
  // the end screen, at x ~ 13.5. Appended last on purpose: the rng is drawn in sequence, so
  // adding a group anywhere earlier would reshuffle every fire that follows it.
  //
  // This is the one place the layout was simply missing fires. `wide-establishing` looks
  // straight down the long axis, so this heap sits at the top-centre of frame directly
  // behind the far kerb — and in the film that is a lit, burning bank with several fires
  // standing in it, one of the few genuinely bright things in the upper half of the
  // picture. Ours was a dark strip, which cost the far end of the board its backing and
  // left the top band of the frame with nothing in it to model.
  for (const z of [-6.4, -2.6, 1.2, 5.1]) {
    out.push({
      x: rng.float(11.9, 13.6),
      y: rng.float(0.34, 1.15),
      z: z + rng.float(-0.9, 0.9),
      size: pick(0.28, 0.94),
      ground: false,
    });
  }
  return out;
}

/** Shared GLSL: cheap hash + value noise, used for flicker, sway and turbulence. */
const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vnoise1(float x){
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}
float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** Irregular flicker in 0..1 — three incommensurate noise rates, never a clean sine. */
float flicker(float t, float ph){
  return vnoise1(t * 6.7 + ph * 13.0) * 0.54
       + vnoise1(t * 15.9 + ph * 29.0) * 0.29
       + vnoise1(t * 2.3 + ph * 5.0) * 0.17;
}
`;

const BODY_VERT = /* glsl */ `
attribute vec2 aCorner;    // x in [-0.5,0.5], y in [0,1]
attribute vec3 aCentre;
attribute vec4 aParams;    // phase, size, layer 0..2, lateral offset
attribute vec4 aVary;      // temp 0..1, profile exponent, aspect, flicker rate
attribute vec4 aVary2;     // skew, stretch, layer opacity, spare
uniform float uTime;
varying vec2 vUv;
varying float vLayer;
varying float vPhase;
varying float vFlick;
varying float vTemp;
varying float vProf;
varying float vTip;
varying float vSkew;
varying float vShow;
${NOISE_GLSL}
void main(){
  vUv = vec2(aCorner.x + 0.5, aCorner.y);
  vSkew = aVary2.x;
  vShow = aVary2.z;
  float ph = aParams.x;
  float size = aParams.y;
  vLayer = aParams.z;
  vPhase = ph;
  vTemp = aVary.x;
  vProf = aVary.y;
  // A wide flame is also a stubby one and a narrow flame licks higher, so the tip rides
  // off the same number as the width. One knob, two correlated silhouette cues.
  vTip = 0.78 + (1.0 - aVary.z) * 0.30;

  // Per-flame rate. Identical flicker rates across a population is the single loudest
  // "these are instances of one billboard" tell there is — the whole kerb pulses together.
  float fl = flicker(uTime * aVary.w, ph + vLayer * 0.37);
  vFlick = fl;

  float layerScale = 1.0 - vLayer * 0.27;
  float h = size * (1.58 + 0.85 * (fl - 0.5)) * layerScale * aVary2.y;
  float w = size * (1.26 + 0.28 * (fl - 0.5)) * layerScale * aVary.z;

  // Lean and lick — grows with height, so the base stays planted.
  float sway = (vnoise1(uTime * 2.9 + ph * 7.0) - 0.5) * 0.55
             + (vnoise1(uTime * 8.3 + ph * 3.1) - 0.5) * 0.22;
  float lean = sway * size * aCorner.y * aCorner.y + aParams.w * size;

  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 wp = aCentre + right * (aCorner.x * w + lean) + vec3(0.0, aCorner.y * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BODY_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vLayer;
varying float vPhase;
varying float vFlick;
varying float vTemp;
varying float vProf;
varying float vTip;
varying float vSkew;
varying float vShow;
${NOISE_GLSL}
void main(){
  float y = clamp(vUv.y, 0.0, 1.0);

  // Turbulent centre line: the flame body wanders as it rises.
  float turb = (vnoise2(vec2(vPhase * 11.0, y * 3.4 - uTime * 2.6)) - 0.5) * 0.34 * y
             + (vnoise2(vec2(vPhase * 23.0 + 5.0, y * 7.9 - uTime * 5.1)) - 0.5) * 0.16 * y
             + vSkew * y * y * 0.5;

  // Teardrop: broad and round at the base, tapering to a wandering tip. Both the taper
  // exponent and the tip height are per-flame, so the population spans genuinely
  // different silhouettes — squat guttering blobs through to tall spindly licks —
  // instead of one teardrop repeated at different scales.
  float tip = vTip + 0.20 * vFlick;
  float prof = pow(max(0.0, 1.0 - y / tip), vProf) * smoothstep(0.0, 0.10, y);
  prof *= 0.55 + 0.45 * vnoise2(vec2(vPhase * 3.0, y * 2.1 - uTime * 1.7));

  float d = abs(vUv.x - 0.5 - turb) / max(prof * 0.5, 1e-4);
  float a = 1.0 - smoothstep(0.35, 1.0, d);
  a *= smoothstep(0.0, 0.06, y);
  if (a < 0.012) discard;

  // Colour ramp: deep orange rim -> body -> near-white core low down.
  vec3 col = mix(uEdge, uMid, smoothstep(0.10, 0.62, a));
  float coreness = smoothstep(0.55, 0.95, a) * (1.0 - smoothstep(0.22, 0.78, y));
  col = mix(col, uCore, coreness);

  // Per-flame colour temperature. Fires in one room burn at different temperatures
  // depending on what they are consuming, and matching them all to one ramp is what made
  // thirty-eight separate fires read as one asset.
  col *= mix(vec3(1.14, 0.78, 0.46), vec3(0.97, 1.00, 1.06), vTemp);

  float energy = uIntensity * (0.62 + 0.90 * (1.0 - y)) * (0.72 + 0.56 * vFlick);
  energy *= (1.0 - vLayer * 0.22) * vShow;
  gl_FragColor = vec4(col * a * a * energy, 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
attribute vec2 aCorner;    // -0.5..0.5 both axes
attribute vec3 aCentre;
attribute vec4 aParams;    // phase, size, temp 0..1, flicker rate
attribute float aRad;      // per-flame halo radius multiplier
uniform float uTime;
varying vec2 vUv;
varying float vFlick;
varying float vTemp;
${NOISE_GLSL}
void main(){
  vUv = aCorner;
  float ph = aParams.x;
  float size = aParams.y;
  vTemp = aParams.z;
  float fl = flicker(uTime * aParams.w, ph);
  vFlick = fl;
  // Tighter than it was. These halos are a large part of the frame's bright warm area,
  // and the reference keeps its warm pixels small: 14.0% of its lit pixels fall in the
  // 0-30 degree hue bin against our 30.6%, which is what dragged the circular-mean lit
  // hue round to 256 instead of 224.
  float r = size * (1.05 + 0.34 * (fl - 0.5)) * aRad;
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vec3 wp = aCentre + vec3(0.0, size * 0.55, 0.0) + right * (aCorner.x * r) + up * (aCorner.y * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFlick;
varying float vTemp;
void main(){
  float d = length(vUv) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * a * a;
  if (a < 0.004) discard;
  vec3 c = uColor * mix(vec3(1.14, 0.78, 0.46), vec3(0.97, 1.00, 1.06), vTemp);
  gl_FragColor = vec4(c * a * uIntensity * (0.7 + 0.6 * vFlick), 1.0);
}
`;

/**
 * The pool a fire burns into the stone it stands on, plus its reflection in the polish.
 *
 * A flame that emits light but leaves no mark on the surface under it is a decal, and
 * that has been the standing note on this piece for three rounds. Two things are missing
 * from a point light alone. First the CONTACT POOL: right at the foot of a fire the stone
 * is receiving light from a source a few centimetres away and is blown out — a hard
 * inverse-square term that no light with a sane falloff will ever produce without also
 * flooding everything within three metres. Second the REFLECTION: the kerb tread and the
 * marble are polished, so each fire lays a soft vertical smear in them, and in a horizontal
 * mirror that smear always runs from the object's foot TOWARD the viewer. Both live on the
 * ground plane, so both are one flat quad per fire.
 *
 * The quad is built in the vertex shader from the horizontal direction to the camera, so
 * the streak re-aims every frame with no CPU work and stays correct in the board's planar
 * reflection pass too (that pass renders with its own camera, and `cameraPosition` follows
 * it). Additive, no depth write.
 */
const POOL_VERT = /* glsl */ `
attribute vec2 aCorner;    // x across the streak, y along it: -0.35 .. 1
attribute vec3 aCentre;
attribute vec4 aParams;    // phase, size, temp, flicker rate
uniform float uTime;
varying vec2 vUv;
varying float vFlick;
varying float vTemp;
${NOISE_GLSL}
void main(){
  vUv = aCorner;
  float ph = aParams.x;
  float size = aParams.y;
  vTemp = aParams.z;
  float fl = flicker(uTime * aParams.w, ph + 0.61);
  vFlick = fl;

  // Horizontal direction from the fire to the eye. The reflection stretches along it.
  vec3 toEye = cameraPosition - aCentre;
  vec2 f = toEye.xz;
  float fl2 = length(f);
  vec2 fwd = fl2 > 1e-4 ? f / fl2 : vec2(1.0, 0.0);
  vec2 side = vec2(-fwd.y, fwd.x);

  // A grazing view stretches the reflection out; a steep one keeps it short and round.
  float graze = clamp(fl2 / max(0.5, length(toEye)), 0.0, 1.0);
  float len = size * (2.1 + 5.6 * graze * graze) * (0.86 + 0.28 * fl);
  float wid = size * (1.24 + 0.30 * fl);

  vec2 p = fwd * (aCorner.y * len) + side * (aCorner.x * wid);
  vec3 wp = aCentre + vec3(p.x, 0.0, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const POOL_FRAG = /* glsl */ `
precision highp float;
uniform float uIntensity;
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
varying float vFlick;
varying float vTemp;
${NOISE_GLSL}
void main(){
  float s = vUv.x / 0.5;          // -1..1 across
  float t = vUv.y;                // -0.35 behind the fire .. 1 toward the eye

  // The contact pool: a tight radial burn centred on the fire's foot, in the quad's own
  // squashed coordinates so it stays circular however far the streak is stretched.
  float rad = length(vec2(s, t * 2.6));
  float pool = exp(-rad * rad * 4.6);

  // The reflection: a soft tongue running toward the eye, narrowing and fading as it goes,
  // with the fire's own flicker broken into it so it lives rather than sitting there.
  float along = smoothstep(-0.30, 0.02, t) * (1.0 - smoothstep(0.10, 1.0, t));
  float w = 0.42 + 0.62 * t;
  float across = exp(-(s * s) / (w * w));
  float ripple = 0.62 + 0.38 * vnoise2(vec2(t * 3.4 - uTime * 0.9, vFlick * 2.0));
  float streak = along * across * ripple * 0.62;

  float a = pool + streak;
  if (a < 0.004) discard;

  vec3 c = uColor * mix(vec3(1.16, 0.74, 0.40), vec3(0.98, 1.00, 1.04), vTemp);
  // The core of the pool burns toward white; the tail stays orange.
  c = mix(c, vec3(1.0, 0.93, 0.82), smoothstep(0.55, 1.30, pool));
  gl_FragColor = vec4(c * a * uIntensity * (0.68 + 0.64 * vFlick), 1.0);
}
`;

export function createFlames(world: World, opts: { lightCount: number }): FlameSystem {
  const group = new THREE.Group();
  group.name = 'lighting-flames';

  const rng = world.rng.fork('lighting-flame-layout');
  const specs = layout(rng);

  const phaseRng = world.rng.fork('lighting-flame-phase');
  const flames: Flame[] = specs.map((s, i) => {
    // Colour temperature is drawn from two populations, not one ramp. Most of these fires
    // are ordinary orange; roughly one in four is burning something hotter and comes back
    // pale. A single skewed distribution gives a continuum, and a continuum of near
    // neighbours still reads as one asset shaded slightly differently — two clearly
    // separated modes read as two kinds of fire.
    const u = phaseRng.float(0, 1);
    const hot = phaseRng.float(0, 1) < 0.28;
    const temp = hot ? 0.62 + u * 0.36 : u * u * 0.34 + 0.03;
    return {
      ground: s.ground,
      index: i,
      pos: new THREE.Vector3(s.x, s.y, s.z),
      size: s.size,
      phase: phaseRng.float(0, 1),
      temp,
      rate: phaseRng.float(0.72, 1.42),
      tint: TEMP_COOL.clone().lerp(TEMP_HOT, temp),
      flicker: 0.5,
    };
  });

  // --- body geometry: three stacked tongues per flame ---------------------------------
  const LAYERS = world.quality === 'high' ? 3 : 2;
  const bodyQuads = flames.length * LAYERS;
  const bPos = new Float32Array(bodyQuads * 4 * 3); // dummy position attribute
  const bCorner = new Float32Array(bodyQuads * 4 * 2);
  const bCentre = new Float32Array(bodyQuads * 4 * 3);
  const bParams = new Float32Array(bodyQuads * 4 * 4);
  const bVary = new Float32Array(bodyQuads * 4 * 4);
  const bVary2 = new Float32Array(bodyQuads * 4 * 4);
  const bIndex = new Uint16Array(bodyQuads * 6);

  const CORNERS: Array<[number, number]> = [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 1],
    [-0.5, 1],
  ];

  const offRng = world.rng.fork('lighting-flame-offset');
  const shapeRng = world.rng.fork('lighting-flame-shape');
  // Silhouette parameters are per flame, not per layer, so a flame's three tongues stay
  // recognisably the same fire while no two fires look alike.
  //
  // Size, temperature, flicker phase and taper already varied and the population still
  // read as one billboard, because all of them are variations *within a single upright
  // symmetrical teardrop*. What actually separates one fire from another at a glance is
  // its axis and its bulk: a fire on a windward corner leans and stays leaning, a fire in
  // a sheltered recess stands up; a fire eating something wet is a low guttering lump
  // with one tongue, a fire on dry pitch is a tall three-tongued lick. So:
  //   lean    a persistent tilt of the whole flame, not a per-frame sway
  //   skew    the centre line drifting steadily to one side as it rises
  //   stretch overall height against width, independent of size
  //   layerMul how much the outer tongues show at all — low values are single-tongue fires
  //   glowRad the halo's radius relative to the flame, so bulk and glow decouple
  const shape = flames.map(() => ({
    prof: shapeRng.float(0.40, 0.98),
    aspect: shapeRng.float(0.74, 1.38),
    lean: shapeRng.float(-0.26, 0.26),
    skew: shapeRng.float(-0.42, 0.42),
    stretch: shapeRng.float(0.70, 1.44),
    layerMul: shapeRng.float(0.30, 1.0),
    glowRad: shapeRng.float(0.62, 1.52),
  }));
  let q = 0;
  for (const f of flames) {
    const sh = shape[f.index];
    for (let l = 0; l < LAYERS; l++) {
      const lateral = sh.lean + (l === 0 ? 0 : offRng.float(-0.32, 0.32));
      const phase = f.phase + l * 0.19;
      for (let c = 0; c < 4; c++) {
        const v = q * 4 + c;
        bCorner[v * 2 + 0] = CORNERS[c][0];
        bCorner[v * 2 + 1] = CORNERS[c][1];
        bCentre[v * 3 + 0] = f.pos.x;
        bCentre[v * 3 + 1] = f.pos.y;
        bCentre[v * 3 + 2] = f.pos.z;
        bParams[v * 4 + 0] = phase;
        bParams[v * 4 + 1] = f.size;
        bParams[v * 4 + 2] = l;
        bParams[v * 4 + 3] = lateral;
        bVary[v * 4 + 0] = f.temp;
        bVary[v * 4 + 1] = sh.prof;
        bVary[v * 4 + 2] = sh.aspect;
        bVary[v * 4 + 3] = f.rate;
        bVary2[v * 4 + 0] = sh.skew;
        bVary2[v * 4 + 1] = sh.stretch;
        bVary2[v * 4 + 2] = l === 0 ? 1.0 : sh.layerMul;
        bVary2[v * 4 + 3] = 0;
      }
      const o = q * 4;
      bIndex.set([o, o + 1, o + 2, o, o + 2, o + 3], q * 6);
      q++;
    }
  }

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bodyGeo.setAttribute('aCorner', new THREE.BufferAttribute(bCorner, 2));
  bodyGeo.setAttribute('aCentre', new THREE.BufferAttribute(bCentre, 3));
  bodyGeo.setAttribute('aParams', new THREE.BufferAttribute(bParams, 4));
  bodyGeo.setAttribute('aVary', new THREE.BufferAttribute(bVary, 4));
  bodyGeo.setAttribute('aVary2', new THREE.BufferAttribute(bVary2, 4));
  bodyGeo.setIndex(new THREE.BufferAttribute(bIndex, 1));

  const bodyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      // Down. A flame body this hot clips over a large area, and the frame's clipped
      // budget is small and belongs mostly to the stone: ours put 0.049 of the lower-right
      // cell over 0.92 against the film's 0.012 there. Smaller white cores, same fires.
      uIntensity: { value: 3.85 },
      uCore: { value: new THREE.Color(FIRE.core).convertSRGBToLinear() },
      uMid: { value: new THREE.Color(FIRE.mid).convertSRGBToLinear() },
      uEdge: { value: new THREE.Color(FIRE.edge).convertSRGBToLinear() },
    },
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });

  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.frustumCulled = false;
  bodyMesh.renderOrder = 20;
  group.add(bodyMesh);

  // --- glow geometry: one soft camera-facing halo per flame ---------------------------
  const gPos = new Float32Array(flames.length * 4 * 3);
  const gCorner = new Float32Array(flames.length * 4 * 2);
  const gCentre = new Float32Array(flames.length * 4 * 3);
  const gParams = new Float32Array(flames.length * 4 * 4);
  const gRad = new Float32Array(flames.length * 4);
  const gIndex = new Uint16Array(flames.length * 6);
  const GCORNERS: Array<[number, number]> = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  flames.forEach((f, i) => {
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      gCorner[v * 2 + 0] = GCORNERS[c][0];
      gCorner[v * 2 + 1] = GCORNERS[c][1];
      gCentre[v * 3 + 0] = f.pos.x;
      gCentre[v * 3 + 1] = f.pos.y;
      gCentre[v * 3 + 2] = f.pos.z;
      gParams[v * 4 + 0] = f.phase;
      gParams[v * 4 + 1] = f.size;
      gParams[v * 4 + 2] = f.temp;
      gParams[v * 4 + 3] = f.rate;
      gRad[v] = shape[i].glowRad;
    }
    const o = i * 4;
    gIndex.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6);
  });

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  glowGeo.setAttribute('aCorner', new THREE.BufferAttribute(gCorner, 2));
  glowGeo.setAttribute('aCentre', new THREE.BufferAttribute(gCentre, 3));
  glowGeo.setAttribute('aParams', new THREE.BufferAttribute(gParams, 4));
  glowGeo.setAttribute('aRad', new THREE.BufferAttribute(gRad, 1));
  glowGeo.setIndex(new THREE.BufferAttribute(gIndex, 1));

  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.036 },
      uColor: { value: new THREE.Color(FIRE.mid).convertSRGBToLinear() },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = 19;
  group.add(glowMesh);

  // --- contact pools and reflections ---------------------------------------------------
  // One flat quad per ground-standing fire, lying a centimetre above the stone. See
  // POOL_VERT / POOL_FRAG above for what it draws and why.
  const ground = flames.filter((f) => f.ground);
  const pPos = new Float32Array(ground.length * 4 * 3);
  const pCorner = new Float32Array(ground.length * 4 * 2);
  const pCentre = new Float32Array(ground.length * 4 * 3);
  const pParams = new Float32Array(ground.length * 4 * 4);
  const pIndex = new Uint16Array(ground.length * 6);
  // Along the streak the quad runs from a little behind the fire to well in front of it,
  // so the pool is never clipped by its own leading edge.
  const PCORNERS: Array<[number, number]> = [
    [-0.5, -0.35],
    [0.5, -0.35],
    [0.5, 1.0],
    [-0.5, 1.0],
  ];
  ground.forEach((f, i) => {
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      pCorner[v * 2 + 0] = PCORNERS[c][0];
      pCorner[v * 2 + 1] = PCORNERS[c][1];
      pCentre[v * 3 + 0] = f.pos.x;
      pCentre[v * 3 + 1] = f.pos.y + 0.012;
      pCentre[v * 3 + 2] = f.pos.z;
      pParams[v * 4 + 0] = f.phase;
      pParams[v * 4 + 1] = f.size;
      pParams[v * 4 + 2] = f.temp;
      pParams[v * 4 + 3] = f.rate;
    }
    const o = i * 4;
    pIndex.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6);
  });

  const poolGeo = new THREE.BufferGeometry();
  poolGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  poolGeo.setAttribute('aCorner', new THREE.BufferAttribute(pCorner, 2));
  poolGeo.setAttribute('aCentre', new THREE.BufferAttribute(pCentre, 3));
  poolGeo.setAttribute('aParams', new THREE.BufferAttribute(pParams, 4));
  poolGeo.setIndex(new THREE.BufferAttribute(pIndex, 1));

  const poolMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      // Deliberately quiet. A contact pool has to be legible, not a second light source:
      // thirty of them at any real strength put the whole kerb in the warm bin and drove
      // the frame's warm fraction to 0.197 against the film's 0.139.
      // Tighter and brighter rather than broad and faint: the pool has to be a legible hot
      // spot on the stone at the fire's foot, and area is what costs warm pixels, not peak.
      // Up a third. The blown pixels in this frame are in the wrong places: measured cell
      // by cell the film spreads its clipped highlights evenly along the bottom band
      // (0.016 / 0.015 / 0.016 / 0.016) while ours were dumped on two clumps of flame
      // (0.031 and 0.049) with the marble between them at 0.002. The film's are the fires'
      // CONTACT with the stone and their reflections in it, not the fires themselves.
      uIntensity: { value: 0.62 },
      uColor: { value: new THREE.Color(FIRE.light).convertSRGBToLinear() },
    },
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.frustumCulled = false;
  // Under the flame bodies and haloes, over everything solid.
  poolMesh.renderOrder = 12;
  group.add(poolMesh);

  // --- the real light pool ------------------------------------------------------------
  // Each of these is a genuine inverse-square source sitting inside its flame's lower
  // body. That is the whole point: a flame has to burn a warm pool into the stone it
  // stands on and uplight the nearest plinth, or it reads as a sprite pasted over the
  // frame. Range is deliberately short — blown at the base, a clear wash at two metres,
  // into the noise floor by six — and shorter than the spacing between fires, so the
  // pools stay discrete instead of merging into one warm band along the kerb. Thirty-odd
  // of them at this range still do not warm the room.
  const lights: THREE.PointLight[] = [];
  const lightCount = Math.min(opts.lightCount, flames.length);
  for (let i = 0; i < lightCount; i++) {
    const l = new THREE.PointLight(new THREE.Color(FIRE.light), 0, 9, 2.0);
    l.castShadow = false;
    group.add(l);
    lights.push(l);
  }

  // --- the bounce -----------------------------------------------------------------------
  // These used to hang six metres over the middle of each kerb with a 26 m range and a
  // decay of 1.15 — which is to say they were nearly flat across the whole board, and
  // they were laying a broad warm cast over the near marble. Measured region by region
  // that is exactly backwards: in the reference the near board reads COLD (the two centre
  // cells of the bottom band come out at hue 229 and 235) while the columns at the extreme
  // frame edges read WARM top to bottom (hue 20 / 17 / 15 down the left-hand column). We
  // had the inverse — a warm bottom band at hue 16/8/1/16 and a uniformly cold top.
  //
  // So they move to where the film's warm light actually is: low against the side walls
  // in the camera's near half, grazing up the near colonnade, with a range short enough
  // that the board and the ranks never see them. They are still a bounce term, not a key.
  //
  // Cut hard since. At 5.2 with a 13 m range these four were laying a smooth orange
  // gradient six metres up both near walls — the one part of the frame that really was
  // "evenly grazed and legible", and a third of the reason the frame read warm where the
  // film reads cold (18.2% of our pixels warm against the film's 13.9%). The film's warm
  // edges are individual FIRES sitting near the frame border, not a wash behind them.
  // Range now dies before it clears the wall face, so what is left is a faint warm
  // footing under the near piers and nothing above it.
  const bounce: THREE.PointLight[] = [];
  for (const p of [
    [-6.5, 5.8, -14.2],
    [-6.5, 5.8, 14.2],
    [2.5, 6.2, -14.2],
    [2.5, 6.2, 14.2],
  ] as const) {
    const l = new THREE.PointLight(new THREE.Color(FIRE.bounce), 0, 7.4, 2.0);
    l.position.set(p[0], p[1], p[2]);
    l.castShadow = false;
    group.add(l);
    bounce.push(l);
  }

  // CPU-side flicker uses the same shape as the shader's, but from the seeded noise so
  // the light and its geometry breathe together.
  const noise = makeNoise3(world.rng.fork('lighting-flicker-noise').int(1, 1 << 30));
  const flick = (t: number, ph: number, rate: number) =>
    noise(t * 6.7 * rate, ph * 13.0, 0) * 0.54 +
    noise(t * 15.9 * rate, ph * 29.0, 3.7) * 0.29 +
    noise(t * 2.3 * rate, ph * 5.0, 8.1) * 0.17;

  const order: number[] = flames.map((_, i) => i);
  const score: number[] = new Array(flames.length).fill(0);
  const camPos = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const toFlame = new THREE.Vector3();

  return {
    group,
    flames,
    lights,

    tick(t: number) {
      bodyMat.uniforms.uTime.value = t;
      glowMat.uniforms.uTime.value = t;
      poolMat.uniforms.uTime.value = t;
      let mean = 0;
      for (const f of flames) {
        f.flicker = THREE.MathUtils.clamp(flick(t, f.phase, f.rate) + 0.5, 0, 1);
        mean += f.flicker;
      }
      // The bounce breathes with the whole fire population, not with any one flame.
      mean = flames.length ? mean / flames.length : 0.5;
      for (const l of bounce) l.intensity = 0.82 * (0.78 + 0.44 * mean);
    },

    assign(camera: THREE.Camera) {
      if (lights.length === 0) return;
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(camFwd);

      // Rank by how much of the frame a flame's pool can possibly occupy: nearer is
      // better, and a flame behind the camera is worth nothing however close it is. This
      // beats plain distance because the wide shot looks down the long axis — the fires
      // on the far kerb are the ones drawing the eye, and pure nearest-first spends the
      // whole pool on the two flames just off the bottom edge.
      for (let i = 0; i < flames.length; i++) {
        toFlame.subVectors(flames[i].pos, camPos);
        const d = Math.max(0.6, toFlame.length());
        const facing = toFlame.dot(camFwd) / d; // cos of the angle off the lens axis
        const visible = 0.16 + 0.84 * THREE.MathUtils.smoothstep(facing, -0.35, 0.35);
        score[i] = (flames[i].size * visible) / (d * d);
        order[i] = i;
      }
      order.sort((a, b) => score[b] - score[a]);

      for (let i = 0; i < lights.length; i++) {
        const f = flames[order[Math.min(i, order.length - 1)]];
        const l = lights[i];
        // Height matters more than it looks. A flame is an extended emitter, and a point
        // light sitting on the stone gives 1/h² right under it — a searing white core a
        // few centimetres across with almost nothing past a metre. Lifting the point to
        // roughly the flame's own upper body approximates the integral over the volume:
        // the peak comes down, the useful pool widens, and the reference's ratio of
        // warm-and-bright to warm-at-all (about 1:2, ours was 2:3) falls into place.
        l.position.set(f.pos.x, f.pos.y + f.size * 0.45, f.pos.z);
        // Range is roughly halved. three's cutoff distance is a window function, not a
        // clip: contribution is unchanged near the source and forced smoothly to zero at
        // the cutoff, so shortening it leaves the pool on the stone under each fire
        // intact while gutting the 2-6 m tail. That tail was the problem — thirty-odd
        // overlapping tails is a warm ambient by another name, and it was what put the
        // ranked armies at hue 8-16 when the reference has them cold.
        //
        // Lengthened again, deliberately, and this is the reversal of the note above. That
        // note was written when the tail was the problem; the standing note now is the
        // opposite one — that the marble "holds one near-uniform value from the near kerb
        // to the far rank" because nothing about a flame reaches it. A range of 1.4 m on a
        // fire standing 0.8 m off a kerb that is 0.8 m outside the board means the light
        // dies before it crosses the border strip: geometrically it could never have put a
        // mark on the marble. At two and a half to four metres each fire lays a grazing
        // pool a square or two deep into the board and is gone by the third, which is what
        // both makes the near marble hotter than the far and keeps the pools discrete.
        l.distance = 2.35 + f.size * 2.0;
        l.intensity = (1.85 + f.size * 3.9) * (0.60 + 0.72 * f.flicker);
        l.color.copy(f.tint);
      }
    },

    dispose() {
      bodyGeo.dispose();
      bodyMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      poolGeo.dispose();
      poolMat.dispose();
      for (const l of lights) l.dispose();
      for (const l of bounce) l.dispose();
    },
  };
}
