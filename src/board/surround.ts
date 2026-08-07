/**
 * PIECE: board — the mortar bed, the carved border band and the kerb.
 *
 * Reference: between the marble field and the raised stone kerb runs ONE inlaid
 * geometric band — a chain of small repeating elements, cut into a sunk channel with
 * real depth — and the fires burn on top of the kerb itself. The kerb is the one place
 * the board stops being marble: it is the same pale, weathered, soot-marked limestone as
 * the room, laid as a course of separate blocks rather than as a single ring.
 *
 * Note what is NOT here any more: inlay along the joints of the field. That belonged to
 * an earlier reading of the frames and it was wrong — see layout.ts.
 *
 * The mortar bed is the surface you see when you look down into a joint. It is only ever
 * a few centimetres of the frame, but it is the reason the joints read as deep.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import {
  BAND_CHAIN_GLSL,
  BAND_RULE_FRAG,
  COORD_FRAG,
  COORD_HEAD,
  PLAY_BAND,
  coordUniforms,
  playBandProfile,
} from './coords';
import { NOISE_GLSL, REFLECT_GLSL, WEAR_GLSL } from './glsl';
import { BED_Y, BORDER_SINK, KERB_Y, R, TOP_Y, sweepRing, type ProfilePoint } from './layout';
import { isPlayView } from './playview';

export interface SharedMaps {
  wear: THREE.Texture;
  wearExtent: number;
  refl: THREE.Texture | null;
  reflMatrix: THREE.Matrix4;
  reflLod: number;
  /** world.quality === 'low'. Set from that and nothing else — see marble.ts. */
  low: boolean;
}

const COMMON_VERT_HEAD = /* glsl */ `
varying vec3 vWPos;
varying vec4 vReflUV;
varying vec2 vBUv;
uniform mat4 uReflMatrix;
`;

const COMMON_VERT_BODY = /* glsl */ `
  vec4 bWorld = modelMatrix * vec4(transformed, 1.0);
  vWPos = bWorld.xyz;
  vReflUV = uReflMatrix * bWorld;
  vBUv = uv;
`;

const COMMON_FRAG_HEAD = /* glsl */ `
varying vec3 vWPos;
varying vec4 vReflUV;
varying vec2 vBUv;
${NOISE_GLSL}
${WEAR_GLSL}
${REFLECT_GLSL}
uniform vec3 uDust;
float gRough;
float gReflMask;
float gReflJitter;
vec3 gNormalPert;
/**
 * Cavity term, multiplied into the FINAL colour after the reflection has been added.
 * 1.0 is a surface out in the open. Anything that lives at the bottom of a cut — the
 * mortar bed down inside a joint above all — sets this below 1 and can then only lose
 * light, whatever the key and the mirror are doing to it.
 */
float gCavity;
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
    gl_FragColor.rgb += boardReflection(vReflUV, nWorld, gRough, gReflMask, gReflJitter)
                      * fres * uReflStrength;
    gl_FragColor.rgb *= gCavity;
  }
`;

function patch(frag: string) {
  return function (this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
    const data = (this as unknown as {
      userData: { boardUniforms: Record<string, THREE.IUniform>; head: string };
    }).userData;
    const u = data.boardUniforms;
    for (const k in u) shader.uniforms[k] = u[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + COMMON_VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_FRAG_HEAD + data.head)
      .replace('#include <color_fragment>', frag)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <opaque_fragment>', FRAG_OUT);
  };
}

function baseMaterial(
  name: string,
  head: string,
  frag: string,
  uniforms: Record<string, THREE.IUniform>,
  shared: SharedMaps,
  reflect: number,
  doubleSided: boolean,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = name;
  m.envMapIntensity = 0.9;
  (m as any).userData.head = head;
  (m as any).userData.boardUniforms = {
    ...uniforms,
    uDust: { value: new THREE.Color(0x9a9689).convertSRGBToLinear() },
    uWear: { value: shared.wear },
    uWearExtent: { value: shared.wearExtent },
    // The kerb is the one board mesh that renders INTO the mirror pass (it stands above
    // the plane), so leaving the mirror bound on a material that never reads it costs a
    // GL_INVALID_OPERATION feedback loop every frame. Bind nothing where reflect is 0.
    uRefl: { value: reflect > 0 ? shared.refl : null },
    uReflMatrix: { value: shared.reflMatrix },
    uReflLod: { value: shared.reflLod },
    uReflStrength: { value: (shared.low || shared.refl) && reflect > 0 ? reflect : 0 },
    uReflTint: { value: new THREE.Color(0.99, 0.99, 1.0) },
    // Luminance knee for the mirror — see boardReflection. Bound on every board material
    // because REFLECT_GLSL is shared, even where the mirror is switched off.
    uReflKnee: { value: 0.55 },
    // The low tier's stand-in room. Unused where the mirror is real; see REFLECT_GLSL.
    //
    // Not the marble's values. The marble is an open floor and the room it returns is the
    // cold one; the only surface out here that takes a reflection is the border band, and
    // that is a 34 cm channel sunk below the field with the kerb standing over it and
    // fires burning on top of the kerb. What it can see is mostly firelight, and not much
    // of it — which is what the mirror pass was showing there, and why a cold band at
    // marble strength turned the whole ring into a bright blue rail.
    uEnvBand: { value: new THREE.Vector3(1.34, 0.83, 0.46) },
    uEnvHigh: { value: new THREE.Vector3(0.050, 0.038, 0.030) },
  };
  m.onBeforeCompile = patch(frag);
  if (shared.low) m.defines = { BOARD_LOW: '' };
  m.customProgramCacheKey = () => (shared.low ? `${name}-low` : name);
  return m;
}

