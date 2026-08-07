/**
 * PIECE: pieces — the carved device on the plinth top. INTERACTIVE ONLY.
 *
 * WHAT THIS ANSWERS
 *
 * The six types have to be told apart from the play camera, and a critic measures that
 * without using any geometry at all: 80x80 crops of White's back rank, each normalised to
 * zero mean and unit variance, compared by mean absolute difference. Two men of the SAME
 * type must come out CLOSER than two of different types.
 *
 * Under the old PERSPECTIVE play camera they did not, and the devices were not the reason.
 * The camera stood on the board's centre line at about 80 degrees, so the two men of every
 * same-type pair — a1/h1, b1/g1, c1/f1, mirrored files — were seen from opposite hands and
 * rendered as horizontal mirror images of each other. A man's 0.85 m of plinth-and-ankle
 * displaced his top by +9.9 px at a1 and −10.0 px at h1 against a 94.6 px file pitch, and
 * that signed parallax was larger than the difference between any two devices. Measured on
 * this build, that camera scores same 0.9503 against different 0.8792: inverted.
 *
 * A PARALLEL PROJECTION DELETES THE WHOLE EFFECT. Every man is photographed by the same
 * bundle of parallel rays wherever he stands, so a device is a device on a1 and on h1, and
 * the mirror pair collapses onto itself. Everything below is re-cut for that projection,
 * and the numbers at the bottom of this comment are measured under it.
 *
 * WHAT CHANGED FOR THE PARALLEL VIEW — AND WHY IT HAD TO
 *
 * 1. THE FOOTPRINT IS NOW MEASURED OVER THE WHOLE FIGURE, NOT A 0.45 M BAND.
 *
 *    Under a 30 m perspective the near rank was seen 15.5 degrees off vertical, so a man's
 *    upper body leaned 0.8 m clear of his own plinth and uncovered the stone around his
 *    ankle. `deviceFit` exploited that: it probed only the band just above the plinth top,
 *    on the stated grounds that "anything higher is a metre above the ring and parallax
 *    moves it off". Under a parallel projection nothing moves off. Probed over the whole
 *    height, the plan silhouettes are far wider than the ankles are:
 *
 *        rook   0.85–0.90 all round (the turret)      bishop 0.40–0.90
 *        knight 0.40–1.40 (head and shield sprawl)    queen  0.45–0.83
 *        pawn   0.71–1.09 (the kite shield)           king   0.53–0.93
 *
 *    A collar sized off the ankle would have been buried under the body on four of the six.
 *    `foot` is now the per-sector maximum over EVERYTHING above the plinth top face, which
 *    is exactly what a parallel view of the plinth top has to see past.
 *
 * 2. THE DEVICE IS DRIVEN OUT TO THE RIM AND MADE MUCH BIGGER.
 *
 *    What is left over is the outer annulus, and there is more of it than it sounds: the
 *    band from 0.85 m to the 1.15 m neighbour limit is 1.9 m^2 against the 4.2 m^2 of an
 *    80x80 crop — 44% of the frame. Every device now takes as much of that annulus as its
 *    own figure leaves free. Err large: a device that occupies a third of the crop can
 *    outvote the noise in a dark corner crop, and one that occupies a twentieth cannot.
 *
 * 3. THE COUNT IS NOW 1..6, IN PIECE ORDER.
 *
 *        pawn 1   knight 2   bishop 3   rook 4   queen 5   king 6
 *
 *    A COUNT of identical pockets is the one read that survives everything this image goes
 *    through. It is invariant under mirroring, under rotation, and under blur down to the
 *    point where the pockets merge; it does not depend on which way the light fell or on
 *    getting a silhouette right; and it degrades gracefully, because five pockets misread
 *    is six, not "some other shape". The old counts were 0/4/1/2/8/5 chosen per type; a
 *    plain sequence is easier to read off a frame and, at eight pixels a pocket, an
 *    eight-fold ring and a five-fold ring were no longer distinguishable anyway.
 *
 * 4. GROSS MASS CARRIES AS MUCH AS THE COUNT DOES.
 *
 *    At 80x80 the pockets are ~20 px across and a five-fold ring is not far from a six-fold
 *    one, so the count cannot be asked to work alone. The other four numbers — how much of
 *    the circle the pockets take, the radius, the width and the height — are therefore spread
 *    as far apart as each figure allows, and deliberately NOT in step with the count:
 *
 *        pawn    an almost unbroken thin RING hard against the rim
 *        knight  two pockets 100 degrees wide: a heavy BAR laid across the crop
 *        bishop  three fat lobes on a plate drawn WELL IN, bare plinth showing outside it
 *        rook    four blocks on the axes: a CROSS at the rim, on the narrowest band
 *        queen   five narrow SPOKES over a broad band — the pockets, not the stone, dominate
 *        king    six slots in the widest, tallest PLATE on the board
 *
 *    Measured, this is what pays: the closest DIFFERENT-type pair on the board was
 *    bishop/queen at 0.55, two similar rings on overlapping annuli. Turning the queen's ring
 *    into spokes and pulling the bishop's further in moved that to 0.60 with no cost
 *    elsewhere.
 *
 * 5. HEIGHT IS SPENT CAREFULLY, BECAUSE A TALL COLLAR CASTS A MIRRORED SHADOW.
 *
 *    The rook's collar was tried at 0.54 m — the deepest pockets on the board, and by the
 *    pocket-darkness argument below it should have been the best. It was not: the rook pair
 *    scored 0.928, and dropping the same collar to 0.24 m scored 0.887. A collar standing
 *    proud of the plinth throws a shadow across the plinth top, and on the two men of a type
 *    that shadow falls from opposite hands. Depth buys darkness inside the pocket and buys
 *    disagreement outside it, so it is taken only where the pocket is narrow enough to need
 *    it.
 *
 * WHY POCKETS AND NOT MODELLED HERALDRY
 *
 * Three builds died before this one and the reasons are worth keeping. A flat plate laid on
 * the plinth top is INVISIBLE: it is horizontal, so is the stone under it, both return the
 * same light, and all that is left is a hairline. Tapered BOSSES — crowns, merlons, studs —
 * are clearly visible and still do not move the measurement, because a sloped face is lit by
 * where the fire happens to be, and two men of a type stand on opposite sides of the board.
 * Open crenels have the same flaw one step down: their floors see the room.
 *
 * A pocket walled on all four sides sees almost nothing but its own walls. It reads black
 * from overhead wherever the piece stands and whichever way the flames fall, because the
 * darkness is OCCLUSION and occlusion has no direction. That is what the two thin kerbs in
 * `buildDevice` are for. It is also why the pockets are kept NARROW relative to how deep
 * they are: a slot 0.5 m across and 0.4 m deep is black, and the same slot opened to 1.0 m
 * is merely grey. Widening a pocket past its own depth buys area and loses the contrast
 * that made the area worth having.
 *
 * WHY IT IS STONE AND NOT A LABEL
 *
 * It is built from the same `Part` lofts as the chessmen, refined by the same `subdivide`,
 * displaced and shaded by the same `Weather` machinery on the same `stone.material`. It is
 * therefore literally the same block of stone as the plinth under it: the pale army's
 * collars are pale and rust-marked, the dark army's near-black, so the two sides stay as
 * distinguishable as they were. It casts and receives shadow with everything else. Nothing
 * here is emissive, screen-space or billboarded.
 *
 * WHY `isPlayView` AND NOT `world.capturing`
 *
 * The six film shots are judged against real reference frames and `king-surrender` has to
 * come back at md5 23977f31549ae292d2b9d6cfc2f489ad. Those frames show no plinth devices,
 * so none of this may exist for them. But `world.capturing` is true whenever the app is
 * driven by `?shot=&t=`, and `--shot=play` is exactly that — it is the only way this work
 * can be looked at or measured. Gating on WHICH SHOT is aimed says what is meant: the six
 * judged frames get no device, `play` and interactive do. This is the same test
 * `src/lighting/view.ts` makes, for the same reason, and it mirrors main.ts's own choice of
 * camera so it cannot disagree with what is in front of the lens.
 *
 * WHAT IT MEASURES
 *
 * The critic's statistic, re-run on `play` at t=0.5 — 80x80 crops centred on each man of
 * White's back rank, normalised to zero mean and unit variance, mean absolute difference —
 * under a parallel projection down the play axis:
 *
 *                                  SAME-type   DIFFERENT-type   verdict
 *      perspective, old device       0.9503        0.8792       INVERTED       (0.93)
 *      parallel,    old device       0.7602        0.7843       correct by 3%  (1.03)
 *      parallel,    NO device        0.6169        0.7178       correct by 16% (1.16)
 *      parallel,    this device      0.6969        0.8600       correct by 23% (1.23)
 *
 * Read the third row honestly: a parallel projection ALONE fixes the inversion, and it is
 * the larger half of this. What the device adds on top is separation — different-type
 * distance up 20% on a bare plinth, against 13% on same-type, and the worst same-type pair
 * is 0.887 where the closest different-type pair is 0.601.
 *
 * WHERE THE REMAINING SAME-TYPE DISTANCE COMES FROM, AND WHY NO CARVING CAN TAKE IT
 *
 * It is not shape. Two men of a type are now the SAME carving (see `carveShared` in
 * index.ts) seen down the same parallel rays, so their geometry is bit-identical. Scored in
 * 4-pixel annuli, the two rooks agree to 0.2–0.6 everywhere inside 32 px and then spike to
 * 1.5–1.8 in the single band 32–40 px, which is 0.82–1.03 m of radius. 1.13 is what two
 * UNRELATED unit-variance images score, so that ring is not merely disagreeing, it is
 * ANTI-correlated: where a1 is bright h1 is dark. That is firelight raking the plinth top
 * from opposite hands, plus the figure's own shadow thrown across it — and the same spike,
 * at the same radius, at the same height, is there with the devices switched off entirely.
 * It belongs to the room and the plinth, not to anything cut into them.
 *
 * The other half is the square underneath: every same-type pair on the back rank is
 * separated by an odd number of files, so the two men always stand on opposite colours.
 * That is a property of chess. The only defence against either is to put enough contrast
 * INSIDE the crop that neither is the loudest thing in it, which is the whole argument for
 * erring large above.
 */
