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
import { BED_Y, CHAMFER, JOINT, TOP_Y } from './layout';

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

  const dy = rng.float(-0.0045, 0.0045);
  const yaw = rng.float(-0.0042, 0.0042);
  const tiltX = rng.float(-0.0013, 0.0013);
  const tiltZ = rng.float(-0.0013, 0.0013);

  // A shallow worn dish, off-centre, on rather more than half the slabs. This is the
  // thing that stops the field reading as a plane with a texture on it: at a grazing
  // angle the highlight bends over each slab separately.
  const dishAmp = rng.bool(0.62) ? rng.float(0.0012, 0.0034) : 0;
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
varying float vChip;
uniform mat4 uReflMatrix;
`;

const VERT_BODY = /* glsl */ `
  vec4 bWorld = modelMatrix * vec4(transformed, 1.0);
  vWPos = bWorld.xyz;
  vReflUV = uReflMatrix * bWorld;
  vChip = aChip;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vWPos;
varying vec4 vReflUV;
varying float vChip;

uniform vec3 uBaseA;
uniform vec3 uBaseB;
uniform vec3 uVein;
uniform vec3 uHalo;
uniform vec3 uFresh;
uniform vec3 uDust;
uniform vec3 uSoil;
uniform float uVeinScale;
uniform float uVeinWidth;
uniform float uVeinWeight;
uniform float uHaloWeight;
uniform float uPolish;
uniform float uWornRough;
uniform float uBump;
uniform float uSquareTint;
uniform float uCrack;

${NOISE_GLSL}
${WEAR_GLSL}
${REFLECT_GLSL}

const float B_SQ = ${SQUARE.toFixed(4)};

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
  float h = 0.00120 * bFbm(w * 2.6, 3);
  h += 0.00042 * bNoise(w * 11.0) * bFade(0.09, px);
  h += 0.00016 * (0.4 + grit) * bNoise(w * 44.0) * bFade(0.023, px);
  return h;
}

/** Hairline cracks. World space, so they run across joints without noticing them. */
float bCracks(vec2 w, float px){
  float a = bTurb(w * 0.23, 4);
  float c = 1.0 - smoothstep(0.0, 0.0016, abs(a - 0.5));
  float b = bTurb(w * 0.55 + 37.0, 3);
  c = max(c, 0.70 * (1.0 - smoothstep(0.0, 0.0011, abs(b - 0.5))));
  return c * bFade(0.014, px);
}