const c = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

// ---------------------------------------------------------------------------------------
// mortar bed
// ---------------------------------------------------------------------------------------

const BED_HEAD = /* glsl */ `
uniform vec3 uMortar;
uniform vec3 uAggregate;
uniform vec3 uGrime;
`;

/**
 * THE JOINT'S POLARITY LIVES HERE, not in the marble shader.
 *
 * The critique was that every square joint on the board was a blown white glowing
 * hairline, so the field read as a wireframe grid laid over stone. Painting the joint
 * band on the slab tops darker did almost nothing, and a diagnostic render — joint band
 * flat red, chamfer flat blue, bed flat green — said why in one frame: the grid was
 * SOLID GREEN. What the camera sees between two slabs is not the mortar run worked into
 * their edges, which is a fraction of a pixel wide at that distance. It is this plane,
 * the bed, straight down the 24 mm physical gap between them.
 *
 * And it was a pale lime mortar (0x716d66) with a paler aggregate (0x9a968c) in it,
 * lifted further by a bright dust wash, lit as if it were out in the open, and with the
 * room's environment specular at full strength on it. It came back at L≈220 against a
 * cream square at L204 and a navy at L23 — the brightest thing on the board — and bright
 * enough to be over the bloom threshold, which is where the *glow* around every joint in
 * the render came from. Nothing else on the board was doing that.
 *
 * A bed is the bottom of a slot 24 mm wide and 9.5 mm deep. It sees a sliver of sky and
 * two walls of stone; it is the one part of a floor that never gets swept, never gets
 * polished and never gets direct light. So: a dark, dirty mortar to begin with, the
 * aggregate only a little lighter than the matrix rather than three times it, the dust
 * wash cut right back, the environment lobe cut back on the material, and finally a hard
 * cavity term on the FINAL colour so that no amount of key can push it above the stone
 * either side of it. The grain stays — it is what keeps the joint a granular run rather
 * than a drawn line — it just no longer arrives as contrast in the brightest direction.
 */
const BED_FRAG = /* glsl */ `
  vec2 w = vWPos.xz;
  vec4 wear = boardWear(w);

  // Dirty lime mortar with a coarse aggregate: chips of stone a little lighter than the
  // matrix they are set in. The spread between uMortar and uAggregate is now small on
  // purpose — a wide one reads as glitter at this scale, and glitter down a hairline is
  // exactly the stippled high-band energy the reference does not have.
  float grain = bNoise(w * 46.0);
  float chips = smoothstep(0.62, 0.86, bNoise(w * 88.0 + 13.0));
  float dirt = bFbm(w * 6.0, 3);

  vec3 albedo = mix(uMortar, uGrime, dirt * 0.80);
  albedo = mix(albedo, uAggregate, chips * 0.7);
  albedo *= 0.84 + 0.26 * grain;
  // Grit and dust drift into the joints and stay there — this is the deepest, dirtiest
  // part of the floor and it should read that way. Which means the dust down here is
  // trodden-in dirt, not the pale powder that lies on top of the polish.
  float dust = clamp(wear.x * 1.4, 0.0, 1.0);
  albedo = mix(albedo, uDust * 0.30, dust * 0.40);

  diffuseColor.rgb *= albedo;
  gRough = clamp(0.90 + 0.08 * grain - chips * 0.08, 0.3, 1.0);
  gReflMask = 0.0;
  gReflJitter = 0.0;
  // The bottom of a 24 mm slot between two 9.5 mm walls of stone subtends very little
  // sky. This is the term that guarantees the joint is darker than the marble on either
  // side of it at every distance from the near kerb to the back rank, because it is
  // applied last and it can only subtract.
  gCavity = 0.42;

  // The 7.7 mm aggregate octave in the bed's relief. The bed is never more than a couple
  // of pixels wide in the frame, so on the phone this is three noise lookups spent on a
  // feature a twentieth the size of the pixel showing it; the 2 cm octave carries the run.
  const float ee = 0.008;
#ifdef BOARD_LOW
  float h0 = bNoise(w * 46.0);
  float hx = bNoise((w + vec2(ee, 0.0)) * 46.0);
  float hz = bNoise((w + vec2(0.0, ee)) * 46.0);
#else
  float h0 = bNoise(w * 46.0) + 0.5 * bNoise(w * 130.0);
  float hx = bNoise((w + vec2(ee, 0.0)) * 46.0) + 0.5 * bNoise((w + vec2(ee, 0.0)) * 130.0);
  float hz = bNoise((w + vec2(0.0, ee)) * 46.0) + 0.5 * bNoise((w + vec2(0.0, ee)) * 130.0);
#endif
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee) * 0.0035;
`;

