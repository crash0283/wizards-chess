/**
 * PIECE: chamber — the near-field piers.
 *
 * The gap this file closes is a compositional one, and it was measurable before it was
 * visible. Everything the room had was BEHIND the ranks: the shaft screens stand at
 * |z| = 13.3, which from the establishing camera only enters frame once the board has
 * receded eight metres, so the outer quarters of that frame were empty black with flames
 * apparently floating in them, and the coarse detail band ran at 57% of the film's while
 * the mid band ran at 155%. That is one fault, not two — a room whose only stone is far
 * away puts all of its edge energy at the wrong scale.
 *
 * So: a short row of COLOSSAL compound piers on each side, standing hard outside the
 * board's kerb, closer to camera than the front ranks and overlapping them. They are cut
 * by the bottom of frame at their feet, run out through the frame edge at their bellies,
 * and — because they lean inward over the board, as the screens do — come back into
 * frame at the top and are cut again by it. Nothing terminates. That is the whole idea:
 * the eye can find neither the foot nor the head of the nearest stone in the room.
 *
 * Three things they are deliberately NOT:
 *
 *  - not a continuation of the side screens. Those are a dense curtain at 1.06 m pitch;
 *    these are five masses at 3 m pitch, three times the girth, with wide dark slots
 *    between them. Different order, different scale, and it is the coarse scale that the
 *    render is short of.
 *  - not vertical. A vertical near pier leaves frame at the side and never comes back,
 *    which reads as a doorframe rather than as a vault springing over the board.
 *  - not lit as foreground. They stand a metre from the kerb fires and would otherwise
 *    take three times the irradiance of anything else in the room and go to a warm wall.
 *    Their tone is cut hard for it, and cut again above the springing.
 *
 * They are culled by the same plane test the walls and screens use — `knight-looking-up`
 * sits five centimetres off the south row's axis and would otherwise be standing inside
 * one.
 */
import * as THREE from 'three';
import { makeFbm, hashString } from '../core/rng';
import { CarvedMesh, sweepShaft, type Station, type Tone } from './carved';

/**
 * Where the piers stand. The board's long kerb is at 11.54 and the widest part of a
 * pier's foot is 1.10, so this is the closest they can come to the board without
 * standing on it — which is the point, because every centimetre outboard of here costs
 * frame coverage at the near end where it is needed most.
 */
export const NEAR_Z = 12.72;

const X0 = -15.55;
const PITCH = 3.02;
const COUNT = 5;
/** The south row is offset along the board so the frame is not a mirror of itself. */
const STAGGER = 0.62;

const R_CORE = 0.66;
const R_FLANK = 0.355;
const FLANK_DX = 0.86;

/**
 * The lean. Gentler than the screens' (0.40 / 1.55): these stand four metres nearer the
 * camera, so the same curve would sweep them clean across the board before they reached
 * the top of frame. Tuned so a pier based at x = -9 crosses the top of frame at about
 * a quarter of the way in.
 */
const BEND_Y = 5.15;
const BEND_K = 0.285;
const BEND_E = 1.50;
const TOP = 13.8;

/**
 * Above this a pier is a silhouette; above the second it is nothing.
 *
 * Both sit FAR above the screens' 4.2 / 9.6, and they got there by measurement. The
 * establishing frame's top band carries 0.0074 of edge energy against the film's 0.0201,
 * and cropped at 1:1 the two are not close: the film's top-left corner is separated round
 * columns with lit crowns and black slots between them, ours was one even black field.
 * The room does have to lose its ceiling, but a near pier is still architecture at eleven
 * metres — it is only four metres above the ranks in FRAME terms — and blacking it there
 * throws away the only modelled thing in the top third of the picture. The darkness that
 * the top of frame needs comes from the slots between these, not from the piers going out.
 */
const DARK_START = 8.6;
const DARK_FULL = 18.0;

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lean(y: number): number {
  return y <= BEND_Y ? 0 : BEND_K * Math.pow(y - BEND_Y, BEND_E);
}

/**
 * Per-vertex tone for the near piers.
 *
 * A shade ABOVE the screens'. The instinct was the other way — these stand a metre from
 * the kerb fires and ought to be the best-lit stone in the room — but they are not: they
 * lean away over the board, so their modelled faces turn up into the air rather than
 * toward anything that is lit, and at 0.70 of the screens' albedo the whole left third of
 * the frame measured 0.03 to 0.08 against the film's 0.07 to 0.21. Colossal near stone
 * that does not READ is worth nothing at all; it is the same black void with a different
 * silhouette. The one thing kept from that pass is the deep cut in the hollows, which is
 * what separates one pier from the next and is where the frame's true blacks come from.
 */
