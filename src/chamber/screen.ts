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
 * Three screens:
 *
 *   side   — the two great leaning screens at |z| = SIDE_Z, flanking the board's long
 *            kerbs. These are the shot. They crowd the ranks and close the frame.
 *   far    — a vertical screen of the same shafts across the end wall, behind the heap
 *            of accumulated rubble, so the far end of the room is stone too.
 *   web    — a plain dark surface a hand's breadth behind each screen, so the gap
 *            between two shafts reads as a deep groove and never as a hole.
 *
 * The north screen carries a clear central bay. The great portal is on that wall and a
 * shot looking down the room at it has to see it; the bay is wide enough to pass the
 * whole portal and is backed by the wall's own shafts, so from the wide shot it reads
 * as another depth of architecture rather than as a gap.
 */
import * as THREE from 'three';
import { makeFbm, hashString } from '../core/rng';
import { CarvedMesh, sweepShaft, sweepWeb, ringMoulding, type Station, type Tone } from './carved';

/** Long kerb of the board is at 11.54; the screens stand immediately outside it. */
export const SIDE_Z = 13.30;
/**
 * Where the far screen stands. Well clear of the end wall rather than against it: the
 * wall's own engaged piers and capitals project a metre and a half into the room and
 * would otherwise poke through the screen as exactly the coursed rubble blocks this is
 * replacing. It has to stand in front of them, not behind.
 */
export const FAR_X = 13.20;

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

const SIDE_X0 = -17.0;
const SIDE_X1 = 19.6;

/**
 * Clear bay on the north screen, so the great portal on that wall is not curtained off.
 *
 * Its position is not free. `wide-establishing` looks down the room past this screen and
 * any gap in it is a hole straight out of the enclosure — the exact failure this screen
 * exists to fix. But `knight-looking-up` looks square at the portal and has to see it.
 * The two are only compatible in one place: far enough along the screen that the wide
 * shot's frame edge has already cut it off, while still well inside the near shot's much
 * wider field. That is here, and the portal itself is moved along the wall to match.
 */
export const BAY_X0 = -14.20;
export const BAY_X1 = -4.90;
/** Where the portal has to stand to sit behind that bay. */
export const PORTAL_X = (BAY_X0 + BAY_X1) / 2;

const FAR_Z0 = -14.6;
const FAR_Z1 = 14.6;

/**
 * Height at which carved stone stops being architecture and becomes darkness.
 *
 * These two numbers are the whole difference between a hall and a lit tunnel, and they
 * are fixed by tracing the establishing frame. The shafts that read as lit stone at the
 * left third are standing at about four metres; the place where the two leaning screens
 * would close over the board and give the room a ceiling is at about seven and a half,
 * and the top of frame is at nine. So the fall starts just above the first and is
 * complete before the last, which keeps the arcade modelled and lets the vault go.
 */
const DARK_START = 4.2;
const DARK_FULL = 9.6;

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Per-vertex tone for carved stone: broad value drift so no two shafts match, soot
 * gathering in the hollows between them, a little grime wicked up off the floor, and
 * the long fall into unresolved dark above the springing.
 */
export function makeCarvedTone(tag: string, seed: number): Tone {
  const s = (hashString(tag) ^ seed) >>> 0;
  const broad = makeFbm(s, 3, 2.03, 0.5);
  const fine = makeFbm((s ^ 0x9e3779b9) >>> 0, 3, 2.17, 0.55);

  return (x, y, z, fold) => {
    let v = 1 + 0.22 * broad(x * 0.075, y * 0.055, z * 0.075) + 0.14 * fine(x * 0.62, y * 0.30, z * 0.62);

    // soot and shadow in the hollow between two shafts — this is where the deep blacks
    // in the outer thirds come from, and it is coarse structure rather than fine noise
    v *= 1 - 0.80 * fold * fold;

    // grime off the floor, and a dry pale bloom out of the plinth
    v *= 1 - 0.22 * smooth(2.4, 0.0, y);
    const bloom = 0.13 * smooth(3.2, 0.7, y) * smooth(0.1, 0.6, fine(x * 0.8, y * 0.9, z * 0.8) + 0.5);

    // the room loses its ceiling
    v *= 1 - 0.985 * smooth(DARK_START, DARK_FULL, y);

    const r = Math.max(0.008, v * 1.010 + bloom * 0.92);
    const g = Math.max(0.008, v * 1.000 + bloom * 0.96);
    const b = Math.max(0.010, v * 1.010 + bloom * 1.00);
    return [r, g, b];
  };
}

