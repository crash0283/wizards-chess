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
import { BED_Y, CHAMFER, JOINT, JOINT_W, TOP_Y } from './layout';

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
  // 14 x 14 quads on the polished top at the high tier, 6 x 6 at the low one. The height
  // field the grid samples is unchanged — the dish, the drop, the tilt and the chipped
  // corners are all still there and still the same shape — there are simply fewer
  // vertices holding it. At 2.35 m a square that is a 39 cm quad, and the terms this mesh
  // carries are millimetres deep: what breaks the silhouette survives, what is finer than
  // the phone's pixel does not need a vertex.
  const n = world.quality === 'high' ? 14 : 6;
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
#ifdef BOARD_MERGED
attribute vec2 aLoc;
#endif
`;

const VERT_BODY = /* glsl */ `
  vec4 bWorld = modelMatrix * vec4(transformed, 1.0);
  vWPos = bWorld.xyz;
  vReflUV = uReflMatrix * bWorld;
  // Object space, so the inlaid band round the slab's edge sits exactly on the edge
  // however the slab is yawed and tilted.
  //
  // At the low tier the sixty-four slabs are merged into two meshes, so the vertex has
  // already been moved to its place on the board and transformed.xz is no longer the
  // slab's own coordinate. The merge bakes that coordinate into aLoc instead — the same
  // number the unmerged path computes, carried rather than derived — so the joint band,
  // the per-slab marble rotation and the chamfer all land exactly where they did.
#ifdef BOARD_MERGED
  vLoc = aLoc;
#else
  vLoc = transformed.xz;
#endif
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
uniform vec3 uJointBed;
uniform vec3 uJointPale;
uniform vec3 uJointSeam;
uniform float uJointAO;
uniform vec3 uFigure;
uniform float uFigureWeight;
uniform float uVeinScale;
uniform float uVeinWidth;
uniform float uHairWeight;
uniform float uVeinWeight;
uniform float uHaloWeight;
uniform float uPolish;
uniform float uWornRough;
uniform float uBump;
uniform float uSquareTint;
uniform float uCrack;
uniform float uDusting;
uniform float uSpecular;

${NOISE_GLSL}
${WEAR_GLSL}
${REFLECT_GLSL}

const float B_SQ = ${SQUARE.toFixed(4)};
const float B_HALF_TOP = ${HALF_TOP.toFixed(5)};
const float B_JOINT_W = ${JOINT_W.toFixed(5)};
/**
 * The chamfer, expressed in the joint's own units, so the groove's cavity term can cover
 * the cut edge outboard of the arris as well as the mortar run inboard of it. The chamfer
 * is part of the same mesh and was, until now, being shaded as polished marble — a
 * 16 mm bevel turned up towards the room, catching a full specular, immediately outboard
 * of an already blown mortar band.
 */
const float B_CHAM_T = ${(CHAMFER / JOINT_W).toFixed(5)};

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
  // The 2.3 cm grit octave. bMicro is evaluated three times per fragment for the normal's
  // finite difference, so this one line is three noise lookups — and at the low tier's
  // pixel it is under the band limit, i.e. three lookups multiplied by zero.
#ifndef BOARD_LOW
  h += 0.00016 * (0.4 + grit) * bNoise(w * 44.0) * bFade(0.023, px);
#endif
  return h;
}

/**
 * Hairline cracks. World space, so they run across joints without noticing them.
 *
 * The crack is 1.4 cm wide, so on the phone bFade returns zero for it across the whole
 * field — but the domain-warped turbulence feeding it is the single most expensive call
 * in this shader (two three-octave fbms, twenty-four hashes) and it was being paid for in
 * full to produce that zero.
 */
float bCracks(vec2 w, float px){
#ifdef BOARD_LOW
  return 0.0;
#else
  float a = bTurb(w * 0.26, 3);
  float c = 1.0 - smoothstep(0.0, 0.0018, abs(a - 0.5));
  return c * bFade(0.014, px);
#endif
}