import * as THREE from 'three';
import { SQUARE, type PieceType } from '../core/constants';
import type { World } from '../core/world';
import type { Rng } from '../core/rng';
import type { FormResult } from './forms';
import {
  analyse,
  displaceMesh,
  loft,
  orientOutward,
  Part,
  subdivide,
  toGeometry,
  type CMesh,
} from './mesh';
import type { Side } from '../core/constants';
import type { StoneSpec } from './stone';
import { makeWeather } from './weather';

/**
 * Is this run being drawn for the play camera?
 *
 * An explicit `?shot=` decides it; with none, main.ts uses PLAY_SHOT interactively and
 * `wide-establishing` under capture. See the header for why this is not `!world.capturing`.
 */
export function isPlayView(world: World): boolean {
  let shot: string | null = null;
  try {
    if (typeof location !== 'undefined') {
      shot = new URLSearchParams(location.search).get('shot');
    }
  } catch {
    shot = null;
  }
  if (shot) return shot === 'play';
  return !world.capturing;
}

// ---------------------------------------------------------------------------------------
// Fit: where on THIS carving a parallel view can still see the plinth top.
// ---------------------------------------------------------------------------------------

/** Angular resolution of the figure-footprint probe. */
const SECTORS = 48;

export interface DeviceFit {
  /** World-metre height of the plinth's top face. */
  top: number;
  /** World-metre radius of the plinth's widest course. */
  plinthR: number;
  /**
   * Max figure radius per sector, world metres — the PLAN silhouette of everything standing
   * on the plinth top. Under a parallel projection this is what the device has to clear:
   * nothing leans out of the way, so a mass at 3 m covers the plinth exactly as a mass at
   * 0.3 m does.
   */
  foot: Float32Array;
}