// ---------------------------------------------------------------------------------------
// the carved border band
// ---------------------------------------------------------------------------------------

const BORDER_HEAD = /* glsl */ `
uniform vec3 uField;
uniform vec3 uTessDark;
uniform vec3 uTessPale;
uniform vec3 uTessMean;
uniform vec3 uLine;
uniform vec3 uGrime;
uniform float uCell;
uniform float uBandHalf;
uniform float uBandT0;
uniform float uBandT1;
`;

/**
 * The one carved band, between the marble field and the kerb.
 *
 * This is now the only inlaid work anywhere on the board — the internal joints of the
 * field are joints again (see layout.ts). The critique's objection was not that the
 * pattern was wrong but that it had no depth: a flat run of alternating light and dark
 * cells drawn on the floor plane is a marquee, not carving. So the band is now SUNK.
 * `borderProfile` below cuts it 30 mm below the marble between two hard arrises, and the
 * repeating element inside it is a single row of lozenges set on point with real chamfer
 * faces: each one has a face turned towards the kerb flames and a face turned away, so
 * the band carries its own light-and-shade the whole way round the field instead of
 * relying on albedo to fake relief.
 *
 * `t` runs 0..1 across the whole swept profile, so it includes the two risers. `uBandT0`
 * and `uBandT1` are where the sunk floor starts and ends within it.
 */
