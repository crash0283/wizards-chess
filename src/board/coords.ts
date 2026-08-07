/**
 * PIECE: board — the carved rank and file marks, and the wider band that carries them.
 *
 * THE PROBLEM. Interactive play looks down the play camera: 30 m up, about 80 degrees of
 * declination. Every square separates and nothing is occluded, which is what that camera
 * was for — but from up there a piece is a plan-view footprint and all six types share the
 * same chamfered hexagon. A critic measured it: two men of the SAME type are further apart
 * in image terms than two of different types. You cannot tell a rook from a bishop, so you
 * cannot name the square you want to move it to either.
 *
 * The answer chosen was to mark the board in the world's own language rather than with UI:
 * files a-h and ranks 1-8 CUT INTO THE STONE, at both ends of every file and every rank,
 * lit by the same kerb fires as everything else. No billboards, no glow, no HTML.
 *
 * WHERE THEY GO, AND WHY IT IS THE KERB. Three placements were built and measured off the
 * real play frame (1920x804, 38 deg vertical, eye [0,30,-5.2] on [0,0.4,-0.6]) before this
 * one survived. The board spans only the middle 800 px of a 1920 px frame, so sideways
 * there is room to spare; up and down there is none, and both of the failures were there.
 *
 *   1. THE BORDER BAND AS IT STANDS, 0.34 m wide, buys a 13 px capital. Too small.
 *
 *   2. THE BORDER BAND OPENED OUT to 0.53 m — from the last slab's outer face at 9.388
 *      (see marble.ts) to the kerb's foot at 9.99 — buys 19 px on the near edge. Rendered,
 *      and the file letters could not be found at all. Two independent reasons, both
 *      measured on the frame:
 *
 *        OCCLUSION. A back-rank plinth stands at z = -9.3 and is 0.9 m tall, and the play
 *        camera is 10 degrees off vertical, so its silhouette runs out to z = -9.65 —
 *        past the band's centre line at 9.692. Every file letter sits behind the piece
 *        standing on that file. The rank numerals survived only on ranks 3 to 6, where the
 *        a- and h-files are empty.
 *
 *        LIGHT. The near band reads 21 on a 0-255 luminance scale with a floor of 17 under
 *        it from the atmosphere. The room's aisle lights run down the LONG sides and each
 *        END carries three kerb fires; the two ends of this board are the darkest stone in
 *        the frame, and the band is sunk 30 mm with a 0.3 m kerb standing over it.
 *
 *   3. THE KERB'S TOP FACE, which is what is here. Nothing stands in front of it — it is
 *      outboard of every piece and stands 0.3 m proud of the floor — and the fires burn ON
 *      it, so it is the best-lit horizontal surface on the whole board. It is dressed
 *      stone 0.96 m wide, which is where a mason would cut an inscription anyway.
 *
 * WHAT IT COSTS. The kerb runs off the bottom and top of the play frame, so at the two
 * ends only its inner 0.44 m is in shot: 10.06 (its inner arris) out to about 10.50, where
 * the frame ends. That sets the cap height for the whole board, since the marks are one
 * size all round:
 *
 *   near end (files a-h, White's end)    16 px cap height
 *   far end  (files a-h, Black's end)    14 px
 *   left and right (ranks 1-8)           14 px
 *
 * Smaller than the opened-out band promised and never in doubt, which is the trade that
 * was actually on offer.
 *
 * The ends are cut on the kerb's inner strip because that is all the frame shows of it;
 * the sides are cut further out, at 10.62, where there is no reason to crowd the arris and
 * good reason not to — the kerb fires stand at r = 10.18 +- 0.16 and six of them line each
 * long side. The two radii differ by 0.34 m and the marks are discrete, so the jog only
 * exists at the mitres, where there are no marks.
 *
 * ORIENTATION. Every glyph is cut the same way in world space: its baseline runs along
 * +X and its head points along +Z. That is not arbitrary. The play camera sits at -Z
 * behind White and looks along +Z, so `cross(worldUp, cameraBack)` puts SCREEN RIGHT on
 * world -X and screen up on world +Z. Glyph-x therefore maps to world -X — see `gp` in
 * COORD_FRAG — and every mark, at both ends of the board, reads the right way up and the
 * right way round from White's seat. A mark at Black's end is upside down to Black, which
 * is what the brief asked for and what a board with one player's coordinates does.
 *
 * HOW THEY ARE CUT. Roman capitals and lining numerals, built out of line segments and
 * elliptical arcs, evaluated per fragment as a distance field. Inside the stroke the
 * surface is a V-incision: the wall on one side of the stroke's spine tilts one way and
 * the wall on the other tilts the other, so a fire standing on the kerb lights one flank
 * of every stroke and leaves the other as a shadow line. The cut itself is pale — raw
 * stone and lime dust, see `uCutTint` — and it carries the shadow its own arris throws.
 *
 * THE BAND, while we are here. A critic read the inlaid strip as a flat dashed line rather
 * than one carved band. In the play build it is opened out to the 0.53 m of measurement 2
 * above, its lozenge chain comes down in weight, and two continuous incised rules run the
 * whole way round inside its arrises — a band that carries a chain, rather than a chain
 * pretending to be a band. The film band is untouched; it is capture-locked.
 *
 * NONE OF THIS REACHES A CAPTURE. `isPlayView` decides once, at construction; when it is
 * false not one character of this file is concatenated into any shader and the band keeps
 * the profile it has always had. See playview.ts.
 */
