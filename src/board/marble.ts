/**
 * PIECE: board — the sixty-four slabs and the two marbles they are cut from.
 *
 * Reference (`wide-establishing`, `low-across-board`): the field is polished marble.
 * Light squares are cream-white carrying bold, ink-dark branching veins that run right
 * across a square; dark squares are deep navy blue-black with their own quieter, paler
 * figure. The joints are crisp. It is finished stonework — but it is a *floor*, laid,
 * walked on and centuries old, so no two slabs sit at quite the same height, none of
 * them is dead flat, corners are knocked off, hairline cracks run across them without
 * caring where the joints are, and the polish is worn through in patches.
 *
 * Geometry carries what has to break a silhouette (slab height, tilt, dish, chipped
 * corners). The shader carries everything finer than the mesh can hold.
 */
import * as THREE from 'three';
import { SQUARE } from '../core/constants';
import { makeFbm, type Rng } from '../core/rng';
import type { World } from '../core/world';
import { NOISE_GLSL, REFLECT_GLSL, WEAR_GLSL } from './glsl';
import { BED_Y, CHAMFER, INLAY_W, JOINT, TESS_CELL, TOP_Y } from './layout';

/** Half-width of a slab at bed level. */
const HALF_SLAB = (SQUARE - JOINT) / 2;
/** Half-width of the flat polished top, inside the chamfer. */
const HALF_TOP = HALF_SLAB - CHAMFER;

export interface SlabBuild {
  geometry: THREE.BufferGeometry;
  /** Mean surface height of this slab, for anything that wants to sit on it. */
  surfaceY: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
}

/**
 * One slab. Local origin at the slab centre on the board plane; the mesh carries the
 * per-slab yaw and tilt so the joints are never quite parallel.
 */
