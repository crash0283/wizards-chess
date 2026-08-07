/**
 * PIECE: chamber — the shaft screens that enclose the board.
 *
 * The room the reference shows is not a box with the board sitting in the middle of it.
 * Colossal screens of round stone shafts stand hard against both long kerbs, close
 * enough to camera that they run off the top and the bottom of frame, and they lean
 * INWARD as they rise — they are the springing of a vault, not a flat wall — so the eye
 * following them upward finds no ceiling and no corner, only stone and then darkness.
 * That leaning is measurable in the frame: a shaft at the left third leans about twenty
 * degrees off vertical toward the centre, where a truly vertical one would lean twelve
 * the other way. Everything below is fitted to that.
 *
 * Two screens and a backing:
 *
 *   side   — the two great leaning screens at |z| = SIDE_Z, flanking the board's long
 *            kerbs. These are the shot. They crowd the ranks and close the frame.
 *   web    — a plain dark surface a hand's breadth behind each screen, so the gap
 *            between two shafts reads as a deep groove and never as a hole.
 *
 * There used to be a third, a vertical screen of the same shafts across the end wall.
 * It has gone, and its going is the point. Standing thirteen metres out it resolved,
 * from the establishing camera, into a clean symmetric ring of shafts with crisp bright
 * speculars running down them and one heavy shaft parked all but dead on the board's
 * axis — the brightest architectural element in the frame, announcing exactly where the
 * room ended and, from the pitch of its own repeats, how big it was. The film's far end
 * is a dark unresolvable mass of large irregular slabs. That is what the end wall itself
 * already is, so the end wall does the job now, moved a long way back and cut dark.
 *
 * The north screen carries a clear bay in its shafts where the great portal stands
 * behind it. The web runs across that bay unbroken — see `buildSideScreen`.
 *
 * Each screen is built twice, for the same reason the near piers are: the lean that
 * closes a cinematic frame stands squarely between the play camera, 30 m up, and White's
 * back rank. Pass `guard` and the heads stop at that camera's sight line instead of
 * crossing it. See `playview.ts`.
 */
import * as THREE from 'three';
import { makeFbm, hashString } from '../core/rng';
import { CarvedMesh, sweepShaft, sweepWeb, ringMoulding, type Station, type Tone } from './carved';
import { clearSight } from './playview';
import type { ToneOpts } from './piers';

/** Long kerb of the board is at 11.54; the screens stand immediately outside it. */
export const SIDE_Z = 13.30;

const PITCH = 1.06;
const R_MINOR = 0.435;
const R_MAJOR = 0.62;
/** Every Nth shaft is a heavier one, so the screen has a pier rhythm inside it. */
const MAJOR_EVERY = 5;

/** Where a shaft stops standing up and starts leaning over the board. */
const BEND_Y = 5.60;
const BEND_K = 0.40;
const BEND_E = 1.55;
const BEND_TOP = 12.20;

/**
 * Depth of the web behind a screen, measured from the shaft axes. Deep: a shallow web
 * turns the screen into hanging cloth, because the groove between two shafts never gets
 * dark enough to separate them. This is what makes it read as stone standing in a row.
 */
const WEB_BACK = 0.52;

/** Height at which the web stops and the wall behind starts showing between the shafts. */
const WEB_TOP = 6.30;

const SIDE_X0 = -17.0;
/**
 * The screens now run all the way to the end wall. They have to: the end wall stood at
 * x = 15.5 and has gone back to `EAST_X`, and the long walls did not follow it, so from
 * x = 15.5 onward there is no masonry at |z| = 19 at all. Every camera that could look
 * into that corner looks through these screens first, and this is what guarantees it.
 */
const SIDE_X1 = 21.6;

/**
 * Where the shafts of the north screen stop, leaving a wide recessed bay in front of the
 * great portal on the wall behind. The web still runs across it, so this is a panel and
 * not an opening; the portal's orders read through it as depth rather than as a hole.
 */
export const BAY_X0 = -14.20;
export const BAY_X1 = -4.90;
/** Where the portal has to stand to sit behind that bay. */
export const PORTAL_X = (BAY_X0 + BAY_X1) / 2;