// Filled by the albedo stage and read again by the roughness and normal stages.
float gRough;
float gReflMask;
float gReflJitter;
vec3 gNormalPert;
// Multiplied into the FINAL fragment colour, after the reflection has been added.
// See the note in FRAG_OUT: the figure has to survive the mirror, not sit under it.
vec3 gFigure;
// Scales the microfacet lobe. See FRAG_LIGHTS_END.
float gSpecular;
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

  // --- the figure ---------------------------------------------------------------------
  // The reference's light squares carry bold dark branching ink-veins running right
  // across a square: not mottling, a drawn graphic, twenty centimetres wide, forking,
  // with hairline tributaries hanging off it. See bMarbleFigure in glsl.ts — and note
  // that the previous build's leading generation ran at one crossing per EIGHT metres,
  // which is why this used to come out as an airbrushed smear rather than as figure.
  vec4 fig = bMarbleFigure(mp, uVeinWidth, px, uHairWeight);
  float core = fig.x;
  float halo = fig.y;
  float cloud = fig.z;
  float hair = fig.w;

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
  // Polish worn off: the stone goes lighter, chalkier, less saturated. Kept off the
  // figure — a worn patch dulls the shine, it does not bleach the vein out of the stone.
  albedo = mix(albedo, mix(albedo, uFresh, 0.55), worn * 0.55 * (1.0 - core * 0.85));
  // Grime worked down into a crack.
  albedo = mix(albedo, uSoil, crack * 0.8);
  // Knocked-off corners show raw, unweathered stone.
  albedo = mix(albedo, uFresh, chip * 0.55);

  // --- dust and scuff standing on the polish -----------------------------------------
  // Everywhere, not only where something has landed. In the reference the reflection is
  // broken up and dulled across the whole field by a dry film of stone dust and by
  // traffic scuffing drawn out along the direction of play; without this layer the
  // marble renders as wet plastic, which is the single loudest tell.
  float grime = smoothstep(0.20, 0.78, bFbm(w * 0.60 + 3.0, 4));
  float scuff = smoothstep(0.48, 0.92, bNoise(vec2(w.x * 0.55 + w.y * 0.20, w.y * 6.5 - w.x * 1.1)))
              * bFade(0.16, px);
  float film = clamp(grime * 0.78 + scuff * 0.60, 0.0, 1.0) * uDusting;
  // This one mix was the second-largest error on the navy squares, after the joint band.
  // uDust is a mid grey — a hundred and thirty times the linear value of the navy's own
  // albedo — so mixing a quarter of it in took a dark square from the film's (28,27,34)
  // to about (128,...) on its own, before the mirror had added anything. A polished floor
  // between the flames is CLEAN; the dust that matters is the dust the game throws, which
  // arrives through the wear map below. This layer is now a whisper.
  albedo = mix(albedo, uDust, film * 0.16);

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
  // The 3 cm sand. Sub-pixel on the phone; the 8 cm chips above it are not, and they are
  // the size that actually reads as grit standing on a polished floor.
#ifdef BOARD_LOW
  float speckB = 0.0;
#else
  float speckB = smoothstep(0.84, 0.94, bNoise(w * 34.0)) * bFade(0.029, px);