// Filled by the albedo stage and read again by the roughness and normal stages.
float gRough;
float gReflMask;
vec3 gNormalPert;
`;

const FRAG_COLOR = /* glsl */ `
  vec2 w = vWPos.xz;
  float px = max(fwidth(w.x), fwidth(w.y));
  vec4 key = bSlabKey(w);
  vec2 slabCentre = (key.xy - 3.5) * B_SQ;
  vec2 loc = w - slabCentre;

  // Cut every slab from a different part of the same block: rotate and offset the
  // marble field per slab so no two carry the same figure and none of it tiles.
  float ang = key.z * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  vec2 mp = mat2(ca, -sa, sa, ca) * loc * uVeinScale + vec2(key.z, key.w) * 137.0;

  // Veining: a domain-warped ridge network — a bold core with a soft halo bleeding off
  // it, and a finer second network of tributaries running through the same field. The
  // widths are set against the ~0.095 spread of the turbulence, so the core covers a few
  // per cent of a slab and reads as drawn rather than as mottling.
  float t1 = bTurb(mp * 0.62, 5);
  float core = bVein(t1, uVeinWidth);
  float halo = bVein(t1, uVeinWidth * 3.4);
  float t2 = bTurb(mp * 2.1 + 53.0, 4);
  float hair = bVein(t2, uVeinWidth * 0.42) * bFade(0.05, px);
  float cloud = 0.5 + 2.2 * (bFbm(mp * 0.85 + 11.0, 4) - 0.5);

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
  albedo = mix(albedo, uVein, hair * uVeinWeight * 0.6);
  // Per-slab value shift. Some squares are simply darker stone than their neighbours.
  albedo *= 0.90 + 0.20 * key.w;
  // Polish worn off: the stone goes lighter, chalkier, less saturated.
  albedo = mix(albedo, mix(albedo, uFresh, 0.55), worn * 0.75);
  // Grime worked down into a crack.
  albedo = mix(albedo, uSoil, crack * 0.8);
  // Knocked-off corners show raw, unweathered stone.
  albedo = mix(albedo, uFresh, chip * 0.55);
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
  // Grit drifts to the edges of a slab and gathers along the joint, where nothing
  // sweeps it away — so the joints read as trenches full of dust, not as drawn lines.
  float edge = max(abs(loc.x), abs(loc.y));
  float toJoint = smoothstep(${(HALF_TOP * 0.72).toFixed(3)}, ${HALF_TOP.toFixed(3)}, edge);
  float grits = clamp(speckA * 0.55 + speckB, 0.0, 1.0)
              * (0.16 + 1.2 * dustMask + 0.35 * worn + 0.75 * toJoint);
  albedo = mix(albedo, uDust * 0.78, clamp(grits, 0.0, 1.0) * 0.30);
  albedo = mix(albedo, uSoil, toJoint * 0.20);

  diffuseColor.rgb *= albedo;

  // --- roughness ------------------------------------------------------------------------
  // Polished marble is not uniformly polished. The veins are softer stone and take less
  // of a shine, the worn patches take none, dust kills it outright. This variation is
  // most of what makes the specular read as stone rather than as plastic.
  float rough = uPolish;
  rough += core * 0.26 + halo * 0.05;
  rough += worn * uWornRough;
  rough += crack * 0.35;
  rough += chip * 0.62;
  rough += dustMask * 0.62;
  rough += score * 0.35;
  rough += (bNoise(w * 3.1) - 0.5) * 0.09;
  rough += clamp(grits, 0.0, 1.0) * 0.40;
  // Polishing swirl: fine directional scratches, laid per slab. They only exist within
  // a couple of metres of the lens, which is exactly where they are wanted.
  vec2 sd = vec2(ca, sa);
  float scratch = bNoise(vec2(dot(loc, sd) * 62.0, dot(loc, vec2(-sd.y, sd.x)) * 5.0));
  rough += (scratch - 0.5) * 0.16 * bFade(0.032, px);
  gRough = clamp(rough, 0.035, 1.0);
  gReflMask = clamp((1.0 - dustMask * 1.25) * (1.0 - worn * 0.7) * (1.0 - score) * (1.0 - chip), 0.0, 1.0);

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
    float fres = 0.10 + 0.90 * pow(1.0 - ndv, 2.2);
    vec3 nWorld = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 refl = boardReflection(vReflUV, nWorld, gRough, gReflMask);
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
}

/**
 * Measured off the reference frames. Light squares: cream-white with dramatic ink-dark
 * branching veins — the single most identifiable graphic in the room. Dark squares: deep
 * navy blue-black, its figure paler than the field and far quieter.
 */
export const MARBLE: Record<'light' | 'dark', MarbleSpec> = {
  light: {
    baseA: 0xa3a19b,
    baseB: 0x8d8c86,
    vein: 0x35383a,
    halo: 0x74736c,
    fresh: 0xb2afa3,
    soil: 0x2f2e2a,
    veinScale: 1.15,
    veinWidth: 0.0200,
    veinWeight: 0.94,
    haloWeight: 0.38,
    polish: 0.13,
    wornRough: 0.34,
    squareTint: 0.16,
    crack: 0.85,
    reflect: 1.55,
  },
  dark: {
    baseA: 0x28344b,
    baseB: 0x1d2634,
    vein: 0x56657c,
    halo: 0x333e51,
    fresh: 0x40495a,
    soil: 0x14171d,
    veinScale: 0.78,
    veinWidth: 0.0115,
    veinWeight: 0.62,
    haloWeight: 0.34,
    polish: 0.10,
    wornRough: 0.28,
    squareTint: 0.14,
    crack: 0.55,
    reflect: 2.3,
  },
};

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
    uDust: { value: c(0x9a9689) },
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