export function makeNearTone(tag: string, seed: number): Tone {
  const s = (hashString(tag) ^ seed) >>> 0;
  const broad = makeFbm(s, 3, 2.03, 0.5);
  const fine = makeFbm((s ^ 0x27d4eb2f) >>> 0, 3, 2.19, 0.55);

  return (x, y, z, fold) => {
    let v = 1.20 * (1
      + 0.24 * broad(x * 0.070, y * 0.048, z * 0.070)
      + 0.13 * fine(x * 0.55, y * 0.27, z * 0.55));

    // The hollow between two shafts of a cluster, and the wide slot between two piers.
    // Cut harder than anything else in the room: with the fall into dark pushed up out of
    // frame, this is now where every black pixel in the top third comes from.
    v *= 1 - 0.92 * fold * fold;

    // grime off the floor; nothing blooms this close to the fires
    v *= 1 - 0.30 * smooth(2.2, 0.0, y);

    // and the room loses its ceiling
    v *= 1 - 0.988 * smooth(DARK_START, DARK_FULL, y);

    const r = Math.max(0.006, v * 1.010);
    const g = Math.max(0.006, v * 1.000);
    const b = Math.max(0.008, v * 1.020);
    return [r, g, b];
  };
}

/** The path of one shaft of a near pier: moulded foot, plain shaft, annulet, and over. */
function shaftPath(x: number, z0: number, inward: number, r: number, bendSteps: number): Station[] {
  const st: Station[] = [];
  const at = (y: number, rr: number) => st.push({ x, y, z: z0 + inward * lean(y), r: rr });

  at(0.00, r * 1.66);
  at(0.24, r * 1.58);
  at(0.46, r * 1.24);
  at(0.66, r * 1.34);
  at(0.92, r * 1.10);
  at(1.28, r * 1.00);
  // Drum joints. The screens are single carved shafts with no joint anywhere on them and
  // that is right for their girth; a pier this size is not carried up in one piece by
  // anybody, and the horizontal it puts across the shaft every metre and a half is worth
  // more than the purity — it is the only strong horizontal in the top third of frame.
  drum(2.20, r);
  drum(3.55, r);
  at(4.52, r);
  // annulet at the springing
  at(4.74, r);
  at(4.90, r * 1.26);
  at(5.10, r * 1.26);
  at(BEND_Y, r);
  for (let i = 1; i <= bendSteps; i++) {
    const y = BEND_Y + ((TOP - BEND_Y) * i) / bendSteps;
    at(y, r * (1 - 0.08 * (i / bendSteps)));
    if (i < bendSteps) drum(y + (TOP - BEND_Y) / (bendSteps * 2), r * (1 - 0.08 * (i / bendSteps)));
  }
  return st;

  /** A bed joint: a shallow groove with a nose above and below it. */
  function drum(y: number, rr: number) {
    at(y - 0.055, rr);
    at(y - 0.020, rr * 0.945);
    at(y + 0.020, rr * 0.945);
    at(y + 0.055, rr);
  }
}

export interface PierBuild {
  geometry: THREE.BufferGeometry;
  triangles: number;
}

/**
 * One row of near piers. `sign` is which side of the board they stand on; `inward` is
 * therefore -sign, the direction they lean.
 */
export function buildNearPiers(sign: 1 | -1, hi: boolean, tone: Tone): PierBuild {
  const m = new CarvedMesh();
  const z0 = sign * NEAR_Z;
  const inward = -sign;
  const radial = hi ? 13 : 8;
  const bendSteps = hi ? 7 : 4;
  // Three-quarter round, facing the board: the back of a pier standing against a screen
  // is triangles nobody sees from any shot in the film.
  const arc = Math.PI * 1.72;

  for (let k = 0; k < COUNT; k++) {
    const cx = X0 + k * PITCH + (sign > 0 ? STAGGER : 0);
    // A compound pier: one heavy core with a lighter shaft engaged either side of it.
    for (const [dx, r] of [[-FLANK_DX, R_FLANK], [0, R_CORE], [FLANK_DX, R_FLANK]] as const) {
      // The core stands a little proud of its flanks, so the cluster has a section.
      const zz = z0 + inward * (dx === 0 ? 0.20 : 0);
      sweepShaft(m, shaftPath(cx + dx, zz, inward, r, bendSteps), 0, inward, radial, arc, tone);
    }
    // The three are banded together by the annulet cut into each shaft's own profile
    // rather than by a ring round the cluster: a ring wide enough to pass three shafts
    // is 1.3 m in radius, and at this distance from the board it would hang out over the
    // kerb and land in the fires.
  }

  return { geometry: m.build(), triangles: m.triangles };
}