#endif
  float edge = max(abs(loc.x), abs(loc.y));
  float toJoint = smoothstep(B_HALF_TOP * 0.80, B_HALF_TOP, edge);
  float grits = clamp(speckA * 0.55 + speckB, 0.0, 1.0)
              * (0.16 + 1.2 * dustMask + 0.35 * worn + 0.40 * toJoint + 0.5 * film);
  albedo = mix(albedo, uDust * 0.78, clamp(grits, 0.0, 1.0) * 0.20);

  // --- the joint: a groove, and the darkest run on the board ------------------------------
  //
  // THE POLARITY ERROR THIS ROUND FIXES. The joint material was a pale lime mortar —
  // uJointPale was 0x8b857a, LIGHTER than the light marble's own ground at 0x847d70 — laid
  // on with no cavity term, with the mirror only 96 % suppressed and with the microfacet
  // lobe not suppressed at all. At the grazing angle this shot is judged from, Fresnel
  // takes both of those to full strength, and they land on a 30 mm strip of rough mortar
  // exactly as hard as on polished marble. Measured on the mid-field: the joint came back
  // at L227 with the cream square beside it at L204 and the navy at L23. Every square
  // boundary was the brightest thing on the board, so the field read as a wireframe grid
  // laid over stone rather than as slabs set into a bed.
  //
  // In the reference it is the other way round at every distance from the near kerb to the
  // back rank. Probed at 4x on \`wide-establishing\`, a joint measures L≈95 with the cream
  // square beside it at L≈140: a granular *shadow* between the slabs, never a rule of
  // light. It is a cut recess — 24 mm open, 9.5 mm deep — and everything down inside it,
  // mortar and chamfer alike, is in its own shade.
  //
  // Four things put it back the right way round, and all four are needed:
  //   - the mortar's own albedo is now darker than the ground of the stone it is set
  //     between, per stone (see JOINT_STONE on each MarbleSpec) — so the joint is darker
  //     than the cream AND darker than the navy without either material having to know
  //     what is on the far side of it;
  //   - the whole open run — the mortar plus the chamfer that falls away to the bed — is
  //     multiplied by a cavity term at the very end of the fragment, past the reflection,
  //     so it can only lose light, never gain it;
  //   - the mirror is switched off in it outright rather than 96 % of the way;
  //   - the microfacet lobe is switched off in it too. That one was most of the blow-out.
  //
  // The old comment below is kept because the coverage arithmetic it describes is still
  // exactly what makes the joint fade to a thin line at the back rank instead of flooding
  // the field, and it took several rounds to get right.
  //
  // A joint, and nothing more. The previous build ran a two-row inlaid tessera chequer
  // down all 112 internal joints of the field; at the distance this shot is judged from
  // that resolves to a dashed line — a flat marching-ants marquee round every square,
  // with no relief and no counterpart in the film. In the reference the inlaid work is
  // ONE carved band between the field and the kerb (see surround.ts) and the joints
  // between squares are a narrow run of pale grit with a dark seam down the middle.
  //
  // THE ARITHMETIC HERE WAS THE WHOLE PROBLEM, and it had been for several rounds. The
  // band coordinate was clamped at 1.4 while its outer edge was antialiased with
  // smoothstep(0.96, 1.0 + 3 * aa, bt), and aa saturated at 0.5 as soon as a pixel got
  // as wide as the band. That smoothstep then ran from 0.96 to 2.5 — past the clamp — so
  // in the MIDDLE of every slab it evaluated to only 0.25, leaving the joint material
  // covering three quarters of the square. Every slab in the mid-field was being painted
  // with grey mortar. That is the "matte painted concrete", that is why the cream and the
  // navy had collapsed to the same mid blue-grey, and that is why no amount of veining
  // showed: it was all underneath a wash.
  //
  // Written properly: bt is not clamped, and the edge is a single antialiased step at
  // bt = 1 whose width is the pixel footprint. Once the joint goes sub-pixel the step
  // becomes a partial coverage blend, which is exactly right — the joint greys out
  // towards the far end of the board instead of flooding the field.
  // Written properly, and written as the exact box-filter COVERAGE rather than as a
  // smoothstep. bt is the distance in from the slab's arris in units of the joint's own
  // width, so this slab's half of the joint is exactly bt in [0, 1]. A pixel centred at
  // bt with footprint aaT covers the overlap of [bt - aaT, bt + aaT] with that interval,
  // and the fraction of the pixel that overlap occupies IS how much joint the pixel is
  // looking at. Once the joint goes sub-pixel at the far end of the board that fraction
  // falls off as 1/aaT and the joint correctly fades to a thin grey line — where a
  // smoothstep, whose centre is always full strength however wide its shoulders, instead
  // draws a fat bright bead chain right to the vanishing point.
  float aaT = max(px / B_JOINT_W, 0.02);
  float bt = (B_HALF_TOP - edge) / B_JOINT_W;
  float band = max(min(1.0, bt + aaT) - max(0.0, bt - aaT), 0.0) / (2.0 * aaT);
  // The same box filter taken over the WHOLE open run, [-B_CHAM_T, 1]: the mortar inboard
  // of the arris plus the cut chamfer outboard of it. That bevel is geometry, not paint —
  // it belongs to the recess and has to darken with it, and it was previously shading as
  // polished marble tipped up towards the room.
  float groove = max(min(1.0, bt + aaT) - max(-B_CHAM_T, bt - aaT), 0.0) / (2.0 * aaT);
  vec3 jt = bJoint(bt, w, px);
  vec3 jointCol = mix(uJointBed, uJointPale, jt.x);
  jointCol = mix(jointCol, uJointSeam, jt.y * 0.90);
  albedo = mix(albedo, jointCol, band * 0.96);

  // Grime dragged out of the joint across the slab's arris — the outer few centimetres of
  // a slab are always dirtier than its middle.
  albedo = mix(albedo, uSoil, toJoint * 0.22 * (1.0 - band));

  diffuseColor.rgb *= albedo;

  // --- the figure, again, on top of everything ------------------------------------------
  // Albedo alone cannot carry the veining in this shot. At the grazing angle the judging
  // camera sits at, the Fresnel term takes the mirror to full strength, and a reflection
  // ADDED to a surface swamps whatever that surface's colour was: the marble goes to
  // featureless glossy white and the figure disappears under it — which is exactly the
  // wet-plastic floor the reference is not.
  //
  // So the figure is also applied multiplicatively at the very end of the fragment, past
  // the reflection add. That is physically the right place for it as well: vein stone is
  // softer, takes less polish and scatters more, so it is darker in BOTH the diffuse and
  // the specular, and a dark vein under a bright reflection stays a dark vein.
  //
  // uFigure is < 1 for the light marble (ink veins) and > 1 for the dark (pale veins),
  // so one expression serves both armies' stone.
  float figure = clamp(core + hair * 0.45, 0.0, 1.0);
  gFigure = mix(vec3(1.0), uFigure, figure * uFigureWeight);
  // Broad value structure across the slab, WELL below vein scale — and kept small. At
  // 0.82 + 0.34 * cloud this term swung a slab's value by forty per cent over a metre and
  // a half, which is precisely the "soft airbrushed low-frequency smear" that was
  // standing in for figure. The veins carry the graphic; this only keeps the far half of
  // the board off a single flat tone.
  gFigure *= 0.955 + 0.09 * cloud;
  // Dust and scuffing stand ON the polish, so they lift the surface rather than tint it.
  gFigure *= 1.0 + film * 0.10 + clamp(grits, 0.0, 1.0) * 0.12;
  // The joint is its own material: leave it out of the marble's figure entirely.
  gFigure = mix(gFigure, vec3(1.0), band);
  // ...and then take the whole recess DOWN. This is the cavity term, and it is applied
  // here, multiplicatively, on the FINAL colour — past the reflection add in FRAG_OUT —
  // precisely because that is the only place a groove can be guaranteed darker than the
  // stone either side of it whatever the mirror and the key are doing. Anything mixed
  // into the albedo alone is swamped at a grazing angle; that is how the joint came to be
  // the brightest thing on the board in the first place.
  gFigure *= 1.0 - (1.0 - uJointAO) * groove;

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
  rough += film * 0.58;
  // Grit and mortar take no polish at all.
  rough += groove * (0.55 + 0.18 * jt.x);
  rough += (bNoise(w * 3.1) - 0.5) * 0.09;
  rough += clamp(grits, 0.0, 1.0) * 0.40;
  // Polishing swirl: fine directional scratches, laid per slab. They only exist within
  // a couple of metres of the lens, which is exactly where they are wanted — and the
  // phone's near half-metre is the one place its pixel could hold them, so they are the
  // cheapest thing on the board to let go of.