export function buildSlab(file: number, rank: number, rng: Rng, world: World): SlabBuild {
  const n = world.quality === 'high' ? 14 : 8;
  const seed = rng.int(1, 0x7fffffff);
  const fbmSurf = makeFbm(seed, 4);
  const fbmChip = makeFbm(seed ^ 0x77c1, 3);

  // Kept inside the joint depth (TOP_Y - BED_Y): a slab that dropped further than that
  // would swallow its own joint and the inlaid band worked into its edge.
  const dy = rng.float(-0.0032, 0.0032);
  const yaw = rng.float(-0.0042, 0.0042);
  const tiltX = rng.float(-0.0013, 0.0013);
  const tiltZ = rng.float(-0.0013, 0.0013);

  // A shallow worn dish, off-centre, on rather more than half the slabs. This is the
  // thing that stops the field reading as a plane with a texture on it: at a grazing
  // angle the highlight bends over each slab separately.
  const dishAmp = rng.bool(0.62) ? rng.float(0.0010, 0.0026) : 0;
  const dishX = rng.float(-0.5, 0.5) * HALF_TOP;
  const dishZ = rng.float(-0.5, 0.5) * HALF_TOP;
  const dishR = rng.float(0.55, 1.15) * HALF_TOP;

  // Chipped corners. Not every slab, and never all four.
  const corners: Array<{ sx: number; sz: number; r: number; depth: number; ph: number }> = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      if (!rng.bool(0.34)) continue;
      corners.push({
        sx,
        sz,
        r: rng.float(0.10, 0.34),
        depth: rng.float(0.006, 0.019),
        ph: rng.float(0, 100),
      });
    }
  }

  const height = (x: number, z: number): { y: number; chip: number } => {
    let y = TOP_Y + dy;
    // Slow undulation across the slab plus a fine grain — a hand-worked surface.
    y += 0.0016 * fbmSurf(x * 0.9 + 3.1, z * 0.9 - 1.7, 0.5);
    y += 0.0007 * fbmSurf(x * 4.3, z * 4.3, 9.2);
    if (dishAmp > 0) {
      const d = Math.hypot(x - dishX, z - dishZ) / dishR;
      if (d < 1) y -= dishAmp * (1 - d * d) * (1 - d * d);
    }
    let chip = 0;
    for (const c of corners) {
      const dx = x - c.sx * HALF_TOP;
      const dz = z - c.sz * HALF_TOP;
      const d = Math.hypot(dx, dz);
      const wob = 0.55 + 0.9 * fbmChip(x * 3.7 + c.ph, z * 3.7 - c.ph, 2.2);
      const k = 1 - Math.min(1, d / (c.r * wob));
      if (k > 0) {
        const amt = k * k;
        y -= c.depth * amt;
        chip = Math.max(chip, amt);
      }
    }
    return { y, chip };
  };

  const pos: number[] = [];
  const nrm: number[] = [];
  const chips: number[] = [];
  const idx: number[] = [];

  // --- polished top --------------------------------------------------------------------
  const e = (2 * HALF_TOP) / n;
  const topBase = pos.length / 3;
  for (let j = 0; j <= n; j++) {
    const z = -HALF_TOP + j * e;
    for (let i = 0; i <= n; i++) {
      const x = -HALF_TOP + i * e;
      const h = height(x, z);
      pos.push(x, h.y, z);
      // Analytic normal from the same height field, so the mesh normal and the shader's
      // micro-normal agree instead of fighting.
      const hx = height(x + 0.01, z).y - height(x - 0.01, z).y;
      const hz = height(x, z + 0.01).y - height(x, z - 0.01).y;
      const nx = -hx / 0.02;
      const nz = -hz / 0.02;
      const l = Math.hypot(nx, 1, nz);
      nrm.push(nx / l, 1 / l, nz / l);
      chips.push(h.chip);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = topBase + j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  // --- chamfer skirt, top edge down to the bed ------------------------------------------
  // Ring of the top-face boundary, then the same ring pushed out to the slab edge and
  // down to bed level. Separate vertices, so the arris stays sharp.
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) ring.push([-HALF_TOP + i * e, -HALF_TOP]);
  for (let i = 0; i < n; i++) ring.push([HALF_TOP, -HALF_TOP + i * e]);
  for (let i = 0; i < n; i++) ring.push([HALF_TOP - i * e, HALF_TOP]);
  for (let i = 0; i < n; i++) ring.push([-HALF_TOP, HALF_TOP - i * e]);

  const chamBase = pos.length / 3;
  const outward = (x: number, z: number): [number, number] => {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax > az) return [Math.sign(x), 0];
    if (az > ax) return [0, Math.sign(z)];
    return [Math.sign(x) * 0.7071, Math.sign(z) * 0.7071];
  };
  for (const [x, z] of ring) {
    const h = height(x, z);
    const [ox, oz] = outward(x, z);
    pos.push(x, h.y, z);
    const nl = Math.hypot(ox, 0.62, oz);
    nrm.push(ox / nl, 0.62 / nl, oz / nl);
    chips.push(h.chip);
    pos.push(x + ox * CHAMFER, BED_Y, z + oz * CHAMFER);
    nrm.push(ox / nl, 0.62 / nl, oz / nl);
    chips.push(Math.min(1, h.chip * 1.35));
  }
  for (let i = 0; i < ring.length; i++) {
    const a = chamBase + i * 2;
    const b = a + 1;
    const c = chamBase + ((i + 1) % ring.length) * 2;
    const d = c + 1;
    idx.push(a, b, c, c, b, d);
  }

  // --- skirt down into the bed, so no joint ever shows daylight --------------------------
  const skirtBase = pos.length / 3;
  for (const [x, z] of ring) {
    const [ox, oz] = outward(x, z);
    const px = x + ox * CHAMFER;
    const pz = z + oz * CHAMFER;
    pos.push(px, BED_Y, pz);
    nrm.push(ox, 0, oz);
    chips.push(0);
    pos.push(px, -0.12, pz);
    nrm.push(ox, 0, oz);
    chips.push(0);
  }
  for (let i = 0; i < ring.length; i++) {
    const a = skirtBase + i * 2;
    const b = a + 1;
    const c = skirtBase + ((i + 1) % ring.length) * 2;
    const d = c + 1;
    idx.push(a, b, c, c, b, d);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aChip', new THREE.Float32BufferAttribute(chips, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();

  void file;
  void rank;
  return { geometry: g, surfaceY: TOP_Y + dy, yaw, tiltX, tiltZ };
}