import * as THREE from 'three';
import { SQUARE } from '../core/constants';
import { BORDER_SINK, TOP_Y } from './layout';

/**
 * The play band, board centre outwards. The film band is `R.bandIn`..`R.bandOut` in
 * layout.ts and is not touched.
 *
 * Bounded on the inside by the last slab's outer face — `HALF - JOINT/2` = 9.388 — with a
 * 12 mm margin, and on the outside by `R.filletOut` = 9.97, where the kerb's own sweep
 * begins. Sharing that radius exactly rather than overlapping it matters: two coplanar
 * rings at TOP_Y would z-fight the length of the board.
 */
export const PLAY_BAND = {
  /** Inner arris of the sunk floor. */
  in: 9.426,
  /** Outer arris of the sunk floor. */
  out: 9.958,
  /** Where the ring starts and stops. */
  from: 9.400,
  to: 9.970,
} as const;

/**
 * Where the marks are cut, board centre outwards, on the kerb's top face — which runs
 * from `R.kerbTopIn` = 10.06 to `R.kerbTopOut` = 11.02.
 *
 * `ends` carries the file letters at White's and Black's edges. It is as far inboard as
 * the arris allows, because outboard of about 10.50 the play frame has ended.
 *
 * `sides` carries the rank numerals. Nothing crops it, so it sits clear of the fires,
 * which stand at 10.18 +- 0.16 and are six to a long side.
 */
export const GLYPH_R = { ends: 10.28, sides: 10.62 } as const;

/**
 * Cap height, metres.
 *
 * The tallest ink in the alphabet below reaches y = +-0.50 in glyph units and the stroke
 * adds its half-width of 0.08, so a capital occupies 1.16 cap heights across the run —
 * 0.44 m at this size, i.e. 0.22 m either side of GLYPH_R.
 *
 * At the ends that puts the letter between 10.06 and 10.50: its head is on the kerb's
 * inner arris to the millimetre and its baseline is 1.6 px short of the bottom of the play
 * frame. That is the binding constraint on the whole board and it is why this is 0.38 and
 * not more. What it measures: 16 px at the near end, 14 px at the far end, 14 px on the
 * two sides.
 */
export const GLYPH_CAP = 0.38;

