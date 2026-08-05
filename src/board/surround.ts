/**
 * PIECE: board — the mortar bed, the inlaid border and the kerb.
 *
 * Reference: between the marble field and the raised stone kerb runs a fine inlaid
 * geometric border strip — a narrow band of small repeating elements — and the fires burn
 * on top of the kerb itself. The kerb is the one place the board stops being marble: it
 * is the same pale, weathered, soot-marked limestone as the room.
 *
 * The mortar bed is the surface you see when you look down into a joint. It is only ever
 * a few centimetres of the frame, but it is the reason the joints read as deep.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import { NOISE_GLSL, REFLECT_GLSL, WEAR_GLSL } from './glsl';
import { BED_Y, KERB_Y, R, TOP_Y, sweepRing, type ProfilePoint } from './layout';

export interface SharedMaps {
  wear: THREE.Texture;
  wearExtent: number;
  refl: THREE.Texture | null;
  reflMatrix: THREE.Matrix4;
  reflLod: number;
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
    uReflStrength: { value: shared.refl && reflect > 0 ? reflect : 0 },
    uReflTint: { value: new THREE.Color(0.98, 0.99, 1.0) },
  };
  m.onBeforeCompile = patch(frag);
  m.customProgramCacheKey = () => name;
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

const BED_FRAG = /* glsl */ `
  vec2 w = vWPos.xz;
  vec4 wear = boardWear(w);

  // Lime mortar with a coarse aggregate: pale chips of stone in a darker, dirtier matrix.
  float grain = bNoise(w * 46.0);
  float chips = smoothstep(0.62, 0.86, bNoise(w * 88.0 + 13.0));
  float dirt = bFbm(w * 6.0, 3);

  vec3 albedo = mix(uMortar, uGrime, dirt * 0.75);
  albedo = mix(albedo, uAggregate, chips * 0.8);
  albedo *= 0.80 + 0.34 * grain;
  // Grit and dust drift into the joints and stay there — this is the deepest, dirtiest
  // part of the floor and it should read that way.
  float dust = clamp(wear.x * 1.5 + 0.18, 0.0, 1.0);
  albedo = mix(albedo, uDust * 0.85, dust * 0.55);

  diffuseColor.rgb *= albedo;
  gRough = clamp(0.86 + 0.10 * grain - chips * 0.12, 0.3, 1.0);
  gReflMask = 0.0;
  gReflJitter = 0.0;

  const float ee = 0.008;
  float h0 = bNoise(w * 46.0) + 0.5 * bNoise(w * 130.0);
  float hx = bNoise((w + vec2(ee, 0.0)) * 46.0) + 0.5 * bNoise((w + vec2(ee, 0.0)) * 130.0);
  float hz = bNoise((w + vec2(0.0, ee)) * 46.0) + 0.5 * bNoise((w + vec2(0.0, ee)) * 130.0);
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee) * 0.0035;
`;