// ---------------------------------------------------------------------------------------
// The marble itself
// ---------------------------------------------------------------------------------------

export interface MarbleUniforms {
  [k: string]: THREE.IUniform;
}

const VERT_HEAD = /* glsl */ `
attribute float aChip;
varying vec3 vWPos;
varying vec4 vReflUV;
varying vec2 vLoc;
varying float vChip;
uniform mat4 uReflMatrix;
`;

const VERT_BODY = /* glsl */ `
  vec4 bWorld = modelMatrix * vec4(transformed, 1.0);
  vWPos = bWorld.xyz;
  vReflUV = uReflMatrix * bWorld;
  // Object space, so the inlaid band round the slab's edge sits exactly on the edge
  // however the slab is yawed and tilted.
  vLoc = transformed.xz;
  vChip = aChip;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vWPos;
varying vec4 vReflUV;
varying vec2 vLoc;
varying float vChip;

uniform vec3 uBaseA;
uniform vec3 uBaseB;
uniform vec3 uVein;
uniform vec3 uHalo;
uniform vec3 uFresh;
uniform vec3 uDust;
uniform vec3 uSoil;
uniform vec3 uInlayBed;
uniform vec3 uInlayPale;
uniform vec3 uInlayDark;
uniform vec3 uInlayMean;
uniform float uVeinScale;
uniform float uVeinWidth;
uniform float uVeinWeight;
uniform float uHaloWeight;
uniform float uPolish;
uniform float uWornRough;
uniform float uBump;
uniform float uSquareTint;
uniform float uCrack;
uniform float uDusting;

${NOISE_GLSL}
${WEAR_GLSL}
${REFLECT_GLSL}

const float B_SQ = ${SQUARE.toFixed(4)};
const float B_HALF_TOP = ${HALF_TOP.toFixed(5)};
const float B_INLAY_W = ${INLAY_W.toFixed(5)};
const float B_TESS = ${TESS_CELL.toFixed(5)};

/** Per-slab constants: a rotation and an offset into the block the slab was cut from. */
vec4 bSlabKey(vec2 w){
  vec2 s = floor(w / B_SQ + 4.0);
  return vec4(s, bHash21(s * 1.37 + 4.11), bHash21(s * 2.71 + 91.3));
}

/**
 * Micro relief, in METRES, used for the normal: the slow swell of a hand-polished
 * surface, then tooling grain, then grit. Each octave is faded out once it is finer
 * than a pixel, so the polish stays quiet at the far end of the board and is fully
 * present a metre from the lens.
 */
float bMicro(vec2 w, float grit, float px){
  float h = 0.00120 * bFbm(w * 2.6, 2);
  h += 0.00042 * bNoise(w * 11.0) * bFade(0.09, px);
  h += 0.00016 * (0.4 + grit) * bNoise(w * 44.0) * bFade(0.023, px);
  return h;
}

/** Hairline cracks. World space, so they run across joints without noticing them. */
float bCracks(vec2 w, float px){
  float a = bTurb(w * 0.26, 3);
  float c = 1.0 - smoothstep(0.0, 0.0018, abs(a - 0.5));
  return c * bFade(0.014, px);
}

// Filled by the albedo stage and read again by the roughness and normal stages.
float gRough;
float gReflMask;
float gReflJitter;
vec3 gNormalPert;
`;