/**
 * Stroke half-width, in cap heights.
 *
 * 0.16 of the cap, which is heavy for a Roman capital — Trajan's are nearer 0.10. It is
 * heavy on purpose: at 15 px cap height a 0.10 stroke is 1.5 px and spends all of that on
 * its own two antialiased edges, so the letter arrives as a grey haze. 0.16 is 2.4 px,
 * which is a pixel of stone with an edge either side, and that is the difference between
 * a letter you read and a letter you infer.
 */
const STROKE = 0.08;

/**
 * The swept profile of the play band. Same shape as the film band in surround.ts — a
 * margin at field level, a hard arris, a short fall, the sunk floor, and back up — just
 * far wider. Every step is a `hard` point so the sweep keeps its arrises.
 */
export function playBandProfile(): Array<[number, number, boolean?]> {
  const sunk = TOP_Y - BORDER_SINK;
  return [
    [PLAY_BAND.from, TOP_Y],
    [PLAY_BAND.in - 0.012, TOP_Y, true],
    [PLAY_BAND.in - 0.004, TOP_Y - BORDER_SINK * 0.72],
    [PLAY_BAND.in, sunk, true],
    [PLAY_BAND.out, sunk, true],
    [PLAY_BAND.out + 0.004, TOP_Y - BORDER_SINK * 0.72],
    [PLAY_BAND.out + 0.012, TOP_Y, true],
    [PLAY_BAND.to, TOP_Y],
  ];
}

export function coordUniforms(): Record<string, THREE.IUniform> {
  return {
    uGlyphCap: { value: GLYPH_CAP },
    uGlyphREnd: { value: GLYPH_R.ends },
    uGlyphRSide: { value: GLYPH_R.sides },
    uGlyphSq: { value: SQUARE },
    // Multipliers on the kerb's own linear colour, not colours in their own right — the
    // cut is the same stone, only newer.
    //
    // WHY THE INCISION IS PALE AND NOT DARK. The obvious carving is a dirt-filled groove,
    // and it was built that way first. It cannot work here. The stone these are cut into
    // sits at the top and bottom of the play frame under an atmospheric veil that measures
    // 17 on a 0-255 luminance scale, with the stone itself only reaching 22 between fires.
    // A groove that multiplies the albedo by 0.2 moves 22 to 18 against a floor of 17: it
    // is arithmetically invisible, and the render agreed — the letters could not be found
    // without lifting the frame two and a half stops. An additive veil can only be beaten
    // from above, so the cut is raw unweathered stone packed with lime dust, which is what
    // the kerb already draws along its own broken arrises at `uStone * 1.28`.
    //
    // AND WHY IT IS THIS PALE. 8.5 is not an albedo; 2.5 in linear terms is not a surface
    // any stone has. It is what the frame costs. Bracketed in a single capture with the
    // multiplier ramped 1.8 to 10.2 across the eight glyphs of every run, so one render
    // measures the whole range at all four edges at once:
    //
    //      1.8 - 3.0   nothing at either end; the rank numerals only just present
    //      4.2 - 5.4   ranks legible; file letters legible ONLY beside a kerb fire
    //      7.8 - 9.0   all eight files legible at both ends, ranks bright, none blown
    //     10.2 +       still not clipped, and starting to read as paint rather than stone
    //
    // The two ends of this board get a small fraction of the irradiance of its long sides:
    // the room's aisle lights run down the SIDES, and the three kerb fires at each end
    // stand AT kerb height, so their light arrives along the very surface it has to reveal.
    // Nothing available to this piece changes that. The cut is already a 46 degree V, which
    // is about the best angle for turning a grazing source towards a camera looking
    // straight down, and after that albedo is the only term left. A mark the player cannot
    // read is worth nothing, so the mark wins — and the number is stated here in full
    // rather than buried.
    uCutTint: { value: new THREE.Vector3(8.5, 8.3, 7.8) },
    // The shadow line. A V-cut 24 mm deep throws one, and it is the second half of what
    // makes these read as carving rather than as paint: pale stroke, dark edge.
    uShadeTint: { value: new THREE.Vector3(0.42, 0.41, 0.40) },
  };
}