// ---------------------------------------------------------------------------------------
// inlaid border strip
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
`;

/**
 * The perimeter strip, between the marble field and the kerb.
 *
 * In `low-across-board` this is the single finest detail in frame: a dense run of small
 * repeating alternating elements, PALE against dark, bright enough to read all the way
 * to the far corner of the board. The previous build drew it dark-on-dark — a near-black
 * bed with 60 % coverage of small tesserae — and in a room lit by nothing but small
 * flames the whole band crushed to a plain dark strip with some speckle in it, which is
 * precisely what the critique caught.
 *
 * So the design here is contrast-first:
 *   - the bed is a mid slate, not near-black, so the band never falls to a silhouette;
 *   - the elements are chunky (two rows of ~17 cm blocks, not three rows of 10 cm), so
 *     they survive the perspective all the way round the field;
 *   - the pale stone is a bright limestone and holds a large fraction of the band;
 *   - three cut rules bound it either side, and every element stands proud of its bed,
 *     so a flame at kerb height rakes the whole grid and each block gets a lit face and
 *     a shaded one. That relief is what makes it read as inlay rather than as paint.
 */
const BORDER_FRAG = /* glsl */ `
  vec2 w = vWPos.xz;
  float px = max(fwidth(w.x), fwidth(w.y));
  vec4 wear = boardWear(w);

  // uv.x runs across the band (0..1). The along-band coordinate is taken from world
  // space, not from uv.y: the ring's inner and outer edges are different lengths, so a
  // uv-based run would fan the columns out across the width of the strip.
  float t = vBUv.x;
  vec2 aw0 = abs(w);
  float s = (aw0.x > aw0.y) ? w.y : w.x;
  float width = uBandHalf * 2.0;
  float aaT = clamp(px / width, 0.0008, 0.5);
  float aaS = clamp(px / uCell, 0.0008, 0.5);
  float tf = bFade(uCell * 0.42, px);

  // Two rows of chunky tesserae down the middle 62 % of the band.
  vec4 tess = bTess(clamp((t - 0.19) / 0.62, 0.0, 1.0), s, uCell, 2.0, aaT / 0.62, aaS);
  // A second, half-pitch run along the very centre: the dense bead the reference's strip
  // carries down its middle, and the element that keeps the strip alive at distance.
  vec4 bead = bTess(clamp((t - 0.44) / 0.12, 0.0, 1.0), s + uCell * 0.25, uCell * 0.5, 1.0,
                    aaT / 0.12, aaS * 2.0);
  float beadIn = 1.0 - smoothstep(0.115, 0.125, abs(t - 0.5));

  vec3 albedo = uField;
  albedo = mix(albedo, uTessPale, tess.x * 0.97);
  albedo = mix(albedo, uTessDark, tess.y * 0.92);
  albedo = mix(albedo, uTessPale * 1.05, bead.x * beadIn * 0.95);
  albedo = mix(albedo, uLine, bead.y * beadIn * 0.85);
  albedo = mix(uTessMean, albedo, tf);

  // The rules bounding the chequer: dark / pale / dark, mirrored either side.
  float dark = bRule(t, 0.028, 0.028, aaT) + bRule(t, 0.170, 0.024, aaT)
             + bRule(t, 0.830, 0.024, aaT) + bRule(t, 0.972, 0.028, aaT);
  float pale = bRule(t, 0.098, 0.040, aaT) + bRule(t, 0.902, 0.040, aaT);
  albedo = mix(albedo, uLine, clamp(dark, 0.0, 1.0) * 0.92);
  albedo = mix(albedo, uTessPale * 1.10, clamp(pale, 0.0, 1.0) * 0.90);
  float rules = clamp(dark + pale, 0.0, 1.0);
  float inlay = clamp(tess.z + rules, 0.0, 1.0);

  // Tesserae go missing. Where one has, the bed shows and the surface drops.
  float lost = step(0.92, bHash21(floor(vec2(s / uCell, t * 2.0)) + 5.7)) * tess.z * tf;
  albedo = mix(albedo, uGrime, lost * 0.9);

  float grain = bFbm(w * 9.0, 3);
  float fine = mix(0.5, bNoise(w * 33.0), bFade(0.03, px));
  albedo *= 0.90 + 0.17 * grain + 0.07 * fine;
  // Weathering stains the strip; it must not swallow it. Kept off the pale elements,
  // which are the only reason the band reads at all.
  albedo = mix(albedo, uGrime, clamp(wear.z, 0.0, 1.0) * 0.22 * (1.0 - tess.x * 0.8));

  float dust = clamp(wear.x * (0.6 + 0.8 * wear.w), 0.0, 1.0);
  albedo = mix(albedo, uDust, dust * 0.85);

  diffuseColor.rgb *= albedo;
  // The strip is polished stone set into polished stone, so it takes nearly as much of
  // the room as the marble does. Starving it of reflection is what left it reading as a
  // plain dark band beside a bright field.
  gRough = clamp(0.34 + tess.w * 0.26 + lost * 0.40
                 + wear.z * 0.24 + dust * 0.55 + (grain - 0.5) * 0.14, 0.06, 1.0);
  gReflMask = clamp((1.0 - dust * 1.4) * (1.0 - lost) * (0.48 + 0.34 * (1.0 - inlay)), 0.0, 1.0);
  gReflJitter = grain - 0.5;

  float ee = max(0.005, px * 0.7);
  float h0 = bFbm(w * 11.0, 2) * 0.0016;
  float hx = bFbm((w + vec2(ee, 0.0)) * 11.0, 2) * 0.0016;
  float hz = bFbm((w + vec2(0.0, ee)) * 11.0, 2) * 0.0016;
  gNormalPert = vec3(-(hx - h0) / ee, 0.0, -(hz - h0) / ee);
  // Every tessera stands a fraction proud of its bed and every rule is a cut line, so a
  // grazing flame finds the whole grid. This is the strip's real signature.
  vec2 aw = abs(w);
  vec2 acrossDir = (aw.x > aw.y) ? vec2(sign(w.x), 0.0) : vec2(0.0, sign(w.y));
  vec2 alongDir = vec2(-acrossDir.y, acrossDir.x);
  float ridge = (tess.z - 0.5) * 2.0 * tf;
  gNormalPert += vec3(acrossDir.x, 0.0, acrossDir.y) * (ridge * 0.34 - rules * 0.38 - lost * 0.60);
  gNormalPert += vec3(alongDir.x, 0.0, alongDir.y) * tf
               * ((fract(s / uCell) - 0.5) * 0.48 + (fract(s / (uCell * 0.5)) - 0.5) * beadIn * 0.40);
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
  float blk = along / uCourse;
  float jd = abs(fract(blk) - 0.5) * uCourse + (bFbm(w * 2.6, 3) - 0.5) * 0.030;
  float joint = 1.0 - smoothstep(0.012, 0.046, jd);
  float arris = (1.0 - smoothstep(0.040, 0.135, jd)) * (1.0 - joint);
  float blockId = floor(blk);
  float blockTone = bHash21(vec2(blockId, 3.0)) - 0.5;

  float mottle = clamp(0.5 + 3.2 * (bFbm(w * 1.5 + blockId * 3.7, 4) - 0.5), 0.0, 1.0);
  float grain = bFbm(w * 12.0, 3);
  float fine = mix(0.5, bNoise(w * 38.0), bFade(0.026, px));
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
  float chat2 = bNoise(vec2(acrossM * 71.0, alongM * 5.0 + blockId * 2.1)) * bFade(0.030, px);
  float chatX = bNoise(vec2(alongM * 31.0, acrossM * 3.4 + blockId * 4.9)) * bFade(0.034, px);
  float tooling = ((chat - 0.5) * 0.58 + (chat2 - 0.5) * 0.30 + (chatX - 0.5) * 0.24)
                * bFade(0.085, px);
  // Bigger, sparser spalls where a corner has flaked away: hard-edged, pale inside.
  float spall = smoothstep(0.70, 0.80, bFbm(w * 5.5 + 31.0, 3)) * bFade(0.12, px);
  // Fine sand and stone powder standing on the face.
  float sand = smoothstep(0.72, 0.90, bNoise(w * 44.0)) * bFade(0.024, px);

  vec3 albedo = mix(uStone, uStoneB, mottle);
  albedo *= 0.88 + 0.24 * blockTone;
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
  gNormalPert += vec3(bNoise(w * 52.0) - 0.5, 0.0, bNoise(w * 52.0 + 3.0) - 0.5) * sand * 0.34;
  // The joint is a groove: the surface turns down into it from both sides.
  float side = sign(fract(blk) - 0.5);
  gNormalPert += vec3(alongDir.x, 0.0, alongDir.y) * side * joint * 0.55;
  gNormalPert -= vec3(alongDir.x, 0.0, alongDir.y) * side * arris * 0.16;
  gNormalPert += vec3(bNoise(w * 26.0) - 0.5, 0.0, bNoise(w * 26.0 + 5.0) - 0.5) * pit * 0.5;
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
  const segs = world.quality === 'high' ? 64 : 24;

  // --- mortar bed -----------------------------------------------------------------------
  const bedMat = baseMaterial(
    'board-bed',
    BED_HEAD,
    BED_FRAG,
    {
      uMortar: { value: c(0x716d66) },
      uAggregate: { value: c(0x9a968c) },
      uGrime: { value: c(0x322f2a) },
    },
    shared,
    0,
    false,
  );
  // Stops just past the field: the border band and the kerb cover everything beyond it,
  // so the bed never pokes out over the chamber floor.
  const bedGeo = new THREE.PlaneGeometry((R.filletIn + 0.12) * 2, (R.filletIn + 0.12) * 2, 24, 24);
  bedGeo.rotateX(-Math.PI / 2);
  bedGeo.translate(0, BED_Y, 0);
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.name = 'board-bed';
  bed.receiveShadow = true;
  group.add(bed);
  meshes.push(bed);
  geos.push(bedGeo);
  mats.push(bedMat);

  // --- inlaid border --------------------------------------------------------------------
  const bandHalf = (R.filletOut - R.filletIn) / 2;
  const borderMat = baseMaterial(
    'board-border',
    BORDER_HEAD,
    BORDER_FRAG,
    {
      // A mid slate bed, not near-black. Probed off the render: between the flames the
      // strip was landing at 20/255 while the marble beside it sat at 110 — the marble
      // is reflection-dominated at this grazing angle and the strip was not, so a dark
      // bed put the frame's finest detail below the point where anything is legible.
      uField: { value: c(0x6a6c70) },
      uTessDark: { value: c(0x44464d) },
      uTessPale: { value: c(0xe4dfd0) },
      uTessMean: { value: c(0x8d8b81) },
      uLine: { value: c(0x2b2e34) },
      uGrime: { value: c(0x4d4a41) },
      // Square tesserae: two rows across the middle 62 % of the band, and a whole
      // number of columns to the side so the pattern closes cleanly at every mitre.
      uCell: { value: (2 * R.filletIn) / Math.round((2 * R.filletIn) / ((bandHalf * 2 * 0.62) / 2)) },
      uBandHalf: { value: bandHalf },
    },
    shared,
    0.92,
    true,
  );
  const borderGeo = sweepRing(
    profile([
      [R.filletIn, TOP_Y],
      [R.filletOut, TOP_Y],
    ]).map((p, i) => ({ ...p, u: i })),
    segs,
  );
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
  const kerbMat = baseMaterial(
    'board-kerb',
    KERB_HEAD,
    KERB_FRAG,
    {
      uStone: { value: c(0xa6a29a) },
      uStoneB: { value: c(0x86847e) },
      uSoot: { value: c(0x3b352d) },
      uGrime: { value: c(0x3a352e) },
      uCourse: { value: (2 * R.kerbTopIn) / Math.round((2 * R.kerbTopIn) / 0.98) },
      uTopU: { value: topU },
      uTopEndU: { value: topEndU },
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