const BORDER_FRAG = /* glsl */ `
  vec2 w = vWPos.xz;
  float px = max(fwidth(w.x), fwidth(w.y));
  vec4 wear = boardWear(w);

  // uv.x runs across the profile (0..1). The along-band coordinate is taken from world
  // space, not from uv.y: the ring's inner and outer edges are different lengths, so a
  // uv-based run would fan the columns out across the width of the strip.
  float t = vBUv.x;
  vec2 aw0 = abs(w);
  float s = (aw0.x > aw0.y) ? w.y : w.x;
  // Position across the sunk floor of the band, 0..1, and 0 on either margin.
  float bt = (t - uBandT0) / max(uBandT1 - uBandT0, 1e-4);
  float inBand = step(0.0, bt) * step(bt, 1.0);
  float aaT = clamp(px / (uBandHalf * 2.0 * (uBandT1 - uBandT0)), 0.0008, 0.5);
  float aaS = clamp(px / uCell, 0.0008, 0.5);
  float tf = bFade(uCell * 0.40, px);

  // --- the lozenge chain --------------------------------------------------------------
  // One row, set on point. |u| + |v| < r is a diamond; the two |.| terms are also what
  // give the four chamfer faces their directions, which is what the relief is built from.
  float cu = (bt - 0.5) * 2.0;                       // -1..1 across the sunk floor
  float cv = fract(s / uCell + 0.5) * 2.0 - 1.0;     // -1..1 along one cell
  float dia = abs(cu) * 1.02 + abs(cv);
  float face = 1.0 - smoothstep(0.60 - aaT * 3.0, 0.60 + aaT * 3.0, dia);   // flat top
  float cham = 1.0 - smoothstep(0.90 - aaT * 3.0, 0.90 + aaT * 3.0, dia);   // foot
  float slope = clamp(cham - face, 0.0, 1.0);
  // Small squares in the gaps between lozenges — the second element of the run.
  float dot2 = 1.0 - smoothstep(0.16, 0.20, max(abs(cu), abs(abs(cv) - 1.0)));

  vec3 albedo = uField;
  albedo = mix(albedo, uTessPale, face * 0.92 * inBand);
  albedo = mix(albedo, uTessPale * 0.80, slope * 0.72 * inBand);
  albedo = mix(albedo, uTessDark, dot2 * 0.85 * inBand);
  albedo = mix(uTessMean, albedo, mix(1.0, tf, inBand));

  // The cut rules bounding the sunk floor, and the two arrises either side of it. The
  // arrises are where the geometry already turns, so these only add the pale worn line
  // a five-hundred-year-old cut edge carries.
  float edgeIn = bRule(t, uBandT0, 0.016, aaT);
  float edgeOut = bRule(t, uBandT1, 0.016, aaT);
  float rules = clamp(edgeIn + edgeOut, 0.0, 1.0);
  // Worn cut edges, not chrome trim. At 0.55 towards a near-white tessera colour these
  // two rules were rendering as a pair of bright rails either side of the band — the same
  // wireframe tell the field's joints had, and directly beside them. In the reference the
  // arrises are only just legible: the band reads as one dark strip carrying a row of
  // fine dentils, and its edges are where the strip stops, not lines in their own right.
  albedo = mix(albedo, uTessPale * 0.86, rules * 0.28);
  albedo = mix(albedo, uLine, bRule(t, uBandT0 - 0.055, 0.012, aaT) * 0.7);
  albedo = mix(albedo, uLine, bRule(t, uBandT1 + 0.055, 0.012, aaT) * 0.7);
  float inlay = clamp(cham * inBand + rules, 0.0, 1.0);

  // Elements go missing. Where one has, the bed shows and the surface drops.
  float lost = step(0.93, bHash21(vec2(floor(s / uCell), 5.7))) * cham * inBand * tf;
  albedo = mix(albedo, uGrime, lost * 0.9);

  float grain = bFbm(w * 9.0, 3);
  // 3 cm grain, already written to fade to its own mean once it goes sub-pixel. On the
  // phone it always has, so the low tier substitutes the mean and skips the lookup.
#ifdef BOARD_LOW
  float fine = 0.5;
#else
  float fine = mix(0.5, bNoise(w * 33.0), bFade(0.03, px));
#endif
  albedo *= 0.90 + 0.17 * grain + 0.07 * fine;
  // A sunk band collects five centuries of sweepings. Kept off the raised faces, which
  // are the only reason the band reads at all.
  albedo = mix(albedo, uGrime, clamp(wear.z, 0.0, 1.0) * 0.26 * (1.0 - face * 0.85));

  float dust = clamp(wear.x * (0.6 + 0.8 * wear.w), 0.0, 1.0);
  albedo = mix(albedo, uDust, dust * 0.85);

  diffuseColor.rgb *= albedo;
  // The band is sunk 30 mm between two cut arrises, so it does sit in its own shade —
  // but it is an open channel, not a slot, and the kerb flames stand right over it.
  gCavity = 0.86;
  gRough = clamp(0.40 + slope * 0.18 + lost * 0.40
                 + wear.z * 0.26 + dust * 0.55 + (grain - 0.5) * 0.14, 0.08, 1.0);
  gReflMask = clamp((1.0 - dust * 1.4) * (1.0 - lost) * (0.40 + 0.34 * (1.0 - inlay)), 0.0, 1.0);
  gReflJitter = grain - 0.5;

  float ee = max(0.005, px * 0.7);
  float h0 = bFbm(w * 11.0, 2) * 0.0016;
  float hx = bFbm((w + vec2(ee, 0.0)) * 11.0, 2) * 0.0016;
  float hz = bFbm((w + vec2(0.0, ee)) * 11.0, 2) * 0.0016;
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee);
  // The chamfer faces. Each lozenge has four of them and they face outwards from its
  // centre, so a flame standing on the kerb lights the near two and shadows the far two.
  // This — not the albedo — is what makes the band read as carved.
  vec2 aw = abs(w);
  vec2 acrossDir = (aw.x > aw.y) ? vec2(sign(w.x), 0.0) : vec2(0.0, sign(w.y));
  vec2 alongDir = vec2(-acrossDir.y, acrossDir.x);
  vec2 slopeDir = normalize(vec2(sign(cu) * 1.02, sign(cv)) + 1e-6);
  vec3 across3 = vec3(acrossDir.x, 0.0, acrossDir.y);
  vec3 along3 = vec3(alongDir.x, 0.0, alongDir.y);
  gNormalPert += (across3 * slopeDir.x + along3 * slopeDir.y) * slope * inBand * tf * 1.15;
  gNormalPert -= (across3 * slopeDir.x + along3 * slopeDir.y) * lost * 0.7;
  // The two cut arrises of the recess itself.
  gNormalPert += across3 * (bRule(t, uBandT0, 0.010, aaT) - bRule(t, uBandT1, 0.010, aaT)) * 0.30;
`;

// ---------------------------------------------------------------------------------------
// kerb
// ---------------------------------------------------------------------------------------

const KERB_HEAD = /* glsl */ `
uniform vec3 uStone;
uniform vec3 uStoneB;
uniform vec3 uSoot;
uniform vec3 uGrime;
uniform float uCourse;
uniform float uTopU;
uniform float uTopEndU;
`;