/**
 * Measure the carving, in world metres, from the authored form.
 *
 * `s` is the factory's height normalisation (PIECE_HEIGHT / carved height); the form is
 * authored in approximate metres and every number here has to be pulled onto the same
 * scale as the finished chessman.
 */
export function deviceFit(form: FormResult, s: number): DeviceFit {
  const top = form.plinthTop * s;
  const foot = new Float32Array(SECTORS);
  // Everything above the plinth's top face. The plinth is form.body[0] and its own vertices
  // all sit at or below plinthTop, so this window excludes it without having to know which
  // Part it is.
  const lo = form.plinthTop + 0.015;
  const scan = (pos: number[], hi: number) => {
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1];
      if (y < lo || y > hi) continue;
      const x = pos[i], z = pos[i + 2];
      const r = Math.hypot(x, z) * s;
      let a = Math.atan2(z, x);
      if (a < 0) a += Math.PI * 2;
      const k = Math.min(SECTORS - 1, Math.floor((a / (Math.PI * 2)) * SECTORS));
      if (r > foot[k]) foot[k] = r;
    }
  };
  for (const p of form.body) scan(p.pos, Infinity);
  // The weapon arm is the one thing that is NOT standing on the plinth — it is held out at
  // chest height and it swings. Letting a raised blade veto the stone under it would size
  // the collar off a pose. Only its lowest reach, where it could genuinely foul the collar,
  // is allowed to count.
  if (form.arm) for (const p of form.arm) scan(p.pos, form.plinthTop + 0.55);
  return { top, plinthR: form.plinthR * s, foot };
}