const FRAG_COLOR = /* glsl */ `
  vec2 w = vWPos.xz;
  float px = max(fwidth(w.x), fwidth(w.y));
  vec4 key = bSlabKey(w);
  vec2 loc = vLoc;

  // Cut every slab from a different part of the same block: rotate and offset the
  // marble field per slab so no two carry the same figure and none of it tiles.
  float ang = key.z * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  vec2 mp = mat2(ca, -sa, sa, ca) * loc * uVeinScale + vec2(key.z, key.w) * 137.0;

  // --- veining ----------------------------------------------------------------------
  // The reference's light squares carry bold dark branching ink-veins running right
  // across a square: not mottling, a drawn graphic. So the network is built as a wide
  // core with a soft halo bleeding off it, a second generation of tributaries feeding
  // into the same warped field, and a swathe mask that makes the whole figure gather in
  // sweeps and leave clear stone between them — which is what stops it reading as noise.
  float t1 = bTurb(mp * 0.58, 5);
  float core = bVein(t1, uVeinWidth);
  float halo = bVein(t1, uVeinWidth * 4.2);
  float t2 = bTurb(mp * 1.75 + 53.0, 4);
  float sub = bVein(t2, uVeinWidth * 0.62);
  float hair = bVein(t2, uVeinWidth * 0.22) * bFade(0.045, px);
  float swathe = 0.34 + 0.92 * smoothstep(0.33, 0.76, bFbm(mp * 0.26 + 7.0, 3));
  core = clamp((core + sub * 0.78) * swathe, 0.0, 1.0);
  halo = clamp(halo * swathe, 0.0, 1.0);
  float cloud = 0.5 + 2.2 * (bFbm(mp * 0.85 + 11.0, 3) - 0.5);

  vec4 wear = boardWear(w);
  float dust = wear.x;
  float score = wear.y;
  float worn = clamp(wear.z + key.w * uSquareTint, 0.0, 1.0);
  float grit = wear.w;
  float chip = clamp(vChip * 1.5, 0.0, 1.0);

  float crack = bCracks(w, px) * uCrack;

  vec3 albedo = mix(uBaseA, uBaseB, clamp(cloud, 0.0, 1.0));
  albedo = mix(albedo, uHalo, halo * uHaloWeight);
  albedo = mix(albedo, uVein, core * uVeinWeight);
  albedo = mix(albedo, uVein * 0.88, hair * uVeinWeight * 0.55);
  // Per-slab value shift. Some squares are simply darker stone than their neighbours.
  albedo *= 0.90 + 0.20 * key.w;
  // Polish worn off: the stone goes lighter, chalkier, less saturated.
  albedo = mix(albedo, mix(albedo, uFresh, 0.55), worn * 0.75);
  // Grime worked down into a crack.
  albedo = mix(albedo, uSoil, crack * 0.8);
  // Knocked-off corners show raw, unweathered stone.
  albedo = mix(albedo, uFresh, chip * 0.55);

  // --- dust and scuff standing on the polish -----------------------------------------
  // Everywhere, not only where something has landed. In the reference the reflection is
  // broken up and dulled across the whole field by a dry film of stone dust and by
  // traffic scuffing drawn out along the direction of play; without this layer the
  // marble renders as wet plastic, which is the single loudest tell.
  float grime = smoothstep(0.38, 0.90, bFbm(w * 0.60 + 3.0, 4));
  float scuff = smoothstep(0.60, 0.97, bNoise(vec2(w.x * 0.55 + w.y * 0.20, w.y * 6.5 - w.x * 1.1)))
              * bFade(0.16, px);
  float film = clamp(grime * 0.78 + scuff * 0.60, 0.0, 1.0) * uDusting;
  albedo = mix(albedo, uDust, film * 0.26);

  // What the game has thrown at it.
  // Deposited dust is cloudy, not a wash: the map carries where it landed, the shader
  // gives it structure at 30 cm and at 3 cm so a fresh fall reads as powder on stone.
  float dustMask = clamp(dust * (0.55 + 0.9 * grit) * (0.55 + 0.85 * bFbm(w * 3.2, 3)), 0.0, 1.0);
  albedo = mix(albedo, uDust, dustMask * 0.88);
  albedo = mix(albedo, uSoil * 0.7, clamp(score, 0.0, 1.0) * 0.6);

  // Grit standing on the polish. Two sizes — 8 cm chips of stone dust and 3 cm sand —
  // both faded once they are finer than a pixel. Close to the lens this is the layer
  // that carries the frame's peak detail; at the far end of the board it is gone.
  float speckA = smoothstep(0.79, 0.90, bNoise(w * 12.5)) * bFade(0.08, px);
  float speckB = smoothstep(0.84, 0.94, bNoise(w * 34.0)) * bFade(0.029, px);
  float edge = max(abs(loc.x), abs(loc.y));
  float toJoint = smoothstep(B_HALF_TOP * 0.80, B_HALF_TOP, edge);
  float grits = clamp(speckA * 0.55 + speckB, 0.0, 1.0)
              * (0.16 + 1.2 * dustMask + 0.35 * worn + 0.75 * toJoint + 0.5 * film);
  albedo = mix(albedo, uDust * 0.78, clamp(grits, 0.0, 1.0) * 0.30);

  // --- the inlaid tessera band round the slab's edge ----------------------------------
  // Two rows of small alternating light/dark elements worked into the polished face
  // along every edge, so that a joint reads marble | inlay | dark line | inlay | marble.
  // This is the finest detail in the reference frame and it runs across the whole floor,
  // not only round the rim: it is what makes the floor plane the busiest region of the
  // image and what gives its gradients a hard, directional grid to sit on.
  float aaT = clamp(px / B_INLAY_W, 0.0008, 0.5);
  float aaS = clamp(px / B_TESS, 0.0008, 0.5);
  float bt = clamp((B_HALF_TOP - edge) / B_INLAY_W, 0.0, 1.4);
  float band = 1.0 - smoothstep(0.96, 1.0 + 3.0 * aaT, bt);
  // Mitre the two runs at 45°, the way inlay is really laid into a corner.
  float bs = (abs(loc.x) > abs(loc.y)) ? loc.y : loc.x;
  vec4 tess = bTess(clamp((bt - 0.20) / 0.62, 0.0, 1.0), bs, B_TESS, 2.0, aaT / 0.62, aaS);
  float tf = bFade(B_TESS * 0.42, px);

  vec3 bandCol = mix(uInlayBed, uInlayPale, tess.x * 0.96);
  bandCol = mix(bandCol, uInlayDark, tess.y * 0.88);
  bandCol = mix(uInlayMean, bandCol, tf);
  // Fine dark rules bounding the band, and a pale arris catching the light on the very
  // outer edge where the polished face turns down into the chamfer.
  bandCol = mix(bandCol, uInlayBed * 0.45, bRule(bt, 0.885, 0.038, aaT));
  bandCol = mix(bandCol, uInlayPale * 1.06, bRule(bt, 0.055, 0.055, aaT) * 0.75);
  // Tesserae go missing; where one has, the bed shows through and the surface drops.
  float lost = step(0.90, bHash21(floor(vec2(bs / B_TESS, bt * 2.0)) + key.zw * 61.0)) * tess.z * tf;
  bandCol = mix(bandCol, uSoil, lost * 0.85);
  albedo = mix(albedo, bandCol * (0.86 + 0.28 * bFbm(w * 7.0, 2)), band * 0.94);

  albedo = mix(albedo, uSoil, toJoint * 0.20 * (1.0 - band));

  diffuseColor.rgb *= albedo;

  // --- roughness ------------------------------------------------------------------------
  // Polished marble is not uniformly polished. The veins are softer stone and take less
  // of a shine, the worn patches take none, dust kills it outright, and the inlay is not
  // polished at all. This variation is most of what makes the specular read as stone
  // rather than as plastic — and it is what lets the veining survive the reflection
  // instead of being washed out by it.
  float rough = uPolish;
  rough += core * 0.30 + halo * 0.07;
  rough += worn * uWornRough;
  rough += crack * 0.35;
  rough += chip * 0.62;
  rough += dustMask * 0.62;
  rough += score * 0.35;
  rough += film * 0.44;
  rough += band * (0.34 + 0.22 * tess.w) + lost * 0.30;
  rough += (bNoise(w * 3.1) - 0.5) * 0.09;
  rough += clamp(grits, 0.0, 1.0) * 0.40;
  // Polishing swirl: fine directional scratches, laid per slab. They only exist within
  // a couple of metres of the lens, which is exactly where they are wanted.
  vec2 sd = vec2(ca, sa);
  float scratch = bNoise(vec2(dot(loc, sd) * 62.0, dot(loc, vec2(-sd.y, sd.x)) * 5.0));
  rough += (scratch - 0.5) * 0.16 * bFade(0.032, px);
  gRough = clamp(rough, 0.045, 1.0);
  gReflMask = clamp((1.0 - dustMask * 1.25) * (1.0 - worn * 0.7) * (1.0 - score) * (1.0 - chip)
                    * (1.0 - film * 0.86) * (1.0 - core * 0.78) * (1.0 - band * 0.92), 0.0, 1.0);
  gReflJitter = (grime - 0.5) * 0.9 + (scuff - 0.5) * 0.5;

  // --- micro normal ----------------------------------------------------------------------
  float amp = uBump * (1.0 + worn * 2.2 + dustMask * 3.0 + chip * 4.0);
  float ee = max(0.006, px * 0.75);
  float h0 = bMicro(w, grit, px);
  float hx = bMicro(w + vec2(ee, 0.0), grit, px);
  float hz = bMicro(w + vec2(0.0, ee), grit, px);
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee) * amp;
  // A crack is a real kink in the surface, not a painted line.
  gNormalPert += vec3(bNoise(w * 24.0) - 0.5, 0.0, bNoise(w * 24.0 + 7.0) - 0.5) * crack * 0.35;
  gNormalPert += vec3(bNoise(w * 46.0) - 0.5, 0.0, bNoise(w * 46.0 + 3.0) - 0.5)
               * clamp(grits, 0.0, 1.0) * 0.30 * bFade(0.026, px);
  // Each tessera stands a fraction of a millimetre proud of its bed, so a grazing light
  // finds every one of them. Across the band this is a hard, regular relief running
  // parallel to the joint — the strongest directional signal on the whole floor.
  vec2 bandDir = (abs(loc.x) > abs(loc.y)) ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  vec2 acrossDir = (abs(loc.x) > abs(loc.y)) ? vec2(sign(loc.x), 0.0) : vec2(0.0, sign(loc.y));
  float ridge = (tess.z - 0.5) * 2.0 * tf;
  gNormalPert += vec3(acrossDir.x, 0.0, acrossDir.y) * band * ridge * 0.30;
  gNormalPert += vec3(bandDir.x, 0.0, bandDir.y)
               * band * tf * (fract(bs / B_TESS) - 0.5) * 0.42;
  gNormalPert -= vec3(acrossDir.x, 0.0, acrossDir.y) * band * lost * 0.5;
`;