/**
 * Height at which carved stone stops being architecture and becomes darkness.
 *
 * These two numbers are the whole difference between a hall and a lit tunnel. They were
 * fixed by tracing the establishing frame for where a hall would close over, and they were
 * both too low by about two metres — 4.2 / 9.6 put the screens out entirely above the
 * ranks, so the top third of frame had no modelled stone in it whatever and measured
 * 0.0077 of edge energy against the film's 0.0201. The film's top band is not black: it is
 * dim, fully modelled columns with black slots between them, and there is more edge in
 * that than anywhere else in its frame.
 *
 * The screens now stay stone up to where the near piers stand in front of them, which is
 * the point — a near pier is a silhouette and a silhouette needs something behind it.
 */
const DARK_START = 6.0;
const DARK_FULL = 13.2;

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Per-vertex tone for carved stone: broad value drift so no two shafts match, soot
 * gathering in the hollows between them, a little grime wicked up off the floor, and
 * the long fall into unresolved dark above the springing.
 */
export function makeCarvedTone(tag: string, seed: number, opts: ToneOpts = {}): Tone {
  const s = (hashString(tag) ^ seed) >>> 0;
  const broad = makeFbm(s, 3, 2.03, 0.5);
  const fine = makeFbm((s ^ 0x9e3779b9) >>> 0, 3, 2.17, 0.55);
  // See ToneOpts in piers.ts. Both defaults are the film values; the play build turns the
  // fall into darkness off and eases the hollow, because it looks DOWN on the band of
  // shaft that both of those curves exist to hide.
  const fade = opts.fade ?? true;
  const foldCut = opts.foldCut ?? 0.80;

  return (x, y, z, fold) => {
    let v = 1 + 0.22 * broad(x * 0.075, y * 0.055, z * 0.075) + 0.14 * fine(x * 0.62, y * 0.30, z * 0.62);

    // soot and shadow in the hollow between two shafts — this is where the deep blacks
    // in the outer thirds come from, and it is coarse structure rather than fine noise
    v *= 1 - foldCut * fold * fold;

    // grime off the floor, and a dry pale bloom out of the plinth
    v *= 1 - 0.22 * smooth(2.4, 0.0, y);
    const bloom = 0.13 * smooth(3.2, 0.7, y) * smooth(0.1, 0.6, fine(x * 0.8, y * 0.9, z * 0.8) + 0.5);

    // the room loses its ceiling
    if (fade) v *= 1 - 0.985 * smooth(DARK_START, DARK_FULL, y);

    const r = Math.max(0.008, v * 1.010 + bloom * 0.92);
    const g = Math.max(0.008, v * 1.000 + bloom * 0.96);
    const b = Math.max(0.010, v * 1.010 + bloom * 1.00);
    return [r, g, b];
  };
}

/**
 * Radius allowance the WEB is guarded with, so that under the play clamp it still sits
 * behind every shaft by the same margin it does unclamped.
 *
 * A proud major shaft's axis stands at `SIDE_Z - 0.16` and the web at `SIDE_Z + WEB_BACK`,
 * so the web is 0.68 m outboard of that axis and the axis itself is guarded with
 * `R_MAJOR`. Guard the web with the sum and the whole screen shifts as one piece.
 */
const WEB_GUARD_PAD = R_MAJOR + 0.16 + WEB_BACK;

/**
 * The path of one shaft of a leaning side screen.
 *
 * `guard` is the play build: the lean stops where the head would cross the play camera's
 * sight line to the board — see playview.ts. `guardPad` is the radius that has to clear
 * that line; it defaults to the station's own radius, which is what a shaft wants, and is
 * given explicitly for the web, which is a zero-radius path standing behind the shafts.
 */
