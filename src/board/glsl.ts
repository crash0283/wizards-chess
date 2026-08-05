/**
 * PIECE: board — the shared GLSL toolkit.
 *
 * The board is the one surface the camera gets within a metre of, and the shot that
 * judges it asks for the finest detail in the frame to live in the bottom third. A baked
 * texture cannot do that: at 2.35 m per square you would need an 8k map per square to
 * hold a hairline crack at 0.8 m from the lens. So the marble is evaluated per pixel —
 * veining, joint grit, chips, cracks, dust — and only the slowly varying, *stateful*
 * part (accumulated impact dust and scoring) comes from a texture the CPU updates.
 *
 * Determinism: no time, no frame counter, no screen-space randomness. Every value is a
 * pure function of world position, so two renders of the same frame are byte-identical.
 * The hash is fract/dot only — no sin() — so it is stable across drivers too.
 */

export const NOISE_GLSL = /* glsl */ `
float bHash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 bHash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float bNoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = bHash21(i);
  float b = bHash21(i + vec2(1.0, 0.0));
  float c = bHash21(i + vec2(0.0, 1.0));
  float d = bHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float bFbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < oct; i++){
    s += a * bNoise(p);
    n += a;
    p = p * 2.031 + vec2(19.7, 11.3);
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}

/** Domain-warped turbulence. The shape of marble veining lives in the warp. */
float bTurb(vec2 p, int oct){
  float w = bFbm(p * 0.47, 3);
  return bFbm(p + vec2(w, w * 1.63) * 2.1, oct);
}

/** 0 on the vein, 1 off it — a thin ridged filament network. */
float bVein(float t, float w){
  return 1.0 - smoothstep(0.0, w, abs(t - 0.5));
}

/**
 * Band limit. \`px\` is the world-space size of a pixel; a feature smaller than that is
 * faded out instead of aliasing into glitter. This is what lets the surface carry 3 mm
 * detail a metre from the lens and stay quiet at the far end of the board — which is
 * exactly the gradient the judging shot is measured on.
 */
float bFade(float featureSize, float px){
  return smoothstep(px * 0.55, px * 1.9, featureSize);
}

/**
 * The marble figure.
 *
 * Measured off \`low-across-board\`: a light square carries one or two BOLD dark sweeps
 * running right across it — ten to thirty centimetres wide, branching, with soft smoky
 * bleed either side — plus a finer tributary network hanging off them. The mistake that
 * makes a floor read as CG is drawing this at hairline width: a two-centimetre vein is
 * sub-pixel from anywhere but the front row, so the field flattens to featureless gloss
 * exactly where the reference is at its busiest. So the leading generation here is an
 * order of magnitude coarser than a "vein" normally is, and only the third generation is
 * fine enough to need band-limiting.
 *
 *   p      marble-space position, metres, already rotated per slab
 *   w      vein half-width in field units (sets the fraction of the slab under figure)
 *   px     world size of a pixel, for band-limiting the finest generation
 *
 * Returns  x = ink core, y = smoky bleed, z = broad cloud, w = the fine tributary net.
 */
vec4 bMarbleFigure(vec2 p, float w, float px){
  // Ragged the vein edges. Thresholding a smooth field gives contour lines — even,
  // wire-like, unmistakably drawn; a real ink vein has a torn edge. Perturbing the field
  // just before the threshold, at a scale finer than the vein is wide, buys that.
  float rag = (bFbm(p * 2.6 + 5.0, 3) - 0.5) * 0.055;
  // Generation 1 — the bold sweeps. 0.13 cycles/m: roughly one crossing per square.
  float t1 = bTurb(p * 0.130, 4) + rag;
  float core = bVein(t1, w);
  float bleed = bVein(t1, w * 5.5);
  // Generation 2 — tributaries feeding the same warped field three times finer.
  float t2 = bTurb(p * 0.430 + 21.7, 4) + rag * 0.7;
  float trib = bVein(t2, w * 0.72);
  float tribBleed = bVein(t2, w * 3.0);
  // Generation 3 — hairlines. Faded out once they fall under a pixel.
  float t3 = bTurb(p * 1.55 + 63.1, 3);
  float hair = bVein(t3, w * 0.42) * bFade(0.055, px);
  // Where the figure gathers. Marble is not uniformly veined: it runs in swathes with
  // clear stone between them, and that is most of what makes it read as stone at all.
  float swathe = 0.34 + 1.00 * smoothstep(0.30, 0.78, bFbm(p * 0.088 + 7.0, 3));
  float cloud = bFbm(p * 0.26 + 11.0, 4);
  // The figure is not only lines. One side of each field is heavier stone, so the veins
  // sit inside broad soft masses rather than floating on clean white — which is what the
  // reference's light squares actually look like.
  float mass = (smoothstep(0.545, 0.415, t1) + 0.55 * smoothstep(0.535, 0.455, t2));
  core = clamp((core + trib * 0.80 + hair * 0.44) * swathe, 0.0, 1.0);
  return vec4(core,
              clamp((bleed * 0.65 + tribBleed * 0.35 + mass * 0.95) * swathe, 0.0, 1.0),
              clamp(0.5 + 2.4 * (cloud - 0.5), 0.0, 1.0),
              clamp(trib + hair * 0.7, 0.0, 1.0));
}

/**
 * Two rows of small alternating tesserae — the inlaid geometric band that runs down both
 * sides of every joint and right round the field. This is the finest detail in the
 * reference frame and the reason its floor plane reads as the highest-detail region of
 * the image rather than the lowest.
 *
 *   t     0..1 across the band
 *   s     metres along the band
 *   cell  along-band pitch of one tessera, metres
 *   rows  number of tessera rows across the band
 *   aaT   antialias width in t units, aaS the same in cell units
 *
 * Returns  x = pale tessera, y = dark tessera, z = any tessera, w = the mortar between.
 * The parity of (row + column) is what makes it alternate, so the band never reads as a
 * dashed line: it is a chequer, exactly like the film's.
 */
vec4 bTess(float t, float s, float cell, float rows, float aaT, float aaS){
  float rowf = t * rows;
  float row = floor(rowf);
  float rt = rowf - row;
  float cf = s / cell;
  float col = floor(cf);
  float ct = cf - col;
  // The mortar between tesserae. Widened by the antialias width so that once the
  // elements fall below a pixel the band settles to its mean tone instead of crawling.
  float gT = 0.15 + aaT * 1.4;
  float gS = 0.15 + aaS * 1.4;
  float body = smoothstep(gT - aaT, gT + aaT, min(rt, 1.0 - rt) * 2.0)
             * smoothstep(gS - aaS, gS + aaS, min(ct, 1.0 - ct) * 2.0);
  float parity = mod(col + row, 2.0);
  return vec4(body * parity, body * (1.0 - parity), body, 1.0 - body);
}

/** A hard-edged line across a band, centred at \`at\` with half-width \`hw\` in t units. */
float bRule(float t, float at, float hw, float aa){
  return 1.0 - smoothstep(hw - aa, hw + aa, abs(t - at));
}
`;