#ifndef BOARD_LOW
  vec2 sd = vec2(ca, sa);
  float scratch = bNoise(vec2(dot(loc, sd) * 62.0, dot(loc, vec2(-sd.y, sd.x)) * 5.0));
  rough += (scratch - 0.5) * 0.16 * bFade(0.032, px);
#endif
  gRough = clamp(rough, 0.045, 1.0);
  gReflMask = clamp((1.0 - dustMask * 1.25) * (1.0 - worn * 0.7) * (1.0 - score) * (1.0 - chip)
                    * (1.0 - film * 0.86) * (1.0 - core * 0.78) * (1.0 - groove), 0.0, 1.0);
  gReflJitter = (grime - 0.5) * 0.9 + (scuff - 0.5) * 0.5;

  // --- how much specular this stone is allowed --------------------------------------
  // Roughness alone cannot fix a floor that reads as wet plastic. At the grazing angle
  // this shot is judged from, Fresnel takes the microfacet lobe to full strength on
  // every square, and because that lobe is white and ADDITIVE it lands identically on
  // cream marble and on navy — which is what collapsed a five-to-one chequer to one
  // point four and left the field a featureless sheet.
  //
  // Widening the lobe only smears the same energy about. What actually kills it on a
  // real floor is the dry film of stone dust standing on the polish: it does not
  // scatter forward, it hides the polish underneath. So the lobe is scaled here, before
  // it is summed, by how much dust, wear and soft vein stone is in the way.
  gSpecular = uSpecular * clamp(1.0 - film * 0.85 - dustMask * 0.95 - worn * 0.55
                               - core * 0.45 - clamp(grits, 0.0, 1.0) * 0.6, 0.10, 1.0)
            // Nothing down inside the recess takes a specular. The lobe firing across the
            // mortar and the chamfer at full Fresnel strength was the single largest term
            // in the blown white hairline this round removes; the clamp floor above is
            // deliberately bypassed here, because a groove really does return none.
            * (1.0 - groove * 0.97);

  // --- micro normal ----------------------------------------------------------------------
  float amp = uBump * (1.0 + worn * 2.2 + dustMask * 3.0 + chip * 4.0);
  float ee = max(0.006, px * 0.75);
  float h0 = bMicro(w, grit, px);
  float hx = bMicro(w + vec2(ee, 0.0), grit, px);
  float hz = bMicro(w + vec2(0.0, ee), grit, px);
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee) * amp;
  // A crack is a real kink in the surface, not a painted line. Both of these ride on a
  // term the low tier has already band-limited away (crack, and 2.6 cm grit), so on the
  // phone they are four noise lookups scaled by zero.