const FRAG_ROUGH = /* glsl */ `
  float roughnessFactor = gRough;
`;

const FRAG_NORMAL = /* glsl */ `
  normal = normalize(normal + (viewMatrix * vec4(gNormalPert, 0.0)).xyz);
`;

const FRAG_OUT = /* glsl */ `
  #include <opaque_fragment>
  {
    float ndv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
    float fres = 0.06 + 0.94 * pow(1.0 - ndv, 2.6);
    vec3 nWorld = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 refl = boardReflection(vReflUV, nWorld, gRough, gReflMask, gReflJitter);
    gl_FragColor.rgb += refl * fres * uReflStrength;
  }
`;

/** One shared function object -> three compiles one program for both marbles. */
function marbleOnBeforeCompile(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  const u = (this as unknown as { userData: { marbleUniforms: MarbleUniforms } }).userData.marbleUniforms;
  for (const k in u) shader.uniforms[k] = u[k];

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
    .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
    .replace('#include <opaque_fragment>', FRAG_OUT);
}

export interface MarbleSpec {
  baseA: number;
  baseB: number;
  vein: number;
  halo: number;
  fresh: number;
  soil: number;
  veinScale: number;
  veinWidth: number;
  veinWeight: number;
  haloWeight: number;
  polish: number;
  wornRough: number;
  squareTint: number;
  crack: number;
  reflect: number;
  /** How much dry dust and scuffing lies on the polish and breaks the reflection. */
  dusting: number;
}