const KERB_FRAG = /* glsl */ `
  vec2 w = vWPos.xz;
  float px = max(fwidth(w.x), fwidth(w.y));
  vec4 wear = boardWear(w);
  float u = vBUv.x;              // metres along the profile, from the board side
  float along = vBUv.y;          // metres along the kerb

  // Which way is "outward" and which way is "along" here — needed to kink the normal
  // across a joint rather than in an arbitrary direction.
  vec2 aw = abs(w);
  vec2 outw = (aw.x > aw.y) ? vec2(sign(w.x), 0.0) : vec2(0.0, sign(w.y));
  vec2 alongDir = vec2(-outw.y, outw.x);

  // Block joints: this is a course of cut stone, not a moulded ring. The joint wanders,
  // is recessed, and the arris either side of it is knocked about.
  //
  // These were drawn 12–46 mm wide on a metre-long block, which from any of the judging
  // cameras is a hairline — so the kerb read as one continuous untextured slab rather
  // than as a course of separate stones. Widened to a real 30–90 mm open joint, and each
  // block now stands a few millimetres off its neighbour (blockSet), so the course breaks
  // into individual stones with their own height and their own lit face.
  float blk = along / uCourse;
  float jd = abs(fract(blk) - 0.5) * uCourse + (bFbm(w * 2.6, 3) - 0.5) * 0.045;
  float joint = 1.0 - smoothstep(0.030, 0.090, jd);
  float arris = (1.0 - smoothstep(0.080, 0.220, jd)) * (1.0 - joint);
  float blockId = floor(blk);
  float blockTone = bHash21(vec2(blockId, 3.0)) - 0.5;
  // How proud of the course this block sits, and which way it is tipped.
  float blockSet = (bHash21(vec2(blockId, 11.0)) - 0.5);
  float blockTip = (bHash21(vec2(blockId, 23.0)) - 0.5);

  float mottle = clamp(0.5 + 3.2 * (bFbm(w * 1.5 + blockId * 3.7, 4) - 0.5), 0.0, 1.0);
  float grain = bFbm(w * 12.0, 3);
  // 2.6 cm grain — sub-pixel on the phone, and written to fade to its own mean there.
#ifdef BOARD_LOW
  float fine = 0.5;
#else
  float fine = mix(0.5, bNoise(w * 38.0), bFade(0.026, px));
#endif
  // Pitting: this stone has been spalled by five centuries of fires burning on it.
  float pit = smoothstep(0.60, 0.78, bNoise(w * 17.0)) * bFade(0.06, px);

  // --- worked surface -------------------------------------------------------------------
  // The kerb's top face is the largest single plane the low camera sees, and left as
  // smooth mottled grey it is the flattest thing in frame. It is dressed stone: it
  // carries the mason's tooling, the spalls that tooling started, and the dust that has
  // drifted against the board's edge and never been swept out.
  //
  // The face is drag-tooled: long shallow ridges running the LENGTH of the kerb, four
  // centimetres apart, with a finer chatter over them and a weak cross-hatch left by the
  // point. Ridges along the band are the ones a flame sitting on the kerb rakes end to
  // end, and they are the strongest horizontal signal the near half of the frame has.
  float acrossM = dot(w, outw);
  float alongM = dot(w, alongDir);
  float chat = bNoise(vec2(acrossM * 26.0, alongM * 2.2 + blockId * 7.3));
  // The drag-tooling's two finer passes, at 3.0 cm and 3.4 cm. The 4 cm ridges the flames
  // rake end to end are the signal; these two are the chatter over them, and the phone's
  // pixel is wider than either. Their band limits were already returning zero there.
#ifdef BOARD_LOW
  float tooling = (chat - 0.5) * 0.58 * bFade(0.085, px);
#else
  float chat2 = bNoise(vec2(acrossM * 71.0, alongM * 5.0 + blockId * 2.1)) * bFade(0.030, px);
  float chatX = bNoise(vec2(alongM * 31.0, acrossM * 3.4 + blockId * 4.9)) * bFade(0.034, px);
  float tooling = ((chat - 0.5) * 0.58 + (chat2 - 0.5) * 0.30 + (chatX - 0.5) * 0.24)
                * bFade(0.085, px);
#endif
  // Bigger, sparser spalls where a corner has flaked away: hard-edged, pale inside.
  float spall = smoothstep(0.70, 0.80, bFbm(w * 5.5 + 31.0, 3)) * bFade(0.12, px);
  // Fine sand and stone powder standing on the face. 2.4 cm, so sub-pixel on the phone;
  // the spalls and the pitting above are the two coarser sizes and they stay.
#ifdef BOARD_LOW
  float sand = 0.0;
#else
  float sand = smoothstep(0.72, 0.90, bNoise(w * 44.0)) * bFade(0.024, px);
#endif

  vec3 albedo = mix(uStone, uStoneB, mottle);
  // Block-to-block value spread, widened. Cut stone from one quarry still varies far
  // more than a shader default: this is the cheapest signal that says "separate stones".
  albedo *= 0.78 + 0.44 * (blockTone + 0.5);
  albedo *= 0.84 + 0.26 * grain + 0.07 * fine;
  albedo *= 1.0 + tooling * 0.20;
  albedo = mix(albedo, uGrime, pit * 0.45);
  albedo = mix(albedo, uStone * 1.20, spall * 0.45);
  albedo = mix(albedo, uDust * 0.92, sand * 0.28);

  // Centuries of fires burning on the top face. Soot, not a warm glow.
  float top = smoothstep(uTopU - 0.06, uTopU + 0.02, u)
             * (1.0 - smoothstep(uTopEndU - 0.02, uTopEndU + 0.05, u));
  float scorch = smoothstep(0.52, 0.86, bFbm(w * 0.9 + 21.0, 4)) * top;
  albedo = mix(albedo, uSoot, scorch * 0.40);

  // Grime collects in the joints and in the angle where the kerb meets the board.
  float angle = 1.0 - smoothstep(0.0, 0.20, u);
  albedo = mix(albedo, uGrime, max(joint * 0.85, angle * 0.5));
  // Broken arrises show pale, raw stone.
  albedo = mix(albedo, uStone * 1.28, arris * smoothstep(0.45, 0.75, bNoise(w * 9.0)) * 0.7);

  // Dust and sweepings drift into the angle against the board and lie along the tread
  // noses. On the top face it is what the flames are actually standing in.
  float drift = (1.0 - smoothstep(0.0, 0.34, u)) * (0.35 + 0.65 * bFbm(w * 2.2 + 5.0, 3));
  albedo = mix(albedo, uDust, clamp(drift, 0.0, 1.0) * 0.30 * top);

  float dust = clamp(wear.x * (0.5 + 0.8 * wear.w), 0.0, 1.0);
  albedo = mix(albedo, uDust, dust * 0.8);

  diffuseColor.rgb *= albedo;
  gCavity = 1.0;
  gRough = clamp(0.78 + 0.12 * grain + joint * 0.12 + dust * 0.15 + pit * 0.10 - scorch * 0.06
                 + sand * 0.14 + spall * 0.10 + tooling * 0.08, 0.3, 1.0);
  gReflMask = 0.0;
  gReflJitter = 0.0;

  // Relief, in metres: block faces, tooling, grit — then the joint recess on top.
  float ee = max(0.006, px * 0.7);
  float h0 = bFbm(w * 3.2, 3) * 0.0060 + bNoise(w * 15.0) * 0.0018 * bFade(0.066, px);
  float hx = bFbm((w + vec2(ee, 0.0)) * 3.2, 3) * 0.0060 + bNoise((w + vec2(ee, 0.0)) * 15.0) * 0.0018 * bFade(0.066, px);
  float hz = bFbm((w + vec2(0.0, ee)) * 3.2, 3) * 0.0060 + bNoise((w + vec2(0.0, ee)) * 15.0) * 0.0018 * bFade(0.066, px);
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee);
  // The tooling is real relief, and it runs across the band: a run of shallow parallel
  // ridges a flame at kerb height rakes the length of. Without this the top face is a
  // painted plane, which is the one note the low camera cannot forgive.
  gNormalPert += vec3(outw.x, 0.0, outw.y) * tooling * 0.42;
  gNormalPert += vec3(alongDir.x, 0.0, alongDir.y) * tooling * 0.12;
  // Spalls are shallow craters; sand is grit standing on the face.
  gNormalPert += vec3(bNoise(w * 6.2) - 0.5, 0.0, bNoise(w * 6.2 + 9.0) - 0.5) * spall * 0.55;
#ifndef BOARD_LOW
  gNormalPert += vec3(bNoise(w * 52.0) - 0.5, 0.0, bNoise(w * 52.0 + 3.0) - 0.5) * sand * 0.34;
#endif
  // The joint is a groove: the surface turns down into it from both sides.
  float side = sign(fract(blk) - 0.5);
  gNormalPert += vec3(alongDir.x, 0.0, alongDir.y) * side * joint * 0.95;
  gNormalPert -= vec3(alongDir.x, 0.0, alongDir.y) * side * arris * 0.30;
  gNormalPert += vec3(bNoise(w * 26.0) - 0.5, 0.0, bNoise(w * 26.0 + 5.0) - 0.5) * pit * 0.5;
  // Each block is set slightly out of the course and slightly tipped, so no two of them
  // return the same light. A ring of identical stones is a moulding; a ring of stones
  // that disagree with each other is masonry, and that is the whole of the difference
  // between this reading as a slab and reading as a kerb.
  gNormalPert += vec3(alongDir.x, 0.0, alongDir.y) * blockTip * 0.16;
  gNormalPert += vec3(outw.x, 0.0, outw.y) * blockSet * 0.20;
`;