#ifndef BOARD_LOW
  gNormalPert += vec3(bNoise(w * 24.0) - 0.5, 0.0, bNoise(w * 24.0 + 7.0) - 0.5) * crack * 0.35;
  gNormalPert += vec3(bNoise(w * 46.0) - 0.5, 0.0, bNoise(w * 46.0 + 3.0) - 0.5)
               * clamp(grits, 0.0, 1.0) * 0.30 * bFade(0.026, px);
#endif
  // The joint is a groove: the surface turns down into the seam where the two stones
  // meet, and the mortar between them is coarse. jt.z is now dominated by that downturn
  // rather than by the grit, so the run reads as one continuous shadowed cut instead of
  // as a chain of lit specks — the grit noise here used to run at 0.55 amplitude on a
  // strip a pixel or two wide, which is the definition of stippling and put a large slice
  // of this render's edge energy into the finest band, where the film has none.
  vec2 acrossDir = (abs(loc.x) > abs(loc.y)) ? vec2(sign(loc.x), 0.0) : vec2(0.0, sign(loc.y));
  gNormalPert += vec3(acrossDir.x, 0.0, acrossDir.y) * band * jt.z * 0.34;
  // 1.6 cm mortar grain in the normal — the finest term on the board, and the first one
  // the phone's pixel cannot hold.
#ifndef BOARD_LOW
  gNormalPert += vec3(bNoise(w * 60.0) - 0.5, 0.0, bNoise(w * 60.0 + 11.0) - 0.5)
               * band * 0.16 * bFade(0.016, px);
#endif
`;

const FRAG_ROUGH = /* glsl */ `
  float roughnessFactor = gRough;
`;

const FRAG_LIGHTS_END = /* glsl */ `
  #include <lights_fragment_end>
  reflectedLight.directSpecular *= gSpecular;
  reflectedLight.indirectSpecular *= gSpecular;
`;

const FRAG_NORMAL = /* glsl */ `
  normal = normalize(normal + (viewMatrix * vec4(gNormalPert, 0.0)).xyz);