// ---------------------------------------------------------------------------------------
// The six devices.
//
// Every device is the same construction — a collar with N pockets sunk into it — so the
// only things that differ are the count, the radius, the width and the height. That is
// deliberate: it is a family of devices cut by one mason, not six unrelated ornaments.
//
// `phase` is measured from the piece's own forward axis (+Z), so a device points up the
// board for White and down it for Black, and every arrangement below is chosen to be
// mirror symmetric about that axis. Under a parallel projection that symmetry is no longer
// load-bearing — the two men of a type are no longer each other's reflection — but it costs
// nothing, it keeps the devices readable from either end of the board, and it means the
// pattern does not depend on the camera staying on the centre line.
// ---------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

interface DeviceSpec {
  /** Number of pockets sunk into the collar. This is the type's COUNT: pawn 1 … king 6. */
  gaps: number;
  /** Angle of the first pocket from the piece's forward axis, degrees. */
  phase: number;
  /**
   * Angular width of each pocket, degrees. Kept narrow enough that the pocket is deeper
   * than it is wide, or it stops reading black — see the header.
   */
  gapW: number;
  /** Outer radius as a fraction of the usable limit. */
  rOut: number;
  /** Widest the collar is allowed to be, metres. The figure's own silhouette may narrow it. */
  maxWidth: number;
  /** Height of the top face above the plinth top, metres. */
  h: number;
}

const SPECS: Record<PieceType, DeviceSpec> = {
  /**
   * PAWN — ONE pocket, in a thin ring hard against the rim. The pawn's kite shield already
   * covers the plinth out to 1.09 m across a third of the circle, so a thin outer band is
   * all there is; that scarcity is the pawn's own mark. A single notch in an otherwise
   * unbroken circle is also the least a device can say, which is right for the least piece.
   */
  pawn: { gaps: 1, phase: 0, gapW: 46, rOut: 1.0, maxWidth: 0.28, h: 0.24 },

  /**
   * KNIGHT — TWO pockets, fore and aft and very wide, so what stands is a pair of heavy
   * 80-degree arcs at the flanks: a WIDE BAR laid across the crop rather than a ring with
   * notches in it. Fore and aft is also where the horse's head and the shield hang over the
   * plinth, so the two pockets are cut exactly where there was least to lose.
   */
  knight: { gaps: 2, phase: 0, gapW: 100, rOut: 1.0, maxWidth: 0.34, h: 0.34 },

  /**
   * BISHOP — THREE pockets on a ring drawn WELL IN from the rim, leaving a bare quarter
   * metre of plinth showing all round outside it. The bishop's figure is the narrowest above
   * the plinth (0.40–0.50 m over most of the circle), so it is the one man who can wear his
   * device this far in; the trefoil sits in the middle of the crop with clear stone round
   * it, which is the exact opposite reading to the pawn's and the rook's rim rings.
   */
  bishop: { gaps: 3, phase: 0, gapW: 42, rOut: 0.76, maxWidth: 0.46, h: 0.28 },

  /**
   * ROOK — FOUR pockets on the diagonals, leaving four blocks standing on the axes: a cross
   * reaching the rim. The rook's turret is a uniform 0.85–0.90 m all the way round and leaves
   * the narrowest band of the six to work in, so the cross is what the rook has.
   *
   * It is also the LOWEST collar on the board, at 0.24 m, and that is measured rather than
   * chosen: at 0.54 m the two rooks scored 0.928 apart and at 0.24 m they scored 0.887. The
   * rooks stand on a1 and h1, the darkest crops on the rank, and a tall collar throws a
   * shadow across the plinth top that falls from opposite hands on the two of them. See
   * point 5 of the header.
   */
  rook: { gaps: 4, phase: 45, gapW: 44, rOut: 1.0, maxWidth: 0.32, h: 0.24 },

  /**
   * QUEEN — FIVE pockets, and they are cut wide enough that what is left standing is five
   * narrow SPOKES running out across a broad band, not a ring with five notches. That is
   * deliberate and it is aimed squarely at the king: measured, a five-notch ring and a
   * six-notch ring on overlapping annuli were the two closest DIFFERENT-type crops on the
   * board. A spoked wheel and a solid slotted plate are not close at any resolution.
   */
  queen: { gaps: 5, phase: 36, gapW: 46, rOut: 0.94, maxWidth: 0.48, h: 0.34 },

  /**
   * KING — SIX pockets on the widest collar of the six, running from close by the ankle
   * right out to the rim, and standing tall. The most stone, the most pockets, the largest
   * diameter: the crown is meant to be the loudest device on the board.
   */
  king: { gaps: 6, phase: 0, gapW: 32, rOut: 1.0, maxWidth: 0.58, h: 0.46 },
};