/** The path of one shaft of a leaning side screen. */
function sidePath(x: number, z0: number, inward: number, r: number, bendSteps: number): Station[] {
  const st: Station[] = [];
  const at = (y: number, rr: number, dz = 0) => st.push({ x, y, z: z0 + inward * dz, r: rr });

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

/** The path of one shaft of the vertical far screen. */
function farPath(z: number, x0: number, r: number, top: number): Station[] {
  const st: Station[] = [];
  const at = (y: number, rr: number) => st.push({ x: x0, y, z, r: rr });
  at(0.00, r * 1.66);
  at(0.18, r * 1.60);
  at(0.36, r * 1.28);
  at(0.54, r * 1.36);
  at(0.72, r * 1.10);
  at(1.00, r * 1.00);
  at(4.60, r);
  at(5.28, r * 1.22);
  at(5.52, r * 1.22);
  at(6.00, r);
  at(top, r * 0.94);
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
  sign: 1 | -1, hi: boolean, tone: Tone, bay: boolean,
): ScreenBuild {
  const m = new CarvedMesh();
  const z0 = sign * SIDE_Z;
  const inward = -sign;          // toward the board
  const radial = hi ? 11 : 7;
  const bendSteps = hi ? 6 : 4;
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
      sweepShaft(m, sidePath(x, zz, inward, r, bendSteps), 0, inward, radial, arc, tone);
    }
  }

  // The web, set back behind the shaft axes so each shaft reads as three-quarters round
  // with a real hollow beside it. Split at the bay so the portal is not curtained off.
  const webPath = sidePath(0, z0 - inward * WEB_BACK, inward, 0, bendSteps)
    .map((s) => ({ x: 0, y: s.y, z: s.z }));
  for (const [a, b] of spans) {
    sweepWeb(m, webPath, 1, 0, a - PITCH * 0.6, b + PITCH * 0.6,
      0, inward, (x, y, z) => {
        const [r, g, bb] = tone(x, y, z, 1);
        return [r * 0.40, g * 0.40, bb * 0.42];
      });
  }

  return { geometry: m.build(), triangles: m.triangles };
}

/** The vertical screen across the end wall, behind the heap. */
export function buildFarScreen(hi: boolean, baseTone: Tone): ScreenBuild {
  const m = new CarvedMesh();
  // The far end stands behind the heap, at the bottom of the room's air, and it has to
  // be dark. It is also close enough to the kerb fires that at full albedo it took four
  // times the irradiance of the side screens, went to a pale even curtain, and bloomed
  // hard enough to lift the black floor of the whole frame — the render lost every pixel
  // below four percent. Cutting it here is what gives the room its blacks back.
  const tone: Tone = (x, y, z, fold) => {
    const [r, g, b] = baseTone(x, y, z, fold * 1.15);
    return [r * 0.26, g * 0.26, b * 0.28];
  };
  const radial = hi ? 11 : 7;
  const arc = Math.PI * 1.80;
  // Runs past the point it goes black, so no lit block of the wall behind ever shows
  // over the head of the screen.
  const top = 16.6;

  const n = Math.floor((FAR_Z1 - FAR_Z0) / PITCH);
  for (let k = 0; k <= n; k++) {
    const z = FAR_Z0 + k * PITCH;
    const major = k % MAJOR_EVERY === 0;
    const r = major ? R_MAJOR : R_MINOR;
    const x = FAR_X - (major ? 0.16 : 0);
    sweepShaft(m, farPath(z, x, r, top), -1, 0, radial, arc, tone);
  }

  const webPath = [{ x: FAR_X + WEB_BACK, y: -0.4, z: 0 }, { x: FAR_X + WEB_BACK, y: top, z: 0 }];
  sweepWeb(m, webPath, 0, 1, FAR_Z0 - PITCH * 0.6, FAR_Z1 + PITCH * 0.6, -1, 0,
    (x, y, z) => {
      const [r, g, b] = tone(x, y, z, 1);
      return [r * 0.40, g * 0.40, b * 0.42];
    });

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
  const radial = hi ? 9 : 6;
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
    ringMoulding(m, cx, 5.9, z0, 1.30, 0.16, 0, Math.PI * 2, hi ? 12 : 8, 5,
      (x, y, z) => tone(x, y, z, 0.3));
  }

  return { geometry: m.build(), triangles: m.triangles };
}