/**
 * Inserted into BORDER_FRAG immediately before it starts mixing albedo, and ONLY in the
 * play build. On the film band the lozenge chain is the only thing on the stone and it
 * carries the band on its own. On the play band the sunk floor is 1.5 times wider, so the
 * chain's elements are 1.5 times bigger, and at full strength a run of big pale chevrons
 * IS the dashed line the critic objected to. Weight it back and let the two continuous
 * rules below carry the band instead.
 */
export const BAND_CHAIN_GLSL = /* glsl */ `
  face *= 0.62;
  slope *= 0.62;
  dot2 *= 0.62;

`;

/**
 * Appended to the END of BORDER_FRAG in the play build.
 *
 * Two continuous incised rules, one inside each arris, running the whole way round without
 * a break. This is the difference between a band and a chain: a dashed run of elements
 * reads as a dashed line at any distance, but a dashed run BETWEEN two unbroken cut lines
 * reads as ornament inside a band, which is what the reference has.
 */
export const BAND_RULE_FRAG = /* glsl */ `

  // --- the band's two continuous rules ---------------------------------------------------
  {
    float bRule2 = (1.0 - smoothstep(0.030, 0.052, min(abs(bt - 0.10), abs(bt - 0.90))))
                 * inBand;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.44, 0.43, 0.42), bRule2 * 0.70);
    gCavity *= mix(1.0, 0.80, bRule2);
    gRough = clamp(gRough + bRule2 * 0.12, 0.08, 1.0);
    vec2 bAw = abs(w);
    vec3 bAcross = (bAw.x > bAw.y) ? vec3(sign(w.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(w.y));
    gNormalPert -= bAcross * sign(bt - 0.5) * bRule2 * 0.45;
  }
`;