/**
 * Measured off the reference frames, by sampling them.
 *
 * A light square in `wide-establishing` means (126,137,157) — a cool grey-white, blue
 * over red by thirty counts, and nowhere near blown: its brightest pixel is 194. Its
 * veins are a graphic, mid-dark blue-grey figure branching right across the slab. A dark
 * square means (36,47,69) — deep navy, roughly a third of the light square's value,
 * carrying its own paler figure. Neither albedo is warm; a warm one fights the room's
 * cold key and comes out the colour of firelight, which is the tell the frames punish
 * hardest.
 */
export const MARBLE: Record<'light' | 'dark', MarbleSpec> = {
  light: {
    baseA: 0xacb0b6,
    baseB: 0x969ba3,
    vein: 0x424a55,
    halo: 0x7b818b,
    fresh: 0xb6b8bb,
    soil: 0x2b2d31,
    veinScale: 1.05,
    veinWidth: 0.0245,
    veinWeight: 0.92,
    haloWeight: 0.42,
    polish: 0.22,
    wornRough: 0.34,
    squareTint: 0.16,
    crack: 0.85,
    reflect: 0.62,
    dusting: 1.0,
  },
  dark: {
    baseA: 0x27314a,
    baseB: 0x1a2131,
    vein: 0x5d6a84,
    halo: 0x374357,
    fresh: 0x40495a,
    soil: 0x14171d,
    veinScale: 0.80,
    veinWidth: 0.0150,
    veinWeight: 0.72,
    haloWeight: 0.38,
    polish: 0.14,
    wornRough: 0.28,
    squareTint: 0.14,
    crack: 0.55,
    reflect: 1.30,
    dusting: 0.68,
  },
};