function sidePath(
  x: number, z0: number, inward: number, r: number, bendSteps: number,
  guard = false, guardPad?: number,
): Station[] {
  const st: Station[] = [];
  const sign = (-inward) as 1 | -1;
  const at = (y: number, rr: number, dz = 0) => {
    const z = z0 + inward * dz;
    // The web is swept along x from a section built at x = 0, so it is guarded there —
    // the most conservative point on its own span, and the only one it can be judged at.
    st.push({ x, y, z: guard ? clearSight(sign, x, y, z, guardPad ?? rr) : z, r: rr });
  };

  // moulded foot: a spreading base, a roll, and the neck above it
  at(0.00, r * 1.66);
  at(0.18, r * 1.60);
  at(0.36, r * 1.28);
  at(0.54, r * 1.36);
  at(0.72, r * 1.10);
  at(1.00, r * 1.00);
  // plain shaft
  at(3.20, r);
  at(4.90, r);
  // annulet where it springs
  at(5.14, r);
  at(5.28, r * 1.24);
  at(5.48, r * 1.24);
  at(BEND_Y, r);
  // and over
  for (let i = 1; i <= bendSteps; i++) {
    const y = BEND_Y + ((BEND_TOP - BEND_Y) * i) / bendSteps;
    at(y, r * (1 - 0.07 * (i / bendSteps)), BEND_K * Math.pow(y - BEND_Y, BEND_E));
  }
  return st;
}

export interface ScreenBuild {
  geometry: THREE.BufferGeometry;
  triangles: number;
}

/**
 * One of the two great leaning screens. `sign` is which side of the board it stands on.
 * `bay` opens a clear span in x — used on the portal wall.
 */
export function buildSideScreen(
  sign: 1 | -1, hi: boolean, tone: Tone, bay: boolean, guard = false,
): ScreenBuild {
  const m = new CarvedMesh();
  const z0 = sign * SIDE_Z;
  const inward = -sign;          // toward the board
  // The PITCH does not change between tiers and neither does the span: the rhythm of the
  // screen, its major-shaft beat and where it stops are the look, and thinning them would
  // change the room's character rather than its density. What changes is how finely each
  // shaft is swept — six facets over 1.80 pi and three steps through the bend, on a shaft
  // whose analytic normals mean facet count only ever shows in silhouette.
  const radial = hi ? 11 : 6;
  const bendSteps = hi ? 6 : 3;
  // Wide enough that both flanks of every shaft run past the web behind it. Normals are
  // analytic, so eleven facets on a shaft this size are smooth to well under a pixel.
  const arc = Math.PI * 1.80;

  const spans: [number, number][] = bay
    ? [[SIDE_X0, BAY_X0], [BAY_X1, SIDE_X1]]
    : [[SIDE_X0, SIDE_X1]];

  for (const [a, b] of spans) {
    // Walk a common lattice so the major shafts stay in step across a bay.
    const k0 = Math.ceil((a - SIDE_X0) / PITCH);
    const k1 = Math.floor((b - SIDE_X0) / PITCH);
    for (let k = k0; k <= k1; k++) {
      const x = SIDE_X0 + k * PITCH;
      const major = k % MAJOR_EVERY === 0;
      const r = major ? R_MAJOR : R_MINOR;
      // heavier shafts stand a little proud of the screen
      const zz = z0 + inward * (major ? 0.16 : 0);
      sweepShaft(m, sidePath(x, zz, inward, r, bendSteps, guard), 0, inward, radial, arc, tone);
    }
  }

  // The web, set back behind the shaft axes so each shaft reads as three-quarters round
  // with a real hollow beside it.
  //
  // It runs UNBROKEN, including across the bay, and that is a correction. Splitting it at
  // the bay left a clear hole through the screen, and `wide-establishing` — which sits
  // eight metres beyond the west wall and looks along the room — caught the far corner of
  // that hole at the extreme left of frame: a hard faceted silhouette with lit ashlar and
  // an engaged pier of the north wall showing beyond it, on one side of the frame only.
  // The bay was placed on the assumption that the wide shot's frame edge had already cut
  // it off; traced properly, the frame edge crosses the screen plane at x = -6.2 and the
  // bay ends at -4.9, so it never had. The shafts still stop at the bay — it is a real
  // recessed panel in the screen, and the portal behind it still stands — but the screen
  // is now a surface with a bay cut into it rather than a curtain with a hole through it.
  //
  // And it STOPS at the springing, everywhere except across the bay. That is the single
  // change that put light into the top of this frame, and it came out of reading the
  // lighting piece rather than the reference: the rig hangs three sources per side aimed
  // squarely at the long walls at |z| = 18.4 to 19.6, between four and ten metres up,
  // precisely to model the piers there — and this web was standing five metres in front of
  // them, opaque, from floor to vault. Every one of those lights was landing on masonry no
  // camera could see, while the face of the screen turned toward the lens got the spill.
  // Above the springing the gaps between shafts now show that lit wall, and the screen
  // reads as a colonnade standing against a modelled surface instead of a black curtain:
  // thin bright slots between dark leaning shafts, which is edge energy exactly where the
  // frame had none. Below the springing it stays solid, because there the thing behind it
  // is the bare foot of the wall and the eye would find the corner of the room.
  const webPath = sidePath(0, z0 - inward * WEB_BACK, inward, 0, bendSteps, guard, WEB_GUARD_PAD)
    .map((s) => ({ x: 0, y: s.y, z: s.z }));
  const webTone = (x: number, y: number, z: number): [number, number, number] => {
    const [r, g, bb] = tone(x, y, z, 1);
    return [r * 0.40, g * 0.40, bb * 0.42];
  };
  const lower = webPath.filter((s) => s.y <= WEB_TOP);
  if (lower.length && lower[lower.length - 1].y < WEB_TOP) {
    const a = lower[lower.length - 1];
    const b = webPath[lower.length];
    const t = (WEB_TOP - a.y) / (b.y - a.y);
    lower.push({ x: 0, y: WEB_TOP, z: a.z + (b.z - a.z) * t });
  }
  const solid: [number, number][] = bay
    ? [[SIDE_X0 - PITCH * 0.6, BAY_X0 + PITCH * 0.6], [BAY_X1 - PITCH * 0.6, SIDE_X1 + PITCH * 0.6]]
    : [[SIDE_X0 - PITCH * 0.6, SIDE_X1 + PITCH * 0.6]];
  for (const [a, b] of solid) sweepWeb(m, lower, 1, 0, a, b, 0, inward, webTone);
  // The bay keeps its web all the way up: it is the one span with no shafts in front of
  // it, so an open head there is a clear hole through the screen — which is exactly the
  // leak `wide-establishing` was catching at the extreme left of frame.
  if (bay) {
    sweepWeb(m, webPath, 1, 0, BAY_X0 - PITCH * 0.6, BAY_X1 + PITCH * 0.6, 0, inward, webTone);
  }

  return { geometry: m.build(), triangles: m.triangles };
}

