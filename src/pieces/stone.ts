/**
 * PIECE: pieces — the stone itself.
 *
 * Two stones, not two colours of one plastic. Taken off refs/frames/knight-looking-up.webp:
 *
 *   white  the pale army — a warm off-white limestone marked all over with irregular
 *          RUST-OCHRE staining, in patches with hard-ish edges, heaviest where water sits.
 *          The stain is the single most identifiable thing about the pale pieces, and it
 *          is the only warm colour on them in an otherwise cold blue-slate room.
 *   black  the dark army — a near-black blue-grey stone, almost value-only, with a coarse
 *          crystalline grain and a slightly lower roughness so it holds a broad dark sheen.
 *
 * The carving is smooth and ordered: age shows as staining and soot, not as crumbling.
 * Three spatial scales are still carried simultaneously:
 *   metres  vertex colour  — rust patches, soot, dust on ledges, cavity darkening
 *   ~10 cm  geometry       — shallow chisel facets, softened arrises, chips (forms/mesh)
 *   mm      triplanar map  — grain and pitting, in normal AND roughness
 *
 * Everything here derives from world.rng / world.seed. No wall clock, no Math.random.
 */
import * as THREE from 'three';
import type { Side } from '../core/constants';
import type { World } from '../core/world';

export interface StoneSpec {
  /** Linear-space base albedo. */
  base: THREE.Color;
  /** Blotching pushes toward this. */
  warm: THREE.Color;
  /** The dark core of a heavy stain — the middle of a rust patch, not its edge. */
  warmDeep: THREE.Color;
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
    // Measured off the frame, not guessed: the pale army's unstained stone samples at
    // roughly (60,70,84) — a LIGHT COOL blue-grey. The warmth in the film's limestone
    // lives entirely in the stain patches; the field between them is cold. Basing the
    // whole stone warm is what turns a chessman into terracotta the instant a flame gets
    // near it, and it is the reverse of what the reference does.
    base: new THREE.Color().setHex(0xaeafae, THREE.SRGBColorSpace),
    // Rust-ochre. Present and identifiable, but the frame shows it as a dull mauve-brown
    // bloom in the stone, not orange paint: a saturated warm here reads instantly as CG.
    warm: new THREE.Color().setHex(0x7d5f4a, THREE.SRGBColorSpace),
    warmDeep: new THREE.Color().setHex(0x4a352a, THREE.SRGBColorSpace),
    // Soot / cold shadow grey the stone weathers toward.
    cool: new THREE.Color().setHex(0x5f6672, THREE.SRGBColorSpace),
    fresh: new THREE.Color().setHex(0xd2cec4, THREE.SRGBColorSpace),
    blotch: 0.56,
    stain: 0.34,
    mottle: 0.09,
    bedding: 0.035,
    cavity: 0.22,
    dust: 0.12,
    freshLift: 0.34,
    roughBase: 0.700,
    roughCavity: 0.10,
    roughWorn: 0.14,
    roughFresh: 0.08,
    facetLarge: 0.0038,
    facetLargeCell: 0.360,
    facetFine: 0.0011,
    facetFineCell: 0.155,
    swell: 0.0026,
    pit: 0.0009,
    erode: 0.0085,
  },
  black: {
    // The dark army is DARK, not absent. In the reference the black knight's cape is the
    // biggest single mass in this shot and you can read every row of mail on it; it
    // samples around (25,33,38). Round 2's albedo rendered that same mass as a featureless
    // black egg — the subject of the shot, carrying no information at all. Lifted, and
    // kept firmly blue: this stone is value-and-hue, never a warm.
    base: new THREE.Color().setHex(0x3c434f, THREE.SRGBColorSpace),
    warm: new THREE.Color().setHex(0x554b3e, THREE.SRGBColorSpace),
    warmDeep: new THREE.Color().setHex(0x2e2820, THREE.SRGBColorSpace),
    cool: new THREE.Color().setHex(0x1c222c, THREE.SRGBColorSpace),
    fresh: new THREE.Color().setHex(0x6e747d, THREE.SRGBColorSpace),
    blotch: 0.26,
    stain: 0.34,
    mottle: 0.16,
    bedding: 0.0,
    cavity: 0.26,
    dust: 0.16,
    freshLift: 0.60,
    roughBase: 0.615,
    roughCavity: 0.13,
    roughWorn: 0.16,
    roughFresh: 0.12,
    facetLarge: 0.0040,
    facetLargeCell: 0.310,
    facetFine: 0.0013,
    facetFineCell: 0.140,
    swell: 0.0022,
    pit: 0.0011,
    erode: 0.0052,
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

/**
 * Gradient noise on a lattice that wraps, so the map is genuinely seamless. This matters
 * more than it sounds: with a non-tiling map you are forced onto mirrored repeat, and a
 * mirrored tangent-space normal map flips its lighting response every tile — which paints
 * a hard checkerboard across every large surface.
 */
function tiledNoise(x: number, y: number, perX: number, perY: number, s: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dot = (ix: number, iy: number, dx: number, dy: number) => {
    const gx = ((ix % perX) + perX) % perX;
    const gy = ((iy % perY) + perY) % perY;
    const a = (ihash(gx, gy, s) / 4294967296) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const n00 = dot(x0, y0, fx, fy);
  const n10 = dot(x0 + 1, y0, fx - 1, fy);
  const n01 = dot(x0, y0 + 1, fx, fy - 1);
  const n11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return a + v * (b - a);
}

function makeGrainTexture(size: number, seed: number, side: Side): THREE.DataTexture {
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
      let a =
        tiledNoise(u * 12, v * 12, 12, 12, seed ^ 0x11) * 0.42 +
        tiledNoise(u * 28, v * 28, 28, 28, seed ^ 0x23) * 0.26 +
        tiledNoise(u * 64, v * 64, 64, 64, seed ^ 0x37) * 0.15;
      // Direction-stretched streaking: bedding for limestone, flow banding for basalt.
      a += limestone
        ? tiledNoise(u * 6, v * 40, 6, 40, seed ^ 0x4b) * 0.20
        : tiledNoise(u * 20, v * 20, 20, 20, seed ^ 0x4b) * 0.14;

      // Pits / vesicles on a jittered grid that wraps with the tile.
      const cu = u * cells, cv = v * cells;
      const ci = Math.floor(cu), cj = Math.floor(cv);
      let pit = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const gi = ci + di, gj = cj + dj;
          const hh = ihash(((gi % cells) + cells) % cells, ((gj % cells) + cells) % cells, seed);
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
        spec = (sh - 0.5) * 0.30 * (0.9 + tiledNoise(u * 48, v * 48, 48, 48, seed ^ 0x5d));
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
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
attribute float aMail;
varying float vRough;
varying float vThin;
varying float vMail;
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
vMail = aMail;
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
uniform vec3 uMail;
uniform vec3 uBlotch;
uniform vec3 uRust;
uniform vec3 uRustTint;
uniform vec3 uRustDeep;
uniform vec3 uTool;
varying float vRough;
varying float vThin;
varying float vMail;
varying vec3 vObjP;
varying vec3 vObjN;
varying vec3 vTanV;
varying vec3 vBitV;
float gGrain;
float gMailH;
float gMailK;
float gRust;
float gTool;
vec3 gMailN;

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

/**
 * One plane of carved chainmail: staggered rows of interlocking rings. Returns the
 * in-plane gradient in .xy and the ring height in .z. Purely analytic — a texture would
 * alias into moire the moment a cape falls away from the camera, and this is the one
 * surface treatment the reference frame makes unmistakable.
 */
vec3 mailPlane( vec2 q ) {
	q.y *= 0.90;
	q.x += 0.5 * floor( mod( q.y, 2.0 ) );
	vec2 f = fract( q ) - 0.5;
	float d = length( f * vec2( 1.0, 1.12 ) );
	float t = clamp( ( d - 0.33 ) / 0.150, -1.0, 1.0 );
	float h = sqrt( max( 0.0, 1.0 - t * t ) );
	float dh = h > 0.05 ? -t / ( h * 0.150 ) : 0.0;
	vec2 g = d > 1e-4 ? ( f / d ) * dh : vec2( 0.0 );
	return vec3( clamp( g, -4.0, 4.0 ), h );
}

/** Triplanar mail. Writes gMailH; returns the perturbed object-space normal. */
vec3 tpMail( vec3 p, vec3 nn, float s, float amp ) {
	vec3 bw = tpBlend( nn );
	vec3 mx = mailPlane( p.zy * s );
	vec3 my = mailPlane( p.xz * s );
	vec3 mz = mailPlane( p.xy * s );
	gMailH = mx.z * bw.x + my.z * bw.y + mz.z * bw.z;
	vec3 nx = vec3( -mx.xy * amp + nn.zy, nn.x );
	vec3 ny = vec3( -my.xy * amp + nn.xz, nn.y );
	vec3 nz = vec3( -mz.xy * amp + nn.xy, nn.z );
	return normalize( nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z );
}
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
{
	vec3 onn = normalize( vObjN );
	gGrain = tpDetail( vObjP, onn, uGrainScale.x ) * 0.60 + tpDetail( vObjP, onn, uGrainScale.y ) * 0.40;
	diffuseColor.rgb *= 1.0 + ( gGrain - 0.5 ) * uGrainAlb;

	// --- rust and ochre staining, as PATCHES WITH EDGES -----------------------------
	// The single most identifiable property of the film's pale army, and the one thing a
	// vertex-interpolated stain can never deliver: at 10 cm triangles a threshold in
	// vertex colour is a soft ramp a hand's width wide, which reads as an airbrush.
	// Three triplanar octaves summed and hard-thresholded here instead, so the boundary
	// is pixel-sharp: the metre layer places the patch, the two finer ones eat ragged
	// bites out of its edge, and a second threshold darkens the middle of the patch where
	// the iron has actually bled out. Warm in albedo, under cold light — the film's
	// relationship, not the reverse.
	float b1 = tpDetail( vObjP, onn, uBlotch.x );
	float b2 = tpDetail( vObjP, onn, uBlotch.y );
	float b3 = tpDetail( vObjP, onn, uBlotch.z );
	float bk = ( b1 - 0.5 ) + ( b2 - 0.5 ) * 0.66 + ( b3 - 0.5 ) * 0.30;
	gRust = smoothstep( uRust.x - uRust.y, uRust.x + uRust.y, bk );
	float rcore = smoothstep( uRust.x + uRust.y * 1.10, uRust.x + uRust.y * 4.5, bk );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uRustTint, gRust * uRust.z );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uRustDeep, rcore * uRust.z );

	// --- the mason's tooling ---------------------------------------------------------
	// Parallel claw-chisel strokes, running horizontally around the piece the way a
	// banker mason dresses a moulding. They come in patches — a real dressed face is
	// tooled where the mason worked it and rubbed smooth where hands and weather have
	// been — and they are the reason the stone's edge energy runs in oriented families
	// instead of scattering isotropically the way procedural grain does.
	gTool = 0.0;
	if ( uTool.z > 0.0 ) {
		float tm = smoothstep( 0.36, 0.64, gGrain ) * ( 1.0 - vMail ) * ( 1.0 - abs( onn.y ) );
		tm *= 1.0 - smoothstep( 0.15, 0.50, fwidth( vObjP.y ) * uTool.x );
		gTool = tm;
		if ( gTool > 0.002 ) {
			diffuseColor.rgb *= 1.0 + sin( vObjP.y * uTool.x * 6.2831853 ) * gTool * uTool.y;
		}
	}

	gMailH = 0.5;
	gMailN = onn;
	gMailK = 0.0;
	if ( vMail > 0.004 ) {
		// Fade the rings out once one of them is down to a pixel or two, or the analytic
		// pattern beats against the sample grid and the far ranks crawl with moire.
		float px = fwidth( vObjP.x + vObjP.y + vObjP.z ) * uMail.x;
		gMailK = vMail * ( 1.0 - smoothstep( 0.16, 0.60, px ) );
		if ( gMailK > 0.004 ) {
			gMailN = tpMail( vObjP, onn, uMail.x, uMail.y * gMailK );
			// Woven metal sits darker in its interstices and catches a rim on every ring.
			diffuseColor.rgb *= 1.0 + ( gMailH - 0.62 ) * uMail.z * gMailK;
		}
	}
}
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = clamp(
	roughness * vRough + ( gGrain - 0.5 ) * uGrainRough + ( 0.5 - gMailH ) * 0.16 * gMailK
		+ gRust * 0.07 - gTool * 0.05,
	0.055, 1.0 );
`;

const FRAG_NORMAL = /* glsl */ `
{
	vec3 onn = normalize( vObjN );
	vec3 d1 = tpNormal( vObjP, onn, uGrainScale.x, uGrainAmp.x * ( 1.0 - 0.45 * gMailK ) );
	vec3 d2 = tpNormal( vObjP, onn, uGrainScale.y, uGrainAmp.y );
	vec3 nd = normalize( d1 + d2 - onn + ( gMailN - onn ) );
	if ( gTool > 0.002 ) {
		vec3 tUp = vec3( 0.0, 1.0, 0.0 ) - onn * onn.y;
		float tl = length( tUp );
		if ( tl > 1e-3 ) {
			nd = normalize( nd + ( tUp / tl ) * ( cos( vObjP.y * uTool.x * 6.2831853 ) * gTool * uTool.z ) );
		}
	}
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
    // Fine tile ~8.5 cm (a 512 map puts a texel at 0.17 mm), coarse tile ~47 cm. The two
    // are deliberately non-harmonic so their beat never lines up into a visible grid.
    uGrainScale: { value: new THREE.Vector2(1 / 0.085, 1 / 0.47) },
    uGrainAmp: { value: new THREE.Vector2(side === 'white' ? 0.17 : 0.22, 0.11) },
    uGrainRough: { value: side === 'white' ? 0.13 : 0.17 },
    uGrainAlb: { value: side === 'white' ? 0.10 : 0.15 },
    // Carved chainmail: ring pitch ~4.6 cm on the piece, which is what the reference
    // frame shows on the dark knight's cape at four metres. x = 1/pitch, y = normal
    // amplitude, z = albedo contrast between ring and interstice.
    //
    // The round-2 amplitude (0.042) was a tenth of what it needed to be: rows of rings
    // that shallow vanish into the ambient the moment the cape turns away, which is
    // exactly how a mailed cape ended up reading as a glassy sheet. Mail relief is
    // CARVED — every ring throws its own shadow — and it is the one surface treatment in
    // this scene whose edges run in genuine oriented families.
    uMail: { value: new THREE.Vector3(1 / 0.046, side === 'white' ? 0.30 : 0.34, 0.42) },
    // Rust patch layer. x/y/z are triplanar tile frequencies: ~2.1 m places the patch,
    // ~0.60 m and ~0.17 m tear its boundary into something a mineral did rather than a
    // gradient tool.
    uBlotch: { value: new THREE.Vector3(1 / 2.1, 1 / 0.6, 1 / 0.17) },
    // threshold, half-width of the (deliberately narrow) edge, overall strength.
    // The stain is a VALUE event first and a hue event second. The film's limestone is
    // warm in albedo, but only just: push the saturation and the pale army turns into
    // terracotta under the flames, which is the same mistake as painting it cold white,
    // only louder. The luminance step at a patch edge is what makes it read as carved
    // stained stone at four metres.
    uRust: { value: new THREE.Vector3(side === 'white' ? 0.020 : 0.070, 0.020, side === 'white' ? 0.95 : 0.55) },
    uRustTint: {
      value:
        side === 'white'
          ? new THREE.Vector3(1.00, 0.83, 0.63)
          : new THREE.Vector3(1.06, 0.96, 0.83),
    },
    uRustDeep: {
      value:
        side === 'white'
          ? new THREE.Vector3(0.57, 0.51, 0.46)
          : new THREE.Vector3(0.66, 0.62, 0.57),
    },
    // Claw-chisel tooling: 1/pitch (5.4 cm strokes), albedo contrast, normal amplitude.
    uTool: { value: new THREE.Vector3(1 / 0.054, side === 'white' ? 0.085 : 0.065, side === 'white' ? 0.20 : 0.16) },
    uSSS: {
      value:
        side === 'white'
          ? new THREE.Color(0.95, 0.55, 0.30).multiplyScalar(0.30)
          : new THREE.Color(0.70, 0.45, 0.30).multiplyScalar(0.12),
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
