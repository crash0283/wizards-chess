/**
 * PIECE: pieces — the carved device on the plinth top. INTERACTIVE ONLY.
 *
 * WHAT THIS FIXES
 *
 * Interactive play looks down the play camera: 30 m up, about 80 degrees of declination.
 * That angle was chosen because it separates all 64 squares and occludes nothing, and it
 * does — but it also throws away the only cue that ever told the six types apart. At 80
 * degrees almost none of a chessman's HEIGHT reaches the screen; what is left is a plan
 * footprint, and every one of the six sits on the same chamfered hexagonal plinth. A
 * critic measured it without using any geometry at all: 80x80 crops of White's back rank,
 * each normalised to zero mean and unit variance, compared by mean absolute difference.
 * Two men of the SAME type came out 0.945 apart, two of DIFFERENT types 0.819 — the
 * measurement was INVERTED. Apparent size was set by where a piece stood, not by what it
 * was: a 2.55 m pawn drew 80 px across against the 4.15 m queen's 67.
 *
 * THE DEVICE
 *
 * Each man wears a COLLAR of carved stone on his plinth top: a ring standing 0.20–0.36 m
 * proud, with the type's device sunk into it as a set of enclosed POCKETS.
 *
 *   pawn    no pockets — one plain unbroken roundel, the narrowest ring of the six
 *   rook    four pockets on the axes, leaving four blocks on the diagonals — a
 *           crenellated square, on the narrow band a turret leaves free
 *   knight  one pocket 92 degrees wide, facing the enemy — a horseshoe, the only broken
 *           ring on the board
 *   bishop  two pockets at the flanks, on the innermost ring of the six — a mitre lying
 *           fore and aft, with bare plinth showing outside it
 *   queen   eight pockets on a ring drawn in from the rim — a coronet
 *   king    five pockets on the widest, tallest collar — a crown
 *
 * Nought / four / one / two / eight / five, at four different radii. That is a COUNT and a
 * PLACEMENT, and both survive being reduced to an 80x80 crop.
 *
 * WHY IT IS ON THE RIM AND NOT IN THE MIDDLE
 *
 * The obvious place for a device is the middle of the plinth top, and the middle of the
 * plinth top is exactly where the figure is standing. Measured off the real carvings, the
 * free annulus in the band just above the plinth's top face runs:
 *
 *      bishop 0.43 -> 1.09    queen 0.45 -> 1.04    king 0.52 -> 1.10
 *      rook   0.83 -> 1.10    knight (free except across the front)   pawn (free except
 *                                                                     under the shield)
 *
 * So every device lives on that rim, where it is also up against the highest-contrast edge
 * in the crop — lit stone against dark board — which is precisely what a low-resolution
 * comparison keeps. `deviceFit` measures that annulus off the authored form, so a type
 * whose ankle is fat gets a narrow band and one whose ankle is thin gets a broad plate,
 * and the width itself becomes another thing that tells them apart.
 *
 * WHY POCKETS AND NOT MODELLED HERALDRY
 *
 * Three builds died before this one and the reasons are worth keeping. A flat plate laid
 * on the plinth top is INVISIBLE: it is horizontal, so is the stone under it, both return
 * the same light, and all that is left is a hairline. Tapered BOSSES — crowns, merlons,
 * studs — are clearly visible and still do not move the measurement, because a sloped face
 * is lit by where the fire happens to be, and the two men of a type stand at MIRRORED
 * files, so the same boss is lit from opposite hands on the two of them. Open crenels have
 * the same flaw one step down: their floors see the room.
 *
 * A pocket walled on all four sides sees almost nothing but its own walls. It reads black
 * from overhead wherever the piece stands and whichever way the flames fall, because the
 * darkness is OCCLUSION and occlusion has no direction. That is what the two thin kerbs in
 * `buildDevice` are for, and it is the only reason this device measures better than the
 * bare plinth did.
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
 * come back at md5 45ebe28f78b6837bb2816b5fcccbe9ab. The reference frames show no plinth
 * devices, so none of this may exist for them. But `world.capturing` is true whenever the
 * app is driven by `?shot=&t=`, and `tools/capture.mjs --shot=play` is exactly that — it
 * is the only way this work can be looked at or measured. Gating on WHICH SHOT is aimed
 * says what is meant: the six judged frames get no device, `play` and interactive do. This
 * is the same test `src/lighting/view.ts` makes, for the same reason, and it mirrors
 * main.ts's own choice of camera so it cannot disagree with what is in front of the lens.
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
// Fit: where on THIS carving the device can go.
// ---------------------------------------------------------------------------------------

/** Angular resolution of the figure-footprint probe. */
const SECTORS = 48;