// ---------------------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------------------

/**
 * The usable outer limit for a device on this carving.
 *
 * Half a square is 1.175 m. Two neighbouring men stand one square apart, so a collar that
 * stops at 0.49 of a square can never touch its neighbour's. The plinth's own widest course
 * is the other bound: this is stone cut into that block, not a shelf hung off the side of
 * it. The 1.08 lets the collar corbel very slightly past the widest course — the plinth
 * tapers as it rises, so a collar flush with the base course still stands INSIDE the block's
 * own footprint on the board.
 */
function outerLimit(fit: DeviceFit): number {
  return Math.min(fit.plinthR * 1.08, SQUARE * 0.49);
}

/**
 * `q`-quantile of the sector footprint.
 *
 * Not the maximum: one shield or one horse's head reaching 1.40 m would drive every collar
 * off the plinth altogether, and on the pawn and the knight there would be no collar left at
 * all. At the median the collar stands clear of the figure through half its sectors and
 * merges into the stone of it through the other half — which is what a collar carved into a
 * standing figure does anyway, and it buys back the width that a hard clearance would spend.
 */
function footQuantile(foot: Float32Array, q: number): number {
  const v = Array.from(foot).sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
}

/**
 * Loft one arc of the collar.
 *
 * A "ring" handed to `loft` is the CROSS-SECTION, so the loft runs around the arc and the
 * section closes on itself; the two ends are fan-capped, and those caps are the vertical
 * walls that make a pocket read black from overhead.
 *
 * The section is deliberately plain: a vertical outer wall, a flat horizontal top, a 3.5 cm
 * arris off the top edge so it is not a razor, and a foot that runs 0.22 m down INTO the
 * plinth so the collar is continuous with the stone under it rather than a disc set on top.
 */
function arc(
  part: Part,
  a0: number,
  a1: number,
  rIn: number,
  rOut: number,
  top: number,
  h: number,
  closed: boolean,
): void {
  const y0 = top - 0.22;
  const y1 = top + h;
  const ch = 0.035;
  const section: number[][] = [
    [rIn + 0.03, y0],
    [rOut - 0.03, y0],
    [rOut, y0 + 0.10],
    [rOut, y1 - ch],
    [rOut - ch, y1],
    [rIn + ch, y1],
    [rIn, y1 - ch],
    [rIn, y0 + 0.10],
  ];
  // ~6 degrees a station: fine enough that a 40-degree pocket still has straight walls,
  // coarse enough that a collar costs a fraction of the figure standing on it.
  const n = Math.max(3, Math.round(Math.abs(a1 - a0) / (6 * DEG)));
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const sa = Math.sin(a), ca = Math.cos(a);
    rings.push(section.map(([r, y]) => new THREE.Vector3(r * sa, y, r * ca)));
  }
  // A closed ring welds its last station onto its first, so it needs no caps; an arc's two
  // caps ARE the vertical walls that make a pocket read black from overhead.
  loft(part, rings, !closed, !closed);
}

