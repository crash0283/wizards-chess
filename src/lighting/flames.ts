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
  /** 0..1, refreshed every frame. Irregular, not a clean sine. */
  flicker: number;
}

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

/** Deterministic layout: the kerb ring, plus rubble and plinth flames behind the ranks. */
function layout(rng: Rng): Array<{ x: number; y: number; z: number; size: number }> {
  const out: Array<{ x: number; y: number; z: number; size: number }> = [];
  const kerb = HALF + 0.78;
  const along = [-7.85, -4.72, -1.58, 1.58, 4.72, 7.85];

  // Four kerb runs. These are the flames that read biggest in the wide shot.
  for (const a of along) {
    out.push({ x: -kerb, y: 0.3, z: a, size: rng.float(0.42, 0.6) });
    out.push({ x: kerb, y: 0.3, z: a, size: rng.float(0.42, 0.6) });
    out.push({ x: a, y: 0.3, z: -kerb, size: rng.float(0.42, 0.6) });
    out.push({ x: a, y: 0.3, z: kerb, size: rng.float(0.42, 0.6) });
  }
  // Corners of the kerb.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push({ x: sx * kerb, y: 0.32, z: sz * kerb, size: rng.float(0.5, 0.66) });
    }
  }
  // Burning in the accumulated rubble heaps behind each army.
  for (const sz of [-1, 1]) {
    for (const x of [-6.1, -2.0, 2.0, 6.1]) {
      out.push({
        x: x + rng.float(-0.6, 0.6),
        y: rng.float(0.45, 1.05),
        z: sz * rng.float(12.0, 13.6),
        size: rng.float(0.36, 0.62),
      });
    }
  }
  // A few small ones scattered up on plinth level among the ranks, either side.
  for (const sz of [-1, 1]) {
    for (const x of [-8.4, -4.0, 4.0, 8.4]) {
      out.push({
        x: x + rng.float(-0.4, 0.4),
        y: rng.float(0.55, 0.95),
        z: sz * rng.float(9.9, 11.2),
        size: rng.float(0.3, 0.46),
      });
    }
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
uniform float uTime;
varying vec2 vUv;
varying float vLayer;
varying float vPhase;
varying float vFlick;
${NOISE_GLSL}
void main(){
  vUv = vec2(aCorner.x + 0.5, aCorner.y);
  float ph = aParams.x;
  float size = aParams.y;
  vLayer = aParams.z;
  vPhase = ph;

  float fl = flicker(uTime, ph + vLayer * 0.37);
  vFlick = fl;

  float layerScale = 1.0 - vLayer * 0.27;
  float h = size * (1.78 + 0.95 * (fl - 0.5)) * layerScale;
  float w = size * (1.02 + 0.24 * (fl - 0.5)) * layerScale;

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
${NOISE_GLSL}
void main(){
  float y = clamp(vUv.y, 0.0, 1.0);

  // Turbulent centre line: the flame body wanders as it rises.
  float turb = (vnoise2(vec2(vPhase * 11.0, y * 3.4 - uTime * 2.6)) - 0.5) * 0.34 * y
             + (vnoise2(vec2(vPhase * 23.0 + 5.0, y * 7.9 - uTime * 5.1)) - 0.5) * 0.16 * y;

  // Teardrop: broad and round at the base, tapering to a wandering tip.
  float tip = 0.82 + 0.20 * vFlick;
  float prof = pow(max(0.0, 1.0 - y / tip), 0.62) * smoothstep(0.0, 0.10, y);
  prof *= 0.55 + 0.45 * vnoise2(vec2(vPhase * 3.0, y * 2.1 - uTime * 1.7));

  float d = abs(vUv.x - 0.5 - turb) / max(prof * 0.5, 1e-4);
  float a = 1.0 - smoothstep(0.35, 1.0, d);
  a *= smoothstep(0.0, 0.06, y);
  if (a < 0.012) discard;

  // Colour ramp: deep orange rim -> body -> near-white core low down.
  vec3 col = mix(uEdge, uMid, smoothstep(0.10, 0.62, a));
  float coreness = smoothstep(0.55, 0.95, a) * (1.0 - smoothstep(0.22, 0.78, y));
  col = mix(col, uCore, coreness);

  float energy = uIntensity * (0.62 + 0.90 * (1.0 - y)) * (0.72 + 0.56 * vFlick);
  energy *= 1.0 - vLayer * 0.22;
  gl_FragColor = vec4(col * a * a * energy, 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
attribute vec2 aCorner;    // -0.5..0.5 both axes
attribute vec3 aCentre;
attribute vec4 aParams;    // phase, size, unused, unused
uniform float uTime;
varying vec2 vUv;
varying float vFlick;
${NOISE_GLSL}
void main(){
  vUv = aCorner;
  float ph = aParams.x;
  float size = aParams.y;
  float fl = flicker(uTime, ph);
  vFlick = fl;
  float r = size * (1.55 + 0.35 * (fl - 0.5));
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
void main(){
  float d = length(vUv) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * a * a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a * uIntensity * (0.7 + 0.6 * vFlick), 1.0);
}
`;

export function createFlames(world: World, opts: { lightCount: number }): FlameSystem {
  const group = new THREE.Group();
  group.name = 'lighting-flames';

  const rng = world.rng.fork('lighting-flame-layout');
  const specs = layout(rng);

  const phaseRng = world.rng.fork('lighting-flame-phase');
  const flames: Flame[] = specs.map((s, i) => ({
    index: i,
    pos: new THREE.Vector3(s.x, s.y, s.z),
    size: s.size,
    phase: phaseRng.float(0, 1),
    flicker: 0.5,
  }));

  // --- body geometry: three stacked tongues per flame ---------------------------------
  const LAYERS = world.quality === 'high' ? 3 : 2;
  const bodyQuads = flames.length * LAYERS;
  const bPos = new Float32Array(bodyQuads * 4 * 3); // dummy position attribute
  const bCorner = new Float32Array(bodyQuads * 4 * 2);
  const bCentre = new Float32Array(bodyQuads * 4 * 3);
  const bParams = new Float32Array(bodyQuads * 4 * 4);
  const bIndex = new Uint16Array(bodyQuads * 6);

  const CORNERS: Array<[number, number]> = [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 1],
    [-0.5, 1],
  ];

  const offRng = world.rng.fork('lighting-flame-offset');
  let q = 0;
  for (const f of flames) {
    for (let l = 0; l < LAYERS; l++) {
      const lateral = l === 0 ? 0 : offRng.float(-0.32, 0.32);
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
  bodyGeo.setIndex(new THREE.BufferAttribute(bIndex, 1));

  const bodyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 5.0 },
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
    }
    const o = i * 4;
    gIndex.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6);
  });

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  glowGeo.setAttribute('aCorner', new THREE.BufferAttribute(gCorner, 2));
  glowGeo.setAttribute('aCentre', new THREE.BufferAttribute(gCentre, 3));
  glowGeo.setAttribute('aParams', new THREE.BufferAttribute(gParams, 4));
  glowGeo.setIndex(new THREE.BufferAttribute(gIndex, 1));

  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.012 },
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

  // --- the real light pool ------------------------------------------------------------
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < opts.lightCount; i++) {
    const l = new THREE.PointLight(new THREE.Color(FIRE.light), 0, 7.5, 2);
    l.castShadow = false;
    group.add(l);
    lights.push(l);
  }

  // CPU-side flicker uses the same shape as the shader's, but from the seeded noise so
  // the light and its geometry breathe together.
  const noise = makeNoise3(world.rng.fork('lighting-flicker-noise').int(1, 1 << 30));
  const flick = (t: number, ph: number) =>
    noise(t * 6.7, ph * 13.0, 0) * 0.54 +
    noise(t * 15.9, ph * 29.0, 3.7) * 0.29 +
    noise(t * 2.3, ph * 5.0, 8.1) * 0.17;

  const order: number[] = flames.map((_, i) => i);
  const dist: number[] = new Array(flames.length).fill(0);
  const camPos = new THREE.Vector3();

  return {
    group,
    flames,
    lights,

    tick(t: number) {
      bodyMat.uniforms.uTime.value = t;
      glowMat.uniforms.uTime.value = t;
      for (const f of flames) {
        f.flicker = THREE.MathUtils.clamp(flick(t, f.phase) + 0.5, 0, 1);
      }
    },

    assign(camera: THREE.Camera) {
      if (lights.length === 0) return;
      camera.getWorldPosition(camPos);
      for (let i = 0; i < flames.length; i++) {
        dist[i] = camPos.distanceToSquared(flames[i].pos);
        order[i] = i;
      }
      order.sort((a, b) => dist[a] - dist[b]);

      // Half the pool goes to whatever is nearest camera; the rest is strided across the
      // remainder so the far side of the room never goes completely unlit.
      const near = Math.min(lights.length, Math.max(1, Math.ceil(lights.length * 0.55)));
      const chosen: number[] = [];
      for (let i = 0; i < near && i < order.length; i++) chosen.push(order[i]);
      const rest = order.length - near;
      const want = lights.length - chosen.length;
      if (rest > 0 && want > 0) {
        const stride = Math.max(1, Math.floor(rest / want));
        for (let k = 0; k < want; k++) {
          const idx = near + Math.min(rest - 1, k * stride);
          chosen.push(order[idx]);
        }
      }
      while (chosen.length < lights.length) chosen.push(order[order.length - 1]);

      for (let i = 0; i < lights.length; i++) {
        const f = flames[chosen[i]];
        const l = lights[i];
        l.position.set(f.pos.x, f.pos.y + f.size * 0.75, f.pos.z);
        // Tight, fast falloff: bright inside a metre, gone by three.
        l.distance = 4.3 + f.size * 2.8;
        l.intensity = (1.05 + f.size * 1.7) * (0.66 + 0.62 * f.flicker);
      }
    },

    dispose() {
      bodyGeo.dispose();
      bodyMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      for (const l of lights) l.dispose();
    },
  };
}
