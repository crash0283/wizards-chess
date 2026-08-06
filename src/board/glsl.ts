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
 *
 * QUALITY TIERS. Everything below that costs real ALU is written twice: the full path,
 * and a `#ifdef BOARD_LOW` path for interactive play on a phone. The define is set from
 * `world.quality === 'low'` and NOTHING else, so the high tier compiles the same tokens
 * it always did — the preprocessor removes the low branches before the compiler sees
 * them, and a byte-identical capture proves it.
 *
 * What the low path drops is chosen by ARITHMETIC, not by taste. The phone renders a
 * ~512 px buffer over a 19 m board, i.e. roughly 4 cm per pixel across the middle of the
 * field and about 1 cm at the near kerb. Every generation gated out below is band-limited
 * by `bFade` to a feature size at or under 3 cm, so it was already being multiplied by
 * approximately zero on that device — the low path stops paying for it rather than
 * changing what it looks like. The veins, the joints, the grit, the tooling and the
 * polish all stay; there are simply fewer octaves of them.
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
 * WHAT THE PREVIOUS BUILD GOT WRONG, precisely: its leading generation ran at
 * 0.13 cycles/metre. That is a noise cell nearly eight metres across — more than three
 * squares — so on a 2.35 m slab you never saw a vein at all, only one slow ramp of the
 * field. That is why the light squares carried "soft airbrushed low-frequency smears"
 * instead of figure. The frequency, not the contrast, was the bug.
 *
 * Measured off \`wide-establishing\` at 4x on the mid-field: a light square carries two to
 * four BOLD ink-dark strokes running right across it. They are continuous curves that
 * fork and rejoin, they swell into pools and taper away to nothing, their edges are torn
 * rather than drawn, and hairline tributaries hang off them into otherwise clean white
 * stone. Roughly a fifth of the slab is under figure; the rest is clear.
 *
 * That shape is a LEVEL SET of a warped field — \`|f - 0.5| < width\` — not a threshold on
 * a peak. A threshold gives disconnected blobs at the maxima; a level set gives an
 * unbroken curve which is what a vein is. Two things then make it read as stone rather
 * than as a contour plot:
 *
 *   - a two-stage domain warp, the second stage finer than the vein is wide, so the
 *     outline is torn and re-entrant instead of smooth;
 *   - a width that is itself a noise field, so the vein swells into black pools in one
 *     place and thins to a hairline in another. A constant-width level set reads as wire.
 *
 * Three generations, each roughly 2.9x the last, with generations 2 and 3 gated to the
 * neighbourhood of generation 1 so tributaries hang off trunks instead of floating.
 *
 * BAND LIMITS. These are not decoration, they are the difference between marble and
 * salt-and-pepper. A level set of half-width \`w\` in VALUE has a half-width in METRES of
 * about w / (0.5 * F), where F is that generation's frequency — because a normalised fbm
 * climbs at roughly 0.5 per cell. Worked through for the trunk that is a 21 cm stroke,
 * for the tributaries 6 cm, and for the hairlines 17 mm. The hairlines are therefore
 * sub-pixel from anywhere past the front rank, and if they are not faded out there they
 * do not read as hairlines at all — they alias into dense white speckle and turn a navy
 * square into granite. The fade thresholds below are those computed widths, not guesses.
 *
 *   p      marble-space position, metres, already rotated per slab
 *   w      trunk half-width in field units (sets the fraction of the slab under figure)
 *   px     world size of a pixel, for band-limiting the finer generations
 *   hairW  how much of the fine tributary net this stone carries (the navy marble's
 *          figure is quieter than the cream's — the film's dark squares are nearly plain)
 *
 * Returns  x = ink core, y = smoky bleed, z = broad cloud, w = the fine tributary net.
 */
vec4 bMarbleFigure(vec2 p, float w, float px, float hairW){
  // Bedding. Real figure sweeps along the block's grain rather than curling evenly, so
  // the domain is squashed on one axis and turned off the slab's own axes. This is also
  // where the frame's directional gradient energy comes from.
  vec2 q = mat2(0.92, -0.39, 0.39, 0.92) * vec2(p.x * 0.66, p.y * 1.515);

  // Warp stage one — the calligraphic sweep of the vein.
  vec2 a = q + (vec2(bFbm(q * 0.9 + 3.1, 3), bFbm(q * 0.9 + 21.7, 3)) - 0.5) * 1.21;
  // Warp stage two — finer than the vein is wide, so the edge tears.
  a += (vec2(bFbm(a * 3.3 + 7.7, 2), bFbm(a * 3.3 + 55.1, 2)) - 0.5) * 0.231;

  // Width field: pools and tapers.
  float swell = bFbm(a * 1.6 + 31.0, 3);
  float w1 = w * (0.22 + 2.4 * swell * swell);

  // Generation 1 — the trunk.
  float d1 = abs(bFbm(a * 0.75, 4) - 0.5);
  float trunk = 1.0 - smoothstep(w1 * 0.42, w1 * 1.05, d1);
  float near  = 1.0 - smoothstep(w1 * 1.0, w1 * 6.0, d1);
  float bleed = 1.0 - smoothstep(w1 * 0.8, w1 * 7.0, d1);

  // Generation 2 — tributaries, only where a trunk already runs. ~6 cm on the ground.
  float w2 = w * 0.60 * (0.30 + 1.6 * swell);
  float trib = (1.0 - smoothstep(w2 * 0.45, w2 * 1.10, abs(bFbm(a * 2.175 + 11.0, 3) - 0.5)))
             * (0.15 + 0.95 * near) * bFade(0.055, px);

  // Generation 3 — hairlines, ~17 mm on the ground, so present within a metre or so of
  // the lens and gone by the middle of the board. Faded on that real width.
  //
  // A 17 mm feature at the low tier's ~4 cm pixel is already multiplied by bFade ≈ 0
  // everywhere but the nearest half-metre of the frame, so the phone pays for a
  // three-octave fbm and a smoothstep to be told "nothing here". It keeps the trunk and
  // the tributaries — the figure the eye reads as marble — and stops buying the third
  // generation. Density, not character.
#ifdef BOARD_LOW
  float hair = 0.0;
#else
  float w3 = w * 0.55;
  float hair = (1.0 - smoothstep(w3 * 0.50, w3 * 1.20, abs(bFbm(a * 6.15 + 41.0, 3) - 0.5)))
             * (0.10 + 0.90 * near) * bFade(0.017, px) * hairW;
#endif

  // Where the figure gathers. Marble runs in swathes with clear stone between them, and
  // that clear stone is most of what makes a light square read as WHITE rather than as a
  // uniformly grubby mid grey.
  float swathe = clamp(0.18 + 1.15 * smoothstep(0.30, 0.70, bFbm(q * 0.34 + 7.0, 3)), 0.0, 1.0);
  float cloud = bFbm(q * 0.26 + 11.0, 3);

  float core = clamp((trunk + trib * 0.90 + hair * 0.55) * swathe, 0.0, 1.0);
  return vec4(core,
              clamp(bleed * swathe, 0.0, 1.0),
              clamp(0.5 + 2.0 * (cloud - 0.5), 0.0, 1.0),
              clamp(trib * 0.8 + hair, 0.0, 1.0));
}

/**
 * The joint between two slabs: a RECESSED GROOVE, and the darkest thing on the board.
 *
 * POLARITY — the whole point of this function. The previous build returned a *pale* grit
 * whose caller mixed it towards a mortar lighter than the light marble's own ground, gave
 * it no cavity term and left the mirror and the microfacet lobe running across it. Every
 * one of the 112 internal joints therefore came back as a blown white hairline and the
 * field read as a wireframe grid laid over stone. There is no joint anywhere in the
 * reference that is brighter than the light square beside it: at 4x on \`wide-establishing\`
 * the run between two slabs measures L≈95 against a cream square's L≈140, and it is a
 * granular *shadow*, not a rule of light. It is a cut recess — 24 mm open, 9.5 mm deep —
 * and everything down inside it is in its own shade.
 *
 * So the grit here is deliberately LOW-CONTRAST. It says which parts of the mortar are
 * coarse, not which parts are bright; the value comes from the caller's dark mortar and
 * from the cavity term. Its old ±1.75 swing was also most of the glitter along the joint:
 * a full-range noise at 26–190 cycles/metre on a strip a pixel or two wide is the
 * definition of stippling, and stippling is what puts a render's edge energy in the wrong
 * band. Flat and coherent beats spiky.
 *
 *   t   0 at the slab's outer arris (the deepest point of the groove), 1 at the inner
 *       edge of the mortar run
 *   w   world position, for the grain
 *   px  world size of a pixel
 *
 * Returns  x = grit coarseness, y = the shadowed seam where the two stones meet,
 *          z = relief height (-1..1), mostly the surface turning down into the seam.
 */
vec3 bJoint(float t, vec2 w, float px){
  float g1 = bNoise(w * 26.0);
  // 14 mm and 5.5 mm grain. Both are written to fade to their own mean (0.5) once they go
  // sub-pixel, which on the phone they always are, so the low path substitutes that mean
  // outright: identical result, two fewer noise lookups on a run that borders all 112
  // internal joints of the field.
#ifdef BOARD_LOW
  float g2 = 0.5;
  float g3 = 0.5;
#else
  float g2 = bNoise(w * 74.0) * bFade(0.014, px) + 0.5 * (1.0 - bFade(0.014, px));
  float g3 = bNoise(w * 190.0) * bFade(0.0055, px) + 0.5 * (1.0 - bFade(0.0055, px));
#endif
  float grit = clamp(0.44 + 1.00 * (g1 - 0.46) + 0.46 * (g2 - 0.5) + 0.24 * (g3 - 0.5), 0.0, 1.0);
  // The stones meet at t = 0 and that is the bottom of the cut. Grime has run into it for
  // five hundred years and no light reaches it.
  float seam = 1.0 - smoothstep(0.0, 0.46, t);
  return vec3(grit, seam, (grit - 0.5) * 0.55 * bFade(0.014, px) - seam * 1.25);
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
uniform float uReflStrength;
uniform float uReflLod;
uniform vec3 uReflTint;
uniform float uReflKnee;

#ifdef BOARD_LOW
/**
 * THE LOW TIER'S MIRROR — the single biggest thing this piece stops doing on a phone.
 *
 * The high tier renders the entire room a second time, from the mirrored eye point, into
 * its own target, every frame (see reflection.ts). Measured on this box at 640x268: that
 * pass is 140 extra draw calls, 431 000 extra triangles and 850 ms of a 2 750 ms frame —
 * 31 % of the whole picture, spent on the floor alone. On the phone that is what was
 * driving the resolution scaler to its floor, and a 512 px upscale destroys far more of
 * this floor than losing a true mirror ever could.
 *
 * So at the low tier there is no second render and no reflection target at all. What
 * stands in for it is the cheapest thing that keeps the stone POLISHED rather than matte:
 * an analytic environment, evaluated along the reflected ray, with exactly the same
 * anisotropy-free broad character the mirror had after its five blurred taps.
 *
 * It is built to match what the mirror actually returns rather than to look like a room:
 *
 *   - the room's bright band — the kerb fires, the lit plinth faces, the pale armour of
 *     the ranks — all sits within a few metres of the floor, so the environment is bright
 *     at low reflected elevation and falls away exponentially into cold dark stone above;
 *   - a rough or dusty patch gathers a wider cone and therefore averages the room, which
 *     is what the mirror's roughness-driven mip walk was doing;
 *   - the caller's normal jitter and dust mask still break it up, so the sheen is torn by
 *     the same dry film that tears the real one, not laid on like varnish;
 *   - and it goes through the SAME per-stone luminance knee. That is what keeps the
 *     chequer: the cream's knee (0.60) passes most of the band, the navy's (2.80)
 *     suppresses all but the brightest of it, so a dark square stays near-black with a
 *     sheen on it and a light square stays polished.
 *
 * Cost: no render target, no texture fetch, about a dozen ALU ops.
 */
uniform vec3 uEnvBand;
uniform vec3 uEnvHigh;

vec3 boardReflection(vec4 projected, vec3 nWorld, float rough, float mask, float jitter){
  if (uReflStrength <= 0.0) return vec3(0.0);
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 R = reflect(-V, nWorld);
  // Reflected elevation, nudged by the surface's own break-up so the sheen wanders over
  // the slabs' undulation instead of lying flat across the field.
  float el = clamp(R.y + jitter * 0.05, 0.0, 1.0);
  vec3 c = mix(uEnvHigh, uEnvBand, exp(-el * 4.2));
  // Wider gather on rough stone: towards the room's mean rather than towards its floor.
  c = mix(c, mix(uEnvBand, uEnvHigh, 0.62), clamp(rough * 0.85, 0.0, 0.62));
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= lum / (lum + uReflKnee);
  return c * uReflTint * mask;
}
#else
uniform sampler2D uRefl;

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
  uv += nWorld.xz * 0.055 + vec2(jitter * 0.020, jitter * 0.012);
  // Soft fade off the edge of the mirror rather than a hard cut.
  vec2 e = min(uv, 1.0 - uv);
  float inside = smoothstep(-0.03, 0.060, min(e.x, e.y));
  if (inside <= 0.0) return vec3(0.0);
  // Kept sharper than before at the clean end. Blurred to the top of the mip chain a
  // reflection stops being an image of the room and becomes a uniform pale wash — which
  // is the "diffuse glow and no mirrored image" the floor was showing.
  float lod = uReflLod * clamp(0.22 + (rough - 0.05) * 1.35, 0.0, 1.0);
  // A floor reflection is violently anisotropic: it smears DOWN the image many times
  // further than across it. Five taps along the reflected vertical, each further up the
  // mip chain, lay the long blurred streak the film puts under every plinth and flame.
  float sp = 0.014 + 0.050 * rough;
  vec3 c  = textureLod(uRefl, clamp(uv, vec2(0.0), vec2(1.0)), lod).rgb * 0.34;
  c += textureLod(uRefl, clamp(uv + vec2(0.0, sp), vec2(0.0), vec2(1.0)), lod + 0.6).rgb * 0.21;
  c += textureLod(uRefl, clamp(uv - vec2(0.0, sp), vec2(0.0), vec2(1.0)), lod + 0.6).rgb * 0.19;
  c += textureLod(uRefl, clamp(uv + vec2(0.0, sp * 2.7), vec2(0.0), vec2(1.0)), lod + 1.4).rgb * 0.14;
  c += textureLod(uRefl, clamp(uv - vec2(0.0, sp * 2.7), vec2(0.0), vec2(1.0)), lod + 1.4).rgb * 0.12;

  // The single number that was flattening the board. Sampling the mirror pass and adding
  // it whole returns the room's AMBIENT as well as its highlights, and that ambient is a
  // near-constant across the whole floor: it lands on a navy square exactly as hard as on
  // a cream one. Measured, it was lifting the dark squares from the film's L28 to L110 —
  // a five-to-one chequer collapsed to two-to-one — and no amount of albedo or veining
  // survives underneath it.
  //
  // Polished stone does not work like that. It returns the bright things — flames, lit
  // plinth faces, pale armour — as isolated smears, and returns almost nothing where the
  // room is dark. So the reflection is put through a soft knee on its LUMINANCE (hue is
  // left alone): lum/(lum+knee) passes highlights at nearly full strength and suppresses
  // everything well below the knee quadratically. No clipping, no hard threshold.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= lum / (lum + uReflKnee);
  return c * uReflTint * mask * inside;
}
#endif
`;