`;

const FRAG_OUT = /* glsl */ `
  #include <opaque_fragment>
  {
    float ndv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
    float fres = 0.05 + 0.72 * pow(1.0 - ndv, 3.1);
    vec3 nWorld = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 refl = boardReflection(vReflUV, nWorld, gRough, gReflMask, gReflJitter);
    gl_FragColor.rgb += refl * fres * uReflStrength;
    gl_FragColor.rgb *= gFigure;
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
    .replace('#include <lights_fragment_end>', FRAG_LIGHTS_END)
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
  /** How much of the finest tributary net this stone carries. */
  hairWeight: number;
  haloWeight: number;
  polish: number;
  wornRough: number;
  squareTint: number;
  crack: number;
  reflect: number;
  /** How much dry dust and scuffing lies on the polish and breaks the reflection. */
  dusting: number;
  /** Ceiling on the microfacet lobe. See FRAG_LIGHTS_END — this is the wet-plastic dial. */
  specular: number;
  /**
   * Luminance knee for the mirror, per stone. The navy squares need a far harder one
   * than the cream: their own albedo is near-black, so ANY reflected ambient is the
   * whole of what you see on them, whereas on the cream marble it is a minority of a
   * bright surface. See boardReflection.
   */
  reflKnee: number;
  /**
   * Per-channel gain applied to the FINAL colour on the figure, after the reflection has
   * been added: below 1 for the light marble's ink veins, above 1 for the dark marble's
   * paler ones. This is what makes the figure survive the mirror — see FRAG_OUT.
   */
  figure: [number, number, number];
  figureWeight: number;
  /**
   * The mortar in the joint round this stone, and how much light the recess itself keeps.
   *
   * Per stone, because a joint has to be darker than the marble on BOTH sides of it and
   * neither material can see across the gap: each slab shades its own half of the run, so
   * the cream's half is set below the cream and the navy's half below the navy. That is
   * also true of a real floor — the mortar takes its colour from what has washed out of
   * the stone beside it — and it is what makes a single line of code satisfy "no joint is
   * brighter than the square next to it" at every square on the board.
   *
   * `ao` multiplies the FINAL colour over the whole open run (mortar plus chamfer). 1.0
   * would be no recess at all.
   */
  joint: { bed: number; pale: number; seam: number; ao: number };
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
    // Probed against the frame, square for square: the film's light squares sit at
    // (162,168,189) with their darkest vein cores around (104,113,126). This build was
    // rendering (150,190,241) — the right VALUE but blue over red by ninety counts where
    // the film is only twenty-seven. That excess blue was not albedo, it was the mirror
    // and the environment lobe adding the cold room on top of the stone; with those two
    // cut back the albedo has to carry more of the value itself, and it is warm
    // off-white limestone, not a blue-grey, so the cold key lands it where the film is.
    // Levelled against the frame with everything else already right: the film's light
    // squares are (162,168,189), this build was rendering (210,241,254) — half a stop
    // hot and cyan with it. The room's key on this floor is much stronger than a
    // near-white albedo can absorb, so the stone itself has to be a mid warm limestone
    // for the RENDERED square to come out the cream the film shows. Reading the albedo
    // hex and expecting the pixel is the mistake; these are chosen from the pixel back.
    baseA: 0x847d70,
    baseB: 0x716b60,
    vein: 0x30343c,
    halo: 0x66635c,
    fresh: 0x96918a,
    soil: 0x24262a,
    // Half-width of the trunk generation, in field units. With bMarbleFigure's new 0.75
    // cycles/m leading generation this lays two to four bold strokes across a 2.35 m
    // slab, swelling into pools and tapering out, over roughly a fifth of its area —
    // measured off the reference at 4x.
    veinScale: 1.00,
    veinWidth: 0.048,
    veinWeight: 0.96,
    hairWeight: 1.0,
    haloWeight: 0.30,
    // Polished, not lacquered. Under 0.3 the specular lobe is tight enough that the
    // environment returns a hard sheen on every square and the stone stops reading.
    polish: 0.42,
    wornRough: 0.34,
    squareTint: 0.14,
    crack: 0.85,
    // The mirror is now put through a luminance knee (see boardReflection), so this
    // number buys reflected FLAMES AND PLINTHS rather than a reflected ambient wash. It
    // can therefore be higher than before and still leave the chequer standing.
    reflect: 0.16,
    dusting: 0.55,
    specular: 0.14,
    reflKnee: 0.60,
    figure: [0.56, 0.58, 0.62],
    figureWeight: 1.0,
    // Set below the cream's own ground (0x847d70), not above it. The reference's joint
    // sits at roughly two thirds of the light square's value and is granular rather than
    // ruled, so the spread between bed and pale is small and both ends are dark.
    joint: { bed: 0x2f2c27, pale: 0x474138, seam: 0x121113, ao: 0.44 },
  },
  dark: {
    // The number that matters most on this whole piece. Probed square by square against
    // the frame, the film's dark squares have a MEDIAN of (28,27,34) — near-black, barely
    // blue at all in the body of the stone — with occasional bright smears up to about
    // (96,107,124) where a flame or a lit plinth is reflected in them. Their light
    // neighbours sit at (162,168,189). That is a chequer of nearly six to one, and eight
    // rows of those edges stacked up the floor plane are the largest single source of
    // gradient energy in the frame.
    //
    // This build was rendering the navy at (90,114,134) against (150,190,241): barely
    // two to one, so the chequer had all but stopped existing and the field read as one
    // sheet of mid blue-grey. The albedo was not the problem — it was already near-black
    // — the additive mirror and specular were, which is why the fix lives mostly in
    // boardReflection's luminance knee and in these two ceilings.
    // Blue, not merely dark. The film's navy measures (28,27,34) in the body of a near
    // square and (22,32,52) out at the far end where the air lifts it — barely saturated
    // up close but unmistakably BLUE stone, which is what separates it from black slate.
    baseA: 0x070c1e,
    baseB: 0x040713,
    // The navy's own figure is PALER than its ground, so every one of these knobs is a
    // brightening one and every one of them is a chance to turn a dark square into
    // granite. The film's dark squares are very nearly plain: a quiet cloudy wisp, no
    // hairlines at all at this distance. Hence hairWeight a quarter and the vein itself
    // a muted slate rather than the near-white it was.
    vein: 0x36426a,
    halo: 0x1a2237,
    fresh: 0x1e2432,
    soil: 0x070809,
    veinScale: 0.80,
    veinWidth: 0.036,
    veinWeight: 0.55,
    hairWeight: 0.25,
    haloWeight: 0.24,
    polish: 0.46,
    wornRough: 0.28,
    squareTint: 0.12,
    crack: 0.55,
    // The navy squares do carry the reflected ranks and flames — as isolated bright
    // smears inside a near-black field, never as a wash over it. The knee is what makes
    // that distinction possible; this is only how much of the surviving highlight lands.
    // Measured: the film's navy sits at (28,27,34) and this build was at (86,111,138).
    // Every count of that gap was the mirror — the stone's own albedo cannot reach 108 —
    // so the strength comes down and, far more importantly, the knee goes up until only
    // the flames and the lit plinth faces survive it. What is left is what the film
    // shows: a near-black square with a few bright smears lying down it.
    reflect: 0.065,
    dusting: 0.25,
    specular: 0.014,
    reflKnee: 2.8,
    figure: [1.42, 1.40, 1.32],
    figureWeight: 0.55,
    // The navy's own ground is 0x070c1e, so its half of the joint has to go below that or
    // the grid comes straight back as a pale line drawn round every dark square — which
    // is the more visible half of the wireframe tell, because the navy is the darker
    // field. Near-black, with the seam blacker still.
    joint: { bed: 0x080a10, pale: 0x0f1219, seam: 0x030407, ao: 0.55 },
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
    low: boolean;
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
    // Stone powder, not chalk. See the film mix in FRAG_COLOR for why its VALUE matters
    // far more here than its hue.
    uDust: { value: c(0x74736d) },
    uJointBed: { value: c(s.joint.bed) },
    uJointPale: { value: c(s.joint.pale) },
    uJointSeam: { value: c(s.joint.seam) },
    uJointAO: { value: s.joint.ao },
    uFigure: { value: new THREE.Vector3(s.figure[0], s.figure[1], s.figure[2]) },
    uFigureWeight: { value: s.figureWeight },
    uDusting: { value: s.dusting },
    uSpecular: { value: s.specular },
    uVeinScale: { value: s.veinScale },
    uVeinWidth: { value: s.veinWidth },
    uHairWeight: { value: s.hairWeight },
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
    uReflTint: { value: new THREE.Color(0.99, 0.99, 1.0) },
    // Luminance knee for the mirror. Everything in the mirrored room dimmer than this is
    // suppressed quadratically; flames and lit stone come back at nearly full strength.
    // See boardReflection — this is what stops the reflection being an ambient wash.
    uReflKnee: { value: s.reflKnee },
  };

  if (shared.low) {
    // No mirror pass: the analytic environment stands in for it. See REFLECT_GLSL's
    // BOARD_LOW branch — these two colours are the room as the floor sees it, in linear
    // HDR, so the per-stone knee above can tell the fires from the dark stone.
    // Levelled against the mirror, not chosen by eye: rendered at 1920x804 with the true
    // planar reflection, the field region of `wide-establishing` means (75.1, 86.0, 99.9)
    // with its dark quartile at (21.2, 25.4, 36.2) and its light quartile at
    // (169.9, 190.0, 201.5) — a chequer of 7.4 to 1. These two colours are the values that
    // reproduce that from an analytic room: with them the same region comes back at
    // (76.2, 87.4, 101.6), dark (21.8, 26.1, 37.1), light (171.3, 191.6, 203.3), a chequer
    // of 7.2 to 1 — within a percent and a half of the mirror everywhere, and the residual
    // is the dropped hairline generation, not the reflection. The phone's marble sits
    // where the mirror put it rather than somewhere plausible.
    uniforms.uEnvBand = { value: new THREE.Vector3(2.02, 2.16, 2.52) };
    uniforms.uEnvHigh = { value: new THREE.Vector3(0.046, 0.055, 0.081) };
    // The mirror's own strength, kept: the stand-in is calibrated to land the field where
    // the true mirror lands it, so the polish reads the same and the chequer holds.
    uniforms.uReflStrength.value = s.reflect;
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });
  material.name = `board-marble-${kind}`;
  if (shared.low) {
    // Set from world.quality and nothing else. The high tier never sees either define, so
    // its program is the one it always compiled.
    material.defines = { BOARD_LOW: '', BOARD_MERGED: '' };
  }
  // The environment's specular lobe is added on top of the albedo, so at the grazing
  // angle this shot is judged from it lands on light and dark squares ALIKE. Proved by
  // rendering the dark marble with a pure red albedo: the squares still came back with
  // G=127 and B=161, i.e. two thirds of what the floor was showing had nothing to do
  // with the stone's colour at all. That wash is what erased the chequer, flattened the
  // veining and gave the surface its wet-plastic tell — one number, doing more damage
  // than every texture decision in this file put together.
  //
  // The board carries its OWN mirror (see reflection.ts), so the environment specular is
  // duplicating work here as well as destroying contrast. Kept low.
  material.envMapIntensity = 0.20;
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

