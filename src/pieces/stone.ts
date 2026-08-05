/**
 * PIECE: pieces — the stone itself.
 *
 * Two stones, not two colours of one plastic:
 *
 *   white  a pale oolitic limestone. Sedimentary: faint bedding, even fine pitting,
 *          soft arrises that erode, chalky high roughness, warm-grey albedo.
 *   black  a dark basalt. Igneous: coarse vesicles (gas bubbles), crystalline speckle,
 *          harder edges that survive, cooler and much darker albedo, slightly less rough
 *          on worn faces so the sheen is broader and lower.
 *
 * Three spatial scales are carried simultaneously, which is the whole game:
 *   metres  vertex colour  — blotching, staining runs, dust deposition, cavity darkening
 *   ~10 cm  geometry       — chisel facets, erosion, chips (see forms.ts / mesh.ts)
 *   mm      triplanar map  — grain, pitting, vesicles, in normal AND roughness
 *
 * Everything here derives from world.rng / world.seed. No wall clock, no Math.random.
 */
import * as THREE from 'three';
import { PALETTE, type Side } from '../core/constants';
import { makeFbm } from '../core/rng';
import type { World } from '../core/world';

export interface StoneSpec {
  /** Linear-space base albedo. */
  base: THREE.Color;
  /** Blotching pushes toward this. */
  warm: THREE.Color;
  /** Staining runs push toward this. */
  cool: THREE.Color;
  /** Freshly broken interior. */
  fresh: THREE.Color;
  blotch: number;
  stain: number;
  mottle: number;
  bedding: number;
  cavity: number;
  dust: number;
  freshLift: number;
  roughBase: number;
  roughCavity: number;
  roughWorn: number;
  roughFresh: number;
  /** Geometry response. */
  facetLarge: number;
  facetLargeCell: number;
  facetFine: number;
  facetFineCell: number;
  swell: number;
  pit: number;
  erode: number;
}

const SPEC: Record<Side, StoneSpec> = {
  white: {
    base: new THREE.Color().setHex(0x9a9083, THREE.SRGBColorSpace),
    warm: new THREE.Color().setHex(0xb0a087, THREE.SRGBColorSpace),
    cool: new THREE.Color().setHex(0x5e5d5a, THREE.SRGBColorSpace),
    fresh: new THREE.Color().setHex(PALETTE.stoneFresh, THREE.SRGBColorSpace),
    blotch: 0.30,
    stain: 0.34,
    mottle: 0.13,
    bedding: 0.075,
    cavity: 0.30,
    dust: 0.16,
    freshLift: 0.30,
    roughBase: 0.855,
    roughCavity: 0.10,
    roughWorn: 0.20,
    roughFresh: 0.06,
    facetLarge: 0.026,
    facetLargeCell: 0.46,
    facetFine: 0.0125,
    facetFineCell: 0.135,
    swell: 0.017,
    pit: 0.0055,
    erode: 0.040,
  },
  black: {
    base: new THREE.Color().setHex(0x3b3a38, THREE.SRGBColorSpace),
    warm: new THREE.Color().setHex(0x554c40, THREE.SRGBColorSpace),
    cool: new THREE.Color().setHex(0x24272c, THREE.SRGBColorSpace),
    fresh: new THREE.Color().setHex(0x6d6a64, THREE.SRGBColorSpace),
    blotch: 0.36,
    stain: 0.26,
    mottle: 0.20,
    bedding: 0.0,
    cavity: 0.34,
    dust: 0.26,
    freshLift: 0.62,
    roughBase: 0.775,
    roughCavity: 0.14,
    roughWorn: 0.24,
    roughFresh: 0.10,
    facetLarge: 0.030,
    facetLargeCell: 0.40,
    facetFine: 0.0145,
    facetFineCell: 0.115,
    swell: 0.012,
    pit: 0.0042,
    erode: 0.021,
  },
};

export function specFor(side: Side): StoneSpec {
  return SPEC[side];
}

// ---------------------------------------------------------------------------------------
// mm-scale grain, generated as an RGBA map: RGB tangent normal, A detail (rough + albedo).
// ---------------------------------------------------------------------------------------