/**
 * Free-standing shaft clusters set a little behind the side screens and staggered
 * against them, so that anywhere a gap opens between two shafts there is more stone
 * behind it rather than the end of the room.
 */
export function buildBackRow(sign: 1 | -1, hi: boolean, tone: Tone, bay: boolean): ScreenBuild {
  const m = new CarvedMesh();
  const z0 = sign * (SIDE_Z + 3.1);
  const inward = -sign;
  const radial = hi ? 9 : 5;
  const arc = Math.PI * 1.5;

  const clusters: number[] = [];
  for (let x = SIDE_X0 + 2.35; x <= SIDE_X1; x += 4.7) clusters.push(x);

  for (const cx of clusters) {
    if (bay && cx > BAY_X0 - 1.6 && cx < BAY_X1 + 1.6) continue;
    for (const d of [-0.92, 0, 0.92]) {
      const r = d === 0 ? 0.62 : 0.40;
      const st: Station[] = [];
      st.push({ x: cx + d, y: 0.0, z: z0, r: r * 1.6 });
      st.push({ x: cx + d, y: 0.5, z: z0, r: r * 1.3 });
      st.push({ x: cx + d, y: 1.0, z: z0, r });
      st.push({ x: cx + d, y: 6.0, z: z0, r });
      st.push({ x: cx + d, y: 10.5, z: z0, r: r * 0.96 });
      sweepShaft(m, st, 0, inward, radial, arc, tone);
    }
    // The roll at the head of the cluster. It is a full torus — 80 triangles at low — on
    // stone that stands three metres BEHIND the screen and is seen only through the slots
    // between its shafts, at thirty-seven metres. On the low tier the cluster keeps its
    // shafts, which is what the gap-filling is for, and loses the moulding.
    if (hi) {
      ringMoulding(m, cx, 5.9, z0, 1.30, 0.16, 0, Math.PI * 2, 12, 5,
        (x, y, z) => tone(x, y, z, 0.3));
    }
  }

  return { geometry: m.build(), triangles: m.triangles };
}