export interface DeviceFit {
  /** World-metre height of the plinth's top face. */
  top: number;
  /** World-metre radius of the plinth's widest course. */
  plinthR: number;
  /** Max figure radius per sector in the band just above the plinth top, world metres. */
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
  // Only the band the device actually occupies. Anything higher — a cape, a horse's
  // barrel, a shield — is a metre above the ring and parallax moves it off; letting it
  // veto the ring would leave half the board with no device at all.
  const lo = form.plinthTop + 0.015;
  const hi = form.plinthTop + 0.45;
  const scan = (pos: number[]) => {
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
  // The plinth is form.body[0] and its vertices all sit at or below plinthTop, so the
  // height window excludes it without having to know which Part it is.
  for (const p of form.body) scan(p.pos);
  if (form.arm) for (const p of form.arm) scan(p.pos);
  return { top, plinthR: form.plinthR * s, foot };
}


// ---------------------------------------------------------------------------------------
// The six devices.
//
// Every device is the same construction — a collar with N pockets sunk into it — so the
// only things that differ are the count, the placement, the radius and the width. That is
// deliberate: it is a family of devices cut by one mason, not six unrelated ornaments.
//
// The one rule none of them may break: EVERY POCKET SET IS MIRROR SYMMETRIC ABOUT THE
// PIECE'S OWN FORWARD AXIS. `a` here is measured from that axis (+Z), so a device points
// up the board for White and down it for Black. The two men of a type stand at mirrored
// files — a1/h1, b1/g1, c1/f1 — and their crops are near mirror images of one another. An
// asymmetric device would be scored as two DIFFERENT shapes on the two of them, which is
// the opposite of what it is for. Every `phase` below is chosen so that reflecting the set
// maps it onto itself.
// ---------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

interface DeviceSpec {
  /** Number of pockets sunk into the collar. 0 = an unbroken ring. */
  gaps: number;
  /**
   * Angle of the FIRST gap from the piece's forward axis, degrees. Every arrangement is
   * mirror symmetric about that axis — see the header for why that is load-bearing.
   */
  phase: number;
  /** Angular width of each pocket, degrees. */
  gapW: number;
  /** Outer radius as a fraction of the usable limit. */
  rOut: number;
  /** Widest the collar is allowed to be, metres. The figure's own ankle may narrow it. */
  maxWidth: number;
  /** Height of the top face above the plinth top, metres. */
  h: number;
}

const SPECS: Record<PieceType, DeviceSpec> = {
  /**
   * PAWN — a plain roundel: no gaps at all and the narrowest collar of the six, a single
   * thin unbroken circle right at the rim. Nothing else on the board draws that, and it
   * survives the pawn's own kite shield leaning across one sector of it.
   */
  pawn: { gaps: 0, phase: 0, gapW: 0, rOut: 1.0, maxWidth: 0.28, h: 0.20 },

  /**
   * ROOK — a crenellated square: gaps on the four axes leave four blocks standing on the
   * diagonals. The rook's turret is the widest figure of the six relative to its plinth and
   * leaves only a narrow band to work in, so the four blocks carry all of the shape.
   */
  rook: { gaps: 4, phase: 0, gapW: 42, rOut: 1.0, maxWidth: 0.36, h: 0.34 },

  /**
   * KNIGHT — a horseshoe: one gap, wide, facing the enemy. The opening is not a
   * stylisation — the horse's head and forelegs come down across the front of this plinth
   * and there is no free stone there — but it is also the only BROKEN ring on the board,
   * and a broken ring can never be counted as a whole one.
   */
  knight: { gaps: 1, phase: 0, gapW: 92, rOut: 1.0, maxWidth: 0.52, h: 0.32 },

  /**
   * KING — a crown of five broad merlons on the widest, tallest collar of the six, running
   * from close by the ankle right out to the rim. Five-fold symmetry appears nowhere else
   * in either army, and the first merlon sits square on the forward axis so the whole
   * pattern is symmetric about it.
   */
  king: { gaps: 5, phase: 36, gapW: 42, rOut: 1.0, maxWidth: 0.68, h: 0.36 },

  /**
   * QUEEN — a coronet of eight short lobes on a ring drawn IN from the rim, so that the
   * plinth's own bare edge shows outside it. Eight against the king's five is a real
   * difference in count, and the smaller radius keeps them apart even where the count
   * itself blurs at eight pixels.
   */
  queen: { gaps: 8, phase: 22.5, gapW: 27, rOut: 0.88, maxWidth: 0.54, h: 0.28 },

  /**
   * BISHOP — a mitre: gaps at the two flanks leave two crescents lying fore and aft. This
   * is the innermost ring of the six — the bishop's ankle is the narrowest, so the collar
   * sits well in from the rim and leaves a broad bare margin of plinth outside it, which is
   * the exact opposite of the rook's and the pawn's.
   */
  bishop: { gaps: 2, phase: 90, gapW: 52, rOut: 0.82, maxWidth: 0.56, h: 0.32 },
};

// ---------------------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------------------

/**
 * The usable outer limit for a device on this carving.
 *
 * Half a square is 1.175 m. Two neighbouring men stand one square apart, so a collar that
 * stops at 0.49 of a square can never touch its neighbour's, and it clears a neighbour's
 * plinth — 1.10 m at the floor, about 0.93 m at the height this sits — with room to spare.
 * The plinth's own widest course is the other bound: this is stone cut into that block,
 * not a shelf hung off the side of it.
 */
function outerLimit(fit: DeviceFit): number {
  return Math.min(fit.plinthR * 1.05, SQUARE * 0.49);
}

/** Median of the sector footprint — a robust inner clearance one shield cannot drag out. */
function medianFoot(foot: Float32Array): number {
  const v = Array.from(foot).sort((a, b) => a - b);
  return v[v.length >> 1];
}

/**
 * Loft one arc of the collar.
 *
 * A "ring" handed to `loft` is the CROSS-SECTION, so the loft runs around the arc and the
 * section closes on itself; the two ends are fan-capped, and those caps are the vertical
 * walls that make a gap read black from overhead.
 *
 * The section is deliberately plain: a vertical outer wall, a flat horizontal top, a
 * 3.5 cm arris off the top edge so it is not a razor, and a foot that runs 0.22 m down
 * INTO the plinth so the collar is continuous with the stone under it rather than a disc
 * set on top.
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
  // ~4 degrees a station: fine enough that a 30-degree merlon still has a straight-ish
  // face, coarse enough that six armies' worth of collars cost nothing.
  const n = Math.max(3, Math.round(Math.abs(a1 - a0) / (4 * DEG)));
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const sa = Math.sin(a), ca = Math.cos(a);
    rings.push(section.map(([r, y]) => new THREE.Vector3(r * sa, y, r * ca)));
  }
  // A closed ring welds its last station onto its first, so it needs no caps; an arc's two
  // caps ARE the vertical walls that make a gap read black from overhead.
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
 * the two bishops from 0.62 apart to 0.92 — the device was carrying MORE per-instance
 * noise than shape.
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
  // Never stand the collar on the figure's own ankle: clear the median footprint of
  // everything in the band just above the plinth top, then take as much width as the type
  // allows. The bishop and the king get a broad pale plate; the rook gets a narrow band,
  // because a rook's turret leaves nothing else.
  const rIn = Math.max(
    Math.min(medianFoot(fit.foot) + 0.06, rOut - 0.22),
    rOut - spec.maxWidth,
  );

  const part = new Part();
  part.detail = detail;
  if (spec.gaps === 0) {
    // A closed ring: one loft all the way round with no caps and the last station welded
    // onto the first.
    arc(part, 0, TAU, rIn, rOut, fit.top, spec.h, true);
  } else {
    const step = TAU / spec.gaps;
    const half = spec.gapW * DEG * 0.5;
    for (let i = 0; i < spec.gaps; i++) {
      const g = spec.phase * DEG + i * step;
      arc(part, g + half, g + step - half, rIn, rOut, fit.top, spec.h, false);
    }
    // Two thin unbroken kerbs, one at each edge of the collar, standing to the same height
    // as the arcs. They turn the gaps between the arcs from open crenels into ENCLOSED
    // POCKETS, and that is the whole point of them.
    //
    // An open crenel is dark on the side the fire is not on and pale on the side it is:
    // its floor sees the room. A pocket walled on all four sides sees almost nothing but
    // its own walls, so it reads black from overhead WHEREVER the piece stands and
    // whichever way the flames happen to fall. That matters more than it sounds: the two
    // men of a type stand at mirrored files, so anything whose brightness depends on the
    // direction of the light is rendered differently on the two of them and pushes them
    // apart. Occlusion does not care about direction.
    const kerb = Math.min(0.075, (rOut - rIn) * 0.24);
    arc(part, 0, TAU, rOut - kerb, rOut, fit.top, spec.h, true);
    arc(part, 0, TAU, rIn, rIn + kerb, fit.top, spec.h, true);
  }
  if (part.idx.length === 0) return null;

  const weather = makeWeather(stone, rng.fork(`device-stone:${side}:${type}`), 1);
  const m: CMesh = part.mesh();
  orientOutward(m);
  const ref = subdivide(m, Math.max(0.13, detail * 0.7));
  const disp = displaceMesh(ref, analyse(ref), weather.displace);
  return toGeometry(ref, disp, weather.shade, analyse(ref));
}