/**
 * World-space impact/wear lookup, shared by every board material.
 *   x = dust deposition (accumulates where rubble lands)
 *   y = scoring / abrasion
 *   z = baked baseline wear (traffic polish, worn stances)
 *   w = aggregate variation
 */
export const WEAR_GLSL = /* glsl */ `
uniform sampler2D uWear;
uniform float uWearExtent;

vec4 boardWear(vec2 w){
  vec2 uv = w / (2.0 * uWearExtent) + 0.5;
  return texture2D(uWear, clamp(uv, vec2(0.001), vec2(0.999)));
}
`;

/**
 * Planar reflection sampling. The board is polished marble in the reference frames —
 * pieces, plinths and flames are all visibly in it — so this is a real mirrored render,
 * blurred through the mip chain by the local roughness rather than faked with an env map.
 */
export const REFLECT_GLSL = /* glsl */ `
uniform sampler2D uRefl;
uniform float uReflStrength;
uniform float uReflLod;
uniform vec3 uReflTint;

/**
 * The film's floor is reflective but it is not a mirror. Sampling the mirror pass at one
 * tap and a low mip gives an oil-slick, wet-plastic surface: a second, upside-down copy
 * of the room drawn as sharply as the room itself. The reference's is nothing like that —
 * it is a BROAD smear, stretched along the view direction, soft-edged, and torn up by the
 * dry dust lying on the polish.
 *
 * Three things do that here. The sample is pushed well up the mip chain even where the
 * stone is cleanest; it is then smeared with two further taps offset *along* the
 * reflected vertical, because a floor reflection is anisotropic — it blurs down the image
 * far more than across it; and the whole result is scaled by the caller's dust/wear mask
 * so the smear breaks up instead of lying over the floor like varnish.
 *
 * It is still never blurred flat: past the top of a mip chain a reflection stops being an
 * image and becomes a uniform pale wash, which erases the light/dark chequer far more
 * thoroughly than a sharp mirror ever would.
 */
vec3 boardReflection(vec4 projected, vec3 nWorld, float rough, float mask, float jitter){
  if (uReflStrength <= 0.0 || projected.w <= 0.0) return vec3(0.0);
  vec2 uv = projected.xy / projected.w;
  // Ripple the sample by the surface normal so the reflection breaks up over the
  // slab's undulation instead of sliding across it like a mirror.
  uv += nWorld.xz * 0.090 + vec2(jitter * 0.034, jitter * 0.018);
  // Soft fade off the edge of the mirror rather than a hard cut.
  vec2 e = min(uv, 1.0 - uv);
  float inside = smoothstep(-0.03, 0.060, min(e.x, e.y));
  if (inside <= 0.0) return vec3(0.0);
  float lod = uReflLod * clamp(0.44 + (rough - 0.05) * 1.55, 0.0, 1.0);
  float sp = 0.011 + 0.042 * rough;
  vec3 c = textureLod(uRefl, clamp(uv, vec2(0.0), vec2(1.0)), lod).rgb * 0.46;
  c += textureLod(uRefl, clamp(uv + vec2(0.0, sp), vec2(0.0), vec2(1.0)), lod + 0.75).rgb * 0.29;
  c += textureLod(uRefl, clamp(uv - vec2(0.0, sp), vec2(0.0), vec2(1.0)), lod + 0.75).rgb * 0.25;
  return c * uReflTint * mask * inside;
}
`;