// ---------------------------------------------------------------------------------------
// Merging the field, for the low tier
// ---------------------------------------------------------------------------------------

export interface SlabPlacement {
  geometry: THREE.BufferGeometry;
  /** Where this slab sits on the board — its position, yaw and tilt, as one matrix. */
  matrix: THREE.Matrix4;
}

/**
 * Bake a set of placed slabs into one buffer.
 *
 * Sixty-four slabs is sixty-four draw calls, sixty-four state changes and sixty-four
 * bounding-sphere tests for a surface that is never partly present: the field is one
 * object as far as the frame is concerned. Merged by material — the light stone and the
 * dark stone — the whole field costs two calls.
 *
 * The one thing that cannot be lost in the bake is each vertex's position within its OWN
 * slab: the joint band, the chamfer and the per-slab rotation of the marble figure are
 * all functions of it. It travels as the `aLoc` attribute instead of being read off the
 * untransformed position, which is what `#ifdef BOARD_MERGED` switches to in the vertex
 * shader. Every other input — the world position the marble is evaluated in, the slab key
 * the block's rotation comes from — is unchanged by definition, because the vertices end
 * up in exactly the same place they did as separate meshes.
 */
export function mergeSlabs(parts: SlabPlacement[]): THREE.BufferGeometry {
  let vTotal = 0;
  let iTotal = 0;
  for (const p of parts) {
    vTotal += p.geometry.attributes.position.count;
    iTotal += p.geometry.index ? p.geometry.index.count : 0;
  }

  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const chip = new Float32Array(vTotal);
  const loc = new Float32Array(vTotal * 2);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);

  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vo = 0;
  let io = 0;

  for (const p of parts) {
    const g = p.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const C = g.attributes.aChip;
    const I = g.index!;
    nm.getNormalMatrix(p.matrix);

    for (let i = 0; i < P.count; i++) {
      const lx = P.getX(i);
      const ly = P.getY(i);
      const lz = P.getZ(i);
      loc[(vo + i) * 2] = lx;
      loc[(vo + i) * 2 + 1] = lz;
      v.set(lx, ly, lz).applyMatrix4(p.matrix);
      pos[(vo + i) * 3] = v.x;
      pos[(vo + i) * 3 + 1] = v.y;
      pos[(vo + i) * 3 + 2] = v.z;
      v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();
      nrm[(vo + i) * 3] = v.x;
      nrm[(vo + i) * 3 + 1] = v.y;
      nrm[(vo + i) * 3 + 2] = v.z;
      chip[vo + i] = C.getX(i);
    }
    for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo;

    vo += P.count;
    io += I.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('aChip', new THREE.BufferAttribute(chip, 1));
  out.setAttribute('aLoc', new THREE.BufferAttribute(loc, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export { HALF_SLAB, HALF_TOP };