/**
 * The inlay is the same stone whichever square it borders: a dark slate bed with small
 * pale limestone and dark serpentine tesserae set into it. `mean` is what the band
 * settles to once the individual elements drop below a pixel, so the far end of the
 * board reads as a continuous fine grey rule rather than dissolving to black.
 */
const INLAY = {
  bed: 0x33363c,
  pale: 0xcdc9bf,
  dark: 0x3b3e46,
  mean: 0x6f6f6c,
} as const;

export interface Marble {
  material: THREE.MeshStandardMaterial;
  dispose(): void;
}

export function createMarble(
  world: World,
  kind: 'light' | 'dark',
  shared: {
    wear: THREE.Texture;
    wearExtent: number;
    refl: THREE.Texture | null;
    reflMatrix: THREE.Matrix4;
    reflLod: number;
  },
): Marble {
  const s = MARBLE[kind];
  const c = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

  const uniforms: MarbleUniforms = {
    uBaseA: { value: c(s.baseA) },
    uBaseB: { value: c(s.baseB) },
    uVein: { value: c(s.vein) },
    uHalo: { value: c(s.halo) },
    uFresh: { value: c(s.fresh) },
    uSoil: { value: c(s.soil) },
    uDust: { value: c(0x9a9c99) },
    uInlayBed: { value: c(INLAY.bed) },
    uInlayPale: { value: c(INLAY.pale) },
    uInlayDark: { value: c(INLAY.dark) },
    uInlayMean: { value: c(INLAY.mean) },
    uDusting: { value: s.dusting },
    uVeinScale: { value: s.veinScale },
    uVeinWidth: { value: s.veinWidth },
    uVeinWeight: { value: s.veinWeight },
    uHaloWeight: { value: s.haloWeight },
    uPolish: { value: s.polish },
    uWornRough: { value: s.wornRough },
    uBump: { value: 1.0 },
    uSquareTint: { value: s.squareTint },
    uCrack: { value: s.crack },
    uWear: { value: shared.wear },
    uWearExtent: { value: shared.wearExtent },
    uRefl: { value: shared.refl },
    uReflMatrix: { value: shared.reflMatrix },
    uReflLod: { value: shared.reflLod },
    uReflStrength: { value: shared.refl ? s.reflect : 0 },
    uReflTint: { value: new THREE.Color(0.92, 0.96, 1.0) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });
  material.name = `board-marble-${kind}`;
  material.envMapIntensity = 0.9;
  (material as any).userData.marbleUniforms = uniforms;
  material.onBeforeCompile = marbleOnBeforeCompile;
  material.customProgramCacheKey = () => `board-marble-${world.quality}`;

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}

export { HALF_SLAB, HALF_TOP };