function ihash(x: number, y: number, s: number): number {
  let h = (s ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function makeGrainTexture(size: number, seed: number, side: Side): THREE.DataTexture {
  const n1 = makeFbm(seed ^ 0x51a3, 5, 2.07, 0.52);
  const n2 = makeFbm(seed ^ 0x9c17, 3, 2.11, 0.58);
  const h = new Float32Array(size * size);
  const inv = 1 / size;

  const limestone = side === 'white';
  // Feature layer: limestone -> dense shallow pitting; basalt -> sparse deep vesicles.
  const cells = limestone ? 34 : 17;
  const pitR = limestone ? 0.26 : 0.42;
  const pitD = limestone ? 0.55 : 1.15;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x * inv, v = y * inv;
      let a = n1(u * 9.0, v * 9.0, 0.5) * 0.55 + n1(u * 27.0, v * 27.0, 3.5) * 0.28;
      // Direction-stretched fine streaking: bedding for limestone, flow for basalt.
      a += n2(u * (limestone ? 6.0 : 20.0), v * (limestone ? 40.0 : 20.0), 8.5) * 0.22;

      // Pits / vesicles on a jittered grid.
      const cu = u * cells, cv = v * cells;
      const ci = Math.floor(cu), cj = Math.floor(cv);
      let pit = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const gi = ci + di, gj = cj + dj;
          const hh = ihash(gi, gj, seed);
          const jx = ((hh & 1023) / 1023) * 0.9 + 0.05;
          const jy = (((hh >>> 10) & 1023) / 1023) * 0.9 + 0.05;
          const strength = ((hh >>> 20) & 1023) / 1023;
          if (strength > (limestone ? 0.42 : 0.74)) continue;
          const r = pitR * (0.35 + strength * 1.5);
          const dx = cu - (gi + jx), dy = cv - (gj + jy);
          const d = Math.hypot(dx, dy) / r;
          if (d < 1) {
            const k = 1 - d * d;
            pit -= pitD * k * k;
          }
        }
      }
      // Crystalline speckle — basalt only, a hard high-frequency sparkle.
      let spec = 0;
      if (!limestone) {
        const sh = ihash(x, y, seed ^ 0x77) / 4294967296;
        spec = (sh - 0.5) * 0.34 * (0.4 + n1(u * 60, v * 60, 12) + 0.5);
      }
      h[y * size + x] = a + pit * 0.5 + spec;
    }
  }

  const data = new Uint8Array(size * size * 4);
  const strength = limestone ? 2.3 : 3.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const dx = (h[y * size + xp] - h[y * size + xm]) * strength;
      const dy = (h[yp * size + x] - h[ym * size + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * size + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      const a = h[y * size + x] * 0.55 + 0.5;
      data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------
// The shader. Triplanar grain in OBJECT space so it never swims when a piece walks.
// ---------------------------------------------------------------------------------------

const VERT_HEAD = /* glsl */ `
attribute float aRough;
attribute float aThin;
varying float vRough;
varying float vThin;
varying vec3 vObjP;
varying vec3 vObjN;
varying vec3 vTanV;
varying vec3 vBitV;
`;

const VERT_BODY = /* glsl */ `
vObjP = position;
vObjN = normalize( normal );
vRough = aRough;
vThin = aThin;
vec3 upRef = abs( vObjN.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
vec3 oT = normalize( cross( upRef, vObjN ) );
vec3 oB = cross( vObjN, oT );
vTanV = normalize( normalMatrix * oT );
vBitV = normalize( normalMatrix * oB );
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uGrain;
uniform vec2 uGrainScale;
uniform vec2 uGrainAmp;
uniform float uGrainRough;
uniform float uGrainAlb;
uniform vec3 uSSS;
varying float vRough;
varying float vThin;
varying vec3 vObjP;
varying vec3 vObjN;
varying vec3 vTanV;
varying vec3 vBitV;
float gGrain;

vec3 tpBlend( vec3 nn ) {
	vec3 b = abs( nn );
	b = b * b * b * b;
	return b / ( b.x + b.y + b.z + 1e-5 );
}

vec3 tpNormal( vec3 p, vec3 nn, float s, float amp ) {
	vec3 bw = tpBlend( nn );
	vec3 tx = texture2D( uGrain, p.zy * s ).xyz * 2.0 - 1.0;
	vec3 ty = texture2D( uGrain, p.xz * s ).xyz * 2.0 - 1.0;
	vec3 tz = texture2D( uGrain, p.xy * s ).xyz * 2.0 - 1.0;
	tx.xy *= amp; ty.xy *= amp; tz.xy *= amp;
	vec3 nx = vec3( tx.xy + nn.zy, abs( tx.z ) * nn.x );
	vec3 ny = vec3( ty.xy + nn.xz, abs( ty.z ) * nn.y );
	vec3 nz = vec3( tz.xy + nn.xy, abs( tz.z ) * nn.z );
	return normalize( nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z );
}

float tpDetail( vec3 p, vec3 nn, float s ) {
	vec3 bw = tpBlend( nn );
	return texture2D( uGrain, p.zy * s ).w * bw.x
		+ texture2D( uGrain, p.xz * s ).w * bw.y
		+ texture2D( uGrain, p.xy * s ).w * bw.z;
}
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
{
	vec3 onn = normalize( vObjN );
	gGrain = tpDetail( vObjP, onn, uGrainScale.x ) * 0.60 + tpDetail( vObjP, onn, uGrainScale.y ) * 0.40;
	diffuseColor.rgb *= 1.0 + ( gGrain - 0.5 ) * uGrainAlb;
}
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = clamp( roughness * vRough + ( gGrain - 0.5 ) * uGrainRough, 0.055, 1.0 );
`;

const FRAG_NORMAL = /* glsl */ `
{
	vec3 onn = normalize( vObjN );
	vec3 d1 = tpNormal( vObjP, onn, uGrainScale.x, uGrainAmp.x );
	vec3 d2 = tpNormal( vObjP, onn, uGrainScale.y, uGrainAmp.y );
	vec3 nd = normalize( d1 + d2 - onn );
	vec3 upRef = abs( onn.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
	vec3 oT = normalize( cross( upRef, onn ) );
	vec3 oB = cross( onn, oT );
	normal = normalize( dot( nd, oT ) * vTanV + dot( nd, oB ) * vBitV + dot( nd, onn ) * normal );
}
`;

const FRAG_SSS = /* glsl */ `
#include <transmission_fragment>
{
	float rim = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
	rim = pow( clamp( rim, 0.0, 1.0 ), 3.0 );
	float lum = dot( totalDiffuse, vec3( 0.3, 0.59, 0.11 ) );
	totalDiffuse += uSSS * ( vThin * rim * lum );
}
`;

/** One shared function object -> three reuses one compiled program for both stones. */
function stoneOnBeforeCompile(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  const u = (this as unknown as { userData: { stoneUniforms: Record<string, THREE.IUniform> } }).userData
    .stoneUniforms;
  for (const k in u) shader.uniforms[k] = u[k];

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
    .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
    .replace('#include <transmission_fragment>', FRAG_SSS);
}

export interface Stone {
  material: THREE.MeshStandardMaterial;
  spec: StoneSpec;
  dispose(): void;
}

export function createStone(world: World, side: Side): Stone {
  const spec = SPEC[side];
  const size = world.quality === 'high' ? 512 : 256;
  const seed = world.rng.fork(`stone-grain-${side}`).int(1, 0x7fffffff);
  const tex = makeGrainTexture(size, seed, side);

  const uniforms: Record<string, THREE.IUniform> = {
    uGrain: { value: tex },
    // Fine tile ~9 cm (mm-scale texels), coarse tile ~52 cm — two octaves kill the repeat.
    uGrainScale: { value: new THREE.Vector2(1 / 0.09, 1 / 0.52) },
    uGrainAmp: { value: new THREE.Vector2(side === 'white' ? 0.95 : 1.25, 0.55) },
    uGrainRough: { value: side === 'white' ? 0.16 : 0.22 },
    uGrainAlb: { value: side === 'white' ? 0.20 : 0.34 },
    uSSS: {
      value:
        side === 'white'
          ? new THREE.Color(0.95, 0.42, 0.17).multiplyScalar(0.55)
          : new THREE.Color(0.85, 0.33, 0.12).multiplyScalar(0.28),
    },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });
  material.userData.stoneUniforms = uniforms;
  material.onBeforeCompile = stoneOnBeforeCompile;
  material.name = `stone-${side}`;

  return {
    material,
    spec,
    dispose() {
      tex.dispose();
      material.dispose();
    },
  };
}