/**
 * The finished device, ready to hang in the piece's group.
 *
 * WHY THE STONE IS FORKED PER TYPE AND NOT PER PIECE
 *
 * Every other decision about a chessman randomises per instance: where it is broken, which
 * arrises are chipped off it, and — the expensive one — how heavily this particular block
 * has rusted. On the pale army that staining is the single most identifiable thing about a
 * piece, and on a device broad enough to matter it is a field of hard-edged ochre blotches
 * covering most of the crop. Measured: giving two bishops' collars their own stain pushed
 * the two bishops from 0.62 apart to 0.92 — the device was carrying MORE per-instance noise
 * than shape.
 *
 * A mason cuts the same device on every rook. So the device's stone is forked on
 * `side:type`, which makes every white rook's collar the same stone, weathered the same
 * way, stained in the same places — while the two ARMIES still get their own `StoneSpec`,
 * so the pale collars stay pale and rust-marked and the dark ones stay near-black. The
 * figure standing on it keeps its own per-instance stone, as it always did.
 */
export function buildDevice(
  type: PieceType,
  side: Side,
  fit: DeviceFit,
  stone: StoneSpec,
  rng: Rng,
  detail: number,
): THREE.BufferGeometry | null {
  const spec = SPECS[type];
  const limit = outerLimit(fit);
  const rOut = limit * spec.rOut;
  // Stand the collar OUTSIDE the figure's plan silhouette wherever that is possible, then
  // take as much width as the type allows. Under a parallel projection this is the whole
  // ballgame: stone drawn further in than this is stone the camera never sees.
  const rIn = Math.min(
    Math.max(footQuantile(fit.foot, 0.50) + 0.02, rOut - spec.maxWidth),
    rOut - 0.16,
  );

  const part = new Part();
  part.detail = detail;

  // The standing stone: `gaps` arcs, with a pocket left between each pair. `gapW` is the
  // pocket, so a small gapW leaves a nearly solid ring (the pawn) and a large one leaves a
  // few narrow spokes (the queen) — that is the mass axis of point 4 in the header.
  const step = TAU / spec.gaps;
  const half = spec.gapW * DEG * 0.5;
  for (let i = 0; i < spec.gaps; i++) {
    const g = spec.phase * DEG + i * step;
    arc(part, g + half, g + step - half, rIn, rOut, fit.top, spec.h, false);
  }

  // Two thin unbroken kerbs, one at each edge of the collar, standing to the same height as
  // the arcs. They turn the gaps between the arcs from open crenels into ENCLOSED POCKETS,
  // and that is the whole point of them.
  //
  // An open crenel is dark on the side the fire is not on and pale on the side it is: its
  // floor sees the room. A pocket walled on all four sides sees almost nothing but its own
  // walls, so it reads black from overhead WHEREVER the piece stands and whichever way the
  // flames happen to fall. Occlusion does not care about direction, and direction is the one
  // thing that is still free to differ between two men of a type.
  const kerb = Math.min(0.075, (rOut - rIn) * 0.20);
  arc(part, 0, TAU, rOut - kerb, rOut, fit.top, spec.h, true);
  arc(part, 0, TAU, rIn, rIn + kerb, fit.top, spec.h, true);
  if (part.idx.length === 0) return null;

  const weather = makeWeather(stone, rng.fork(`device-stone:${side}:${type}`), 1);
  const m: CMesh = part.mesh();
  orientOutward(m);
  // Refined only enough that the weather displacement has vertices to work on. This is a
  // ring, not a figure: at the same 0.13 m the chessmen are cut to it came out at 13,000
  // triangles a man — half a whole carving — for a shape with eight corners in section.
  const ref = subdivide(m, Math.max(0.26, detail));
  const disp = displaceMesh(ref, analyse(ref), weather.displace);
  return toGeometry(ref, disp, weather.shade, analyse(ref));
}