/** Uniforms + the glyph distance field. Concatenated onto KERB_HEAD in the play build. */
export const COORD_HEAD = /* glsl */ `
uniform float uGlyphCap;
uniform float uGlyphREnd;
uniform float uGlyphRSide;
uniform float uGlyphSq;
uniform vec3 uCutTint;
uniform vec3 uShadeTint;

const float GDEG = 0.017453293;

/**
 * Running nearest-point over the strokes of one glyph.
 *
 * best.x is the distance to the nearest stroke SPINE; best.yz is the unit direction from
 * that nearest point to the fragment. The direction is the whole reason this is tracked
 * rather than just a min(): it is the outward normal of the incision, and it is what tips
 * one wall of every stroke towards the fires and the other away.
 */
void gSeg(inout vec3 best, vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  vec2 d = pa - ba * h;
  float l = length(d);
  if (l < best.x) best = vec3(l, d / max(l, 1e-6));
}

/**
 * An elliptical arc, as ten chords. The largest bowl here has a 0.5 cap-height radius, so
 * a 36-degree chord departs from the true curve by 0.024 cap heights — a fifth of a pixel
 * at the size these are cut. Ten is a constant so the loop unrolls under GLSL ES 1.00.
 */
void gArc(inout vec3 best, vec2 p, vec2 ctr, vec2 rad, float a0, float a1) {
  vec2 prev = ctr + rad * vec2(cos(a0), sin(a0));
  for (int i = 1; i <= 10; i++) {
    float a = mix(a0, a1, float(i) * 0.1);
    vec2 cur = ctr + rad * vec2(cos(a), sin(a));
    gSeg(best, p, prev, cur);
    prev = cur;
  }
}

/**
 * The alphabet. Glyph space: cap height 1.0, baseline at y = -0.5, capital line at +0.5,
 * origin at the centre of the letter. ids 0-7 are A-H, ids 8-15 are 1-8.
 *
 * Monoline with square-cut serifs on the stems. Roman inscriptional capitals modulate
 * their strokes, but modulation at a 2.6 px stroke is a thinner stroke in places and
 * nothing else, so the weight is kept flat and the Roman character is carried by the
 * proportions, the serifs and the V-section of the cut.
 */
vec3 gGlyph(int id, vec2 p) {
  vec3 b = vec3(1e9, 0.0, 0.0);
  if (id == 0) {                                  // A
    gSeg(b, p, vec2(-0.30, -0.50), vec2( 0.00,  0.50));
    gSeg(b, p, vec2( 0.30, -0.50), vec2( 0.00,  0.50));
    gSeg(b, p, vec2(-0.15, -0.08), vec2( 0.15, -0.08));
    gSeg(b, p, vec2(-0.38, -0.50), vec2(-0.20, -0.50));
    gSeg(b, p, vec2( 0.20, -0.50), vec2( 0.38, -0.50));
  } else if (id == 1) {                           // B
    gSeg(b, p, vec2(-0.26, -0.50), vec2(-0.26,  0.50));
    gSeg(b, p, vec2(-0.34,  0.50), vec2(-0.18,  0.50));
    gSeg(b, p, vec2(-0.34, -0.50), vec2(-0.18, -0.50));
    gSeg(b, p, vec2(-0.26,  0.50), vec2( 0.02,  0.50));
    gSeg(b, p, vec2(-0.26,  0.02), vec2( 0.02,  0.02));
    gSeg(b, p, vec2(-0.26, -0.50), vec2( 0.04, -0.50));
    gArc(b, p, vec2( 0.02,  0.26), vec2(0.24, 0.24),  90.0 * GDEG, -90.0 * GDEG);
    gArc(b, p, vec2( 0.04, -0.24), vec2(0.26, 0.26),  90.0 * GDEG, -90.0 * GDEG);
  } else if (id == 2) {                           // C
    gArc(b, p, vec2( 0.00,  0.00), vec2(0.30, 0.50),  42.0 * GDEG, 318.0 * GDEG);
  } else if (id == 3) {                           // D
    gSeg(b, p, vec2(-0.26, -0.50), vec2(-0.26,  0.50));
    gSeg(b, p, vec2(-0.34,  0.50), vec2(-0.18,  0.50));
    gSeg(b, p, vec2(-0.34, -0.50), vec2(-0.18, -0.50));
    gSeg(b, p, vec2(-0.26,  0.50), vec2(-0.02,  0.50));
    gSeg(b, p, vec2(-0.26, -0.50), vec2(-0.02, -0.50));
    gArc(b, p, vec2(-0.02,  0.00), vec2(0.32, 0.50),  90.0 * GDEG, -90.0 * GDEG);
  } else if (id == 4) {                           // E
    gSeg(b, p, vec2(-0.24, -0.50), vec2(-0.24,  0.50));
    gSeg(b, p, vec2(-0.24,  0.50), vec2( 0.24,  0.50));
    gSeg(b, p, vec2(-0.24,  0.00), vec2( 0.16,  0.00));
    gSeg(b, p, vec2(-0.24, -0.50), vec2( 0.26, -0.50));
    gSeg(b, p, vec2( 0.24,  0.40), vec2( 0.24,  0.50));
    gSeg(b, p, vec2( 0.26, -0.50), vec2( 0.26, -0.40));
    gSeg(b, p, vec2( 0.16, -0.06), vec2( 0.16,  0.06));
  } else if (id == 5) {                           // F
    gSeg(b, p, vec2(-0.24, -0.50), vec2(-0.24,  0.50));
    gSeg(b, p, vec2(-0.24,  0.50), vec2( 0.24,  0.50));
    gSeg(b, p, vec2(-0.24,  0.02), vec2( 0.16,  0.02));
    gSeg(b, p, vec2( 0.24,  0.40), vec2( 0.24,  0.50));
    gSeg(b, p, vec2( 0.16, -0.04), vec2( 0.16,  0.08));
    gSeg(b, p, vec2(-0.32, -0.50), vec2(-0.16, -0.50));
  } else if (id == 6) {                           // G
    gArc(b, p, vec2( 0.00,  0.00), vec2(0.30, 0.50),  42.0 * GDEG, 330.0 * GDEG);
    gSeg(b, p, vec2( 0.26, -0.25), vec2( 0.26, -0.04));
    gSeg(b, p, vec2( 0.09, -0.04), vec2( 0.28, -0.04));
  } else if (id == 7) {                           // H
    gSeg(b, p, vec2(-0.28, -0.50), vec2(-0.28,  0.50));
    gSeg(b, p, vec2( 0.28, -0.50), vec2( 0.28,  0.50));
    gSeg(b, p, vec2(-0.28,  0.00), vec2( 0.28,  0.00));
    gSeg(b, p, vec2(-0.36,  0.50), vec2(-0.20,  0.50));
    gSeg(b, p, vec2(-0.36, -0.50), vec2(-0.20, -0.50));
    gSeg(b, p, vec2( 0.20,  0.50), vec2( 0.36,  0.50));
    gSeg(b, p, vec2( 0.20, -0.50), vec2( 0.36, -0.50));
  } else if (id == 8) {                           // 1
    gSeg(b, p, vec2( 0.00, -0.50), vec2( 0.00,  0.50));
    gSeg(b, p, vec2(-0.17,  0.30), vec2( 0.00,  0.50));
    gSeg(b, p, vec2(-0.20, -0.50), vec2( 0.20, -0.50));
  } else if (id == 9) {                           // 2
    gArc(b, p, vec2( 0.00,  0.22), vec2(0.26, 0.28), 200.0 * GDEG, -22.0 * GDEG);
    gSeg(b, p, vec2( 0.241, 0.115), vec2(-0.26, -0.50));
    gSeg(b, p, vec2(-0.28, -0.50), vec2( 0.28, -0.50));
  } else if (id == 10) {                          // 3
    gArc(b, p, vec2( 0.00,  0.26), vec2(0.25, 0.24), 195.0 * GDEG, -60.0 * GDEG);
    gArc(b, p, vec2( 0.00, -0.24), vec2(0.27, 0.26),  65.0 * GDEG, -195.0 * GDEG);
    gSeg(b, p, vec2( 0.125, 0.052), vec2( 0.114, -0.004));
  } else if (id == 11) {                          // 4
    gSeg(b, p, vec2( 0.10,  0.50), vec2(-0.30, -0.12));
    gSeg(b, p, vec2(-0.30, -0.12), vec2( 0.28, -0.12));
    gSeg(b, p, vec2( 0.10,  0.50), vec2( 0.10, -0.50));
  } else if (id == 12) {                          // 5
    gSeg(b, p, vec2(-0.24,  0.50), vec2( 0.26,  0.50));
    gSeg(b, p, vec2(-0.24,  0.50), vec2(-0.24,  0.08));
    gSeg(b, p, vec2(-0.24,  0.08), vec2( 0.049, 0.115));
    gArc(b, p, vec2( 0.00, -0.18), vec2(0.28, 0.30),  80.0 * GDEG, -175.0 * GDEG);
  } else if (id == 13) {                          // 6
    gArc(b, p, vec2( 0.20, -0.18), vec2(0.48, 0.62), 180.0 * GDEG,  90.0 * GDEG);
    gArc(b, p, vec2( 0.00, -0.20), vec2(0.28, 0.28),  90.0 * GDEG, -270.0 * GDEG);
  } else if (id == 14) {                          // 7
    gSeg(b, p, vec2(-0.28,  0.50), vec2( 0.28,  0.50));
    gSeg(b, p, vec2( 0.28,  0.50), vec2(-0.08, -0.50));
    gSeg(b, p, vec2(-0.18, -0.02), vec2( 0.10, -0.02));
  } else {                                        // 8
    gArc(b, p, vec2( 0.00,  0.26), vec2(0.235, 0.235), 90.0 * GDEG, -270.0 * GDEG);
    gArc(b, p, vec2( 0.00, -0.235), vec2(0.275, 0.265), 90.0 * GDEG, -270.0 * GDEG);
  }
  return b;
}
`;