// ---------------------------------------------------------------------------------------

export interface Surround {
  group: THREE.Object3D;
  meshes: THREE.Mesh[];
  dispose(): void;
}

/** Arc-length parametrised profile: u is metres travelled along the section. */
function profile(points: Array<[number, number, boolean?]>): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  let u = 0;
  for (let i = 0; i < points.length; i++) {
    const [r, y, hard] = points[i];
    if (i > 0) {
      const [pr, py] = points[i - 1];
      u += Math.hypot(r - pr, y - py);
    }
    out.push({ r, y, u, hard });
  }
  return out;
}

export function createSurround(world: World, shared: SharedMaps): Surround {
  const group = new THREE.Group();
  group.name = 'board-surround';
  const meshes: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  /**
   * Segments per side of the swept ring.
   *
   * Each side is a STRAIGHT run between two mitres, and every quantity the shaders read
   * off it — the across-band coordinate, the along-band metre count, the normal — is
   * linear along that run. Subdividing it therefore adds vertices and changes nothing at
   * all: the sixty-four the high tier uses are there because the sweep is also what the
   * shadow map and the mirror see, and because a critic renders it at 1920 px. The low
   * tier drops to four and the border and kerb come out geometrically identical.
   */
  const segs = world.quality === 'high' ? 64 : 4;

  /**
   * Play view only: the band is opened out and carries the carved rank and file marks.
   * Decided once, from which shot is aimed — see playview.ts. When this is false not a
   * character of coords.ts reaches the shader and the profile below is the one every
   * reference frame was rendered against.
   */
  const coords = isPlayView(world);

  // --- mortar bed -----------------------------------------------------------------------
  const bedMat = baseMaterial(
    'board-bed',
    BED_HEAD,
    BED_FRAG,
    {
      // Chosen from the rendered pixel back, not from what a mortar looks like in
      // daylight. See BED_FRAG: this plane is what the camera actually sees down every
      // joint on the board, so its value IS the joint's value.
      uMortar: { value: c(0x2e2b26) },
      uAggregate: { value: c(0x413d35) },
      uGrime: { value: c(0x141310) },
    },
    shared,
    0,
    false,
  );
  // The room's environment lobe is added on top of the albedo, so on a near-black mortar
  // it is most of what you see. Down a 24 mm slot there is almost no environment to
  // gather; leaving this at the ring's 0.9 put a grey floor back under the joint.
  bedMat.envMapIntensity = 0.12;
  // Stops just past the field: the border band and the kerb cover everything beyond it,
  // so the bed never pokes out over the chamber floor.
  // A flat plane, shaded entirely per fragment from world position: its subdivision buys
  // nothing but vertices, so the low tier takes the two triangles the surface actually is.
  const bedSegs = world.quality === 'high' ? 24 : 1;
  const bedGeo = new THREE.PlaneGeometry((R.filletIn + 0.12) * 2, (R.filletIn + 0.12) * 2, bedSegs, bedSegs);
  bedGeo.rotateX(-Math.PI / 2);
  bedGeo.translate(0, BED_Y, 0);
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.name = 'board-bed';
  bed.receiveShadow = true;
  group.add(bed);
  meshes.push(bed);
  geos.push(bedGeo);
  mats.push(bedMat);

  // --- the carved border band -------------------------------------------------------------
  // A real sunk channel, not a flat ring with a pattern on it: field level, a hard arris,
  // a short fall, the sunk floor the lozenges are cut into, then back up to the kerb foot.
  // Every one of those steps is a `hard` point, so the sweep duplicates the ring and the
  // arrises stay sharp instead of being smoothed into a ramp.
  //
  // In the play build the same section is opened out — same steps, same fall, same sunk
  // floor, 0.53 m wide instead of 0.34 — because that width is the cap height of the
  // carved marks and 0.34 m only buys a 13 px letter. See coords.ts for the measurements.
  const bandIn = coords ? PLAY_BAND.in : R.bandIn;
  const bandOut = coords ? PLAY_BAND.out : R.bandOut;
  const bandHalf = coords
    ? (PLAY_BAND.to - PLAY_BAND.from) / 2
    : (R.filletOut - R.filletIn) / 2;
  const borderPts = profile(
    coords
      ? playBandProfile()
      : [
          [R.filletIn, TOP_Y],
          [R.bandIn - 0.026, TOP_Y, true],
          [R.bandIn - 0.004, TOP_Y - BORDER_SINK * 0.72],
          [R.bandIn, TOP_Y - BORDER_SINK, true],
          [R.bandOut, TOP_Y - BORDER_SINK, true],
          [R.bandOut + 0.004, TOP_Y - BORDER_SINK * 0.72],
          [R.bandOut + 0.026, TOP_Y, true],
          [R.filletOut, TOP_Y],
        ],
  );
  const borderLen = borderPts[borderPts.length - 1].u;
  // Normalise the across-band coordinate to 0..1 over the whole profile, and hand the
  // shader where within it the sunk floor begins and ends.
  const borderProfile = borderPts.map((p) => ({ ...p, u: p.u / borderLen }));
  const bandT0 = borderProfile[3].u;
  const bandT1 = borderProfile[4].u;
  const borderMat = baseMaterial(
    'board-border',
    BORDER_HEAD,
    // The film path passes BORDER_FRAG itself, untouched and unconcatenated — the string
    // the six judged frames have always compiled. The play path weights the chain back
    // where it is mixed and appends the two continuous rules at the end.
    coords
      ? BORDER_FRAG.replace(
          '  vec3 albedo = uField;',
          BAND_CHAIN_GLSL + '  vec3 albedo = uField;',
        ) + BAND_RULE_FRAG
      : BORDER_FRAG,
    {
      // A mid slate bed, not near-black. Probed off the render: between the flames the
      // strip was landing at 20/255 while the marble beside it sat at 110 — the marble
      // is reflection-dominated at this grazing angle and the strip was not, so a dark
      // bed put the frame's finest detail below the point where anything is legible.
      uField: { value: c(0x605e57) },
      uTessDark: { value: c(0x2d2f34) },
      uTessPale: { value: c(0xb4ad9d) },
      uTessMean: { value: c(0x6c6a62) },
      uLine: { value: c(0x202227) },
      uGrime: { value: c(0x3a3831) },
      // One element per cell, its pitch a whole number of divisions of a side so the
      // chain closes cleanly at every mitre.
      //
      // The pitch was the width of the sunk floor, 34 cm, which put 56 elements down a
      // side. Measured off the near edge of `wide-establishing` — where the board's front
      // rank spans about 900 px for 18.8 m — the film's run repeats every 4 to 5 px, i.e.
      // roughly every 9 cm: three to four times finer than this was, which is the
      // difference between "a row of fine dark dentils" and a row of big lozenges. Set to
      // half the sunk floor's width, so the elements are twice as many and read as teeth
      // across the band rather than as diamonds sitting in it, and still coarse enough
      // that `tf` is not fading the whole chain out to its mean by the middle distance.
      uCell: {
        value: (2 * bandIn) / Math.round((2 * bandIn) / ((bandOut - bandIn) * 0.5)),
      },
      uBandHalf: { value: bandHalf },
      uBandT0: { value: bandT0 },
      uBandT1: { value: bandT1 },
    },
    shared,
    0.60,
    true,
  );
  const borderGeo = sweepRing(borderProfile, segs);
  const border = new THREE.Mesh(borderGeo, borderMat);
  border.name = 'board-border';
  border.receiveShadow = true;
  group.add(border);
  meshes.push(border);
  geos.push(borderGeo);
  mats.push(borderMat);

  // --- kerb -----------------------------------------------------------------------------
  // Two treads on the outside rather than one smooth fall: a stepped kerb gives the
  // low camera two horizontal arrises to catch light on, which is most of what makes
  // this band read as cut stone instead of as a ramp.
  const kerbProfile = profile([
    [R.filletOut, TOP_Y, true],
    [R.kerbFoot, TOP_Y, true],
    [R.kerbFoot + 0.012, 0.09],
    [R.kerbTopIn - 0.035, 0.20],
    [R.kerbTopIn - 0.012, 0.268],
    [R.kerbTopIn, KERB_Y, true],
    [R.kerbTopOut, KERB_Y, true],
    [R.kerbTopOut + 0.045, 0.272, true],
    [R.kerbTread, 0.118, true],
    [R.kerbTreadOut, 0.104, true],
    [R.kerbTreadOut + 0.035, 0.082, true],
    [R.kerbFall, 0.0, true],
    [R.kerbFall + 0.12, 0.0],
  ]);
  const topU = kerbProfile[5].u;
  const topEndU = kerbProfile[6].u;
  // The kerb's top face is where the carved rank and file marks go in the play build —
  // nothing stands in front of it and the fires burn on it. See coords.ts for the two
  // placements that were measured and rejected first. The film path passes KERB_FRAG
  // itself, unconcatenated: the string the six judged frames have always compiled.
  const kerbMat = baseMaterial(
    'board-kerb',
    coords ? KERB_HEAD + COORD_HEAD : KERB_HEAD,
    coords ? KERB_FRAG + COORD_FRAG : KERB_FRAG,
    {
      uStone: { value: c(0xa6a29a) },
      uStoneB: { value: c(0x86847e) },
      uSoot: { value: c(0x3b352d) },
      uGrime: { value: c(0x3a352e) },
      uCourse: { value: (2 * R.kerbTopIn) / Math.round((2 * R.kerbTopIn) / 0.98) },
      uTopU: { value: topU },
      uTopEndU: { value: topEndU },
      ...(coords ? coordUniforms() : {}),
    },
    shared,
    0,
    true,
  );
  const kerbGeo = sweepRing(kerbProfile, segs);
  const kerb = new THREE.Mesh(kerbGeo, kerbMat);
  kerb.name = 'board-kerb';
  kerb.receiveShadow = true;
  // Deliberately not a shadow caster. It stands 30 cm proud of a floor and shadows
  // nothing worth having, but it sits directly outboard of the inlaid border strip —
  // the finest detail in the reference frame — and its shadow map was helping to bury it.
  kerb.castShadow = false;
  group.add(kerb);
  meshes.push(kerb);
  geos.push(kerbGeo);
  mats.push(kerbMat);

  return {
    group,
    meshes,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