/**
 * Appended to the END of KERB_FRAG, after `diffuseColor.rgb *= albedo` and after the kerb
 * has set gRough / gCavity / gReflMask / gNormalPert — so this works on those directly
 * rather than on `albedo`, which by then has already been consumed.
 *
 * `top` is the kerb's own mask for its top face, computed above from the across-profile
 * coordinate. Multiplying by it is what keeps the inscription off the risers and treads:
 * a letter running over an arris is not an inscription, it is a smear.
 */
export const COORD_FRAG = /* glsl */ `

  // --- carved rank and file marks --------------------------------------------------------
  // Which side of the course this fragment is on decides which axis runs ALONG the kerb and
  // therefore whether it is a file letter or a rank numeral. The glyph is always oriented
  // the same way in world space: reading direction along -X, head along +Z, which is
  // screen-right and screen-up from the play camera behind White.
  {
    vec2 gaw = abs(w);
    bool gEnd = gaw.y > gaw.x;                    // the ends of the board carry the files
    float gR = gEnd ? uGlyphREnd : uGlyphRSide;
    float gAlong = gEnd ? w.x : w.y;
    float gIdx = clamp(floor(gAlong / uGlyphSq + 4.0), 0.0, 7.0);
    float gCtrA = (gIdx - 3.5) * uGlyphSq;
    vec2 gCtr = gEnd ? vec2(gCtrA, sign(w.y) * gR) : vec2(sign(w.x) * gR, gCtrA);
    int gId = int(gIdx) + (gEnd ? 0 : 8);
    vec2 gp = vec2(-(w.x - gCtr.x), w.y - gCtr.y) / uGlyphCap;

    // Everything outside one glyph's own box is plain stone, and skipping it there keeps
    // the distance field off all but a few per cent of the kerb's fragments.
    float gDist = 1e9;
    vec2 gDir = vec2(0.0, 1.0);
    if (abs(gp.x) < 0.62 && abs(gp.y) < 0.66) {
      vec3 gb = gGlyph(gId, gp);
      gDist = gb.x - ${STROKE.toFixed(3)};
      gDir = gb.yz;
    }

    // Half a pixel, in glyph units, so a stroke edge resolves over one pixel and no more.
    // At the play camera a pixel is about 0.062 cap heights and the stroke is 0.160 wide,
    // so there is exactly enough room for an edge — anything wider erases the letter.
    float gAA = max(fwidth(gp.x), fwidth(gp.y)) * 0.5 + 0.002;
    float gFace = clamp(top, 0.0, 1.0);
    // Inside the incision, and the shadow its arris throws immediately outside it.
    float gCut = (1.0 - smoothstep(-gAA, gAA, gDist)) * gFace;
    float gRim = smoothstep(-gAA, gAA, gDist)
               * (1.0 - smoothstep(0.032, 0.032 + gAA * 2.0, gDist)) * gFace;

    // Raw stone and lime dust in the cut; the shadow the cut throws round its own arris.
    // Multipliers on the kerb's own colour: it is the same stone, so it may only be newer
    // or dirtier, never a new hue.
    diffuseColor.rgb *= mix(vec3(1.0), uCutTint, gCut * 0.94);
    diffuseColor.rgb *= mix(vec3(1.0), uShadeTint, gRim * 0.80);

    // Raw stone is rough and matt — it returns the fires rather than the room, which is
    // what keeps a pale cut reading as stone and not as a painted mark.
    gCavity *= mix(1.0, 0.93, gCut);
    gRough = clamp(gRough + gCut * 0.20, 0.08, 1.0);

    // THE CARVING. gDir points from the stroke's spine out to this fragment, so the two
    // halves of every stroke get opposite tilts: a V-section, whose near flank takes the
    // fire standing on the kerb and whose far flank is the shadow line. 0.06 cap heights
    // deep over a 0.08 half-width is a slope of 0.75 — a real inscription's section.
    vec3 gW = vec3(-gDir.x, 0.0, gDir.y);
    gNormalPert -= gW * gCut * 1.05;
  }
`;
