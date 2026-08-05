/**
 * PIECE: chamber — one wall of the hall.
 *
 * This is the architectural scale: the coarsest of the three. A wall is not a surface
 * with a texture on it, it is a stepped plinth carrying engaged piers, an arcade of
 * deep arched recesses between them, a band of fine blind arcading, a moulded string
 * course, and then coursed masonry losing itself upward into the dark. Every one of
 * those parts is load-bearing in the sense that matters here: take the piers away and
 * the string course has nothing to sit on and it looks wrong immediately.
 *
 * Local frame: x runs along the wall, y is height above the chamber floor, +z points
 * INTO the room. `index.ts` places the group. Everything is built once, at construction.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { InstanceSink } from './sink';
import type { Weather } from './weather';

// --- the section through a wall, in metres ------------------------------------------
export const FACE_Z = 0;
export const FACE_D = 1.02;
export const RECESS_Z = -0.95;
export const RECESS_D = 0.30;
export const BACK_Z = -1.28;

const PLINTH: { v0: number; v1: number; proj: number }[] = [
  { v0: 0.00, v1: 0.42, proj: 0.98 },
  { v0: 0.42, v1: 0.80, proj: 0.62 },
  { v0: 0.80, v1: 1.16, proj: 0.30 },
];
const PIER_PLINTH_EXTRA = [0.62, 0.80, 0.90];

export const PLINTH_TOP = 1.16;
export const CROWN = 6.55;
export const BAND0 = 6.95;
export const BAND1 = 7.70;

const STRING: { v0: number; v1: number; proj: number }[] = [
  { v0: 7.70, v1: 7.92, proj: 0.18 },
  { v0: 7.92, v1: 8.14, proj: 0.40 },
  { v0: 8.14, v1: 8.30, proj: 0.26 },
];
export const STRING_TOP = 8.30;

const PIER_PROJ = 1.26;
const CAPITAL: { v0: number; v1: number; proj: number; grow: number }[] = [
  { v0: 6.95, v1: 7.18, proj: 1.32, grow: 0.14 },
  { v0: 7.18, v1: 7.44, proj: 1.46, grow: 0.34 },
  { v0: 7.44, v1: 7.70, proj: 1.60, grow: 0.54 },
];
const RIB_PROJ = 0.60;

export interface WallSpec {
  id: string;
  /** Local x extent, centred on 0. */
  length: number;
  /** Top of the coursed masonry. */
  height: number;
  /** Local x of each pier centre, ascending, including the two corner piers. */
  pierAt: number[];
  pierWidth: number;
  blindArcade: boolean;
  /** Bay index (into the gaps between piers) that carries the great portal instead. */
  portalBay?: number;
  /** A hole cut clean through the wall (the great portal); masonry stops at its edge. */
  opening?: { centre: number; halfWidthAt(v: number): number };
  /** Fraction of blocks that have fallen out. Scaled by the decay field. */
  ruin: number;
}

export interface WallParts {
  sink: InstanceSink;
  blind: THREE.Matrix4[];
  blindColor: THREE.Color[];
  /** Local x/y where a block has fallen out — scree gathers under these. */
  losses: { u: number; v: number }[];
  /** Bays, so the portal builder knows where it may work. */
  bays: { u0: number; u1: number; index: number }[];
}

type Spans = (v0: number, v1: number) => [number, number][];

const ALL: Spans = () => [[-1e9, 1e9]];

function intersect(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi - lo > 0.06) out.push([lo, hi]);
    }
  }
  return out;
}

/** Remove a centred interval of half-width `hw` from a set of spans. */
function minus(spans: [number, number][], centre: number, hw: number): [number, number][] {
  if (hw <= 0.02) return spans;
  return intersect(spans, [[-1e9, centre - hw], [centre + hw, 1e9]]);
}

/** Half-width of a round-headed opening of radius r springing at `spring`, at height v. */
function openingHalfWidth(r: number, spring: number, v: number): number {
  if (v <= spring) return r;
  const dy = v - spring;
  if (dy >= r) return 0;
  return Math.sqrt(Math.max(0, r * r - dy * dy));
}

export interface FieldOpts {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  faceZ: number;
  depth: number;
  courseH: number;
  blockLen: number;
  occ: number;
  /** How far individual blocks sit proud of / sunk into the nominal plane. */
  relief: number;
  ruin: number;
  spans?: Spans;
  /** Blocks are laid to this joint width; the joint is what reads as recessed mortar. */
  joint?: number;
}

/**
 * Lay coursed masonry over a region. Courses vary in height, blocks vary in length and
 * are staggered course to course, each block sits a little proud of or sunk into the
 * nominal plane and tilts a fraction of a degree — that irregularity is the whole point,
 * and it is why the wall silhouette breaks up instead of ruling a straight line.
 */
export function fillField(
  sink: InstanceSink, rng: Rng, weather: Weather, variants: number, o: FieldOpts,
  losses?: { u: number; v: number }[],
): void {
  const joint = o.joint ?? 0.10;
  const spans = o.spans ?? ALL;
  const col = new THREE.Color();
  let v = o.v0;
  let course = 0;
  while (v < o.v1 - 0.06) {
    const ch = Math.min(o.courseH * rng.float(0.84, 1.18), o.v1 - v);
    if (ch < 0.16) break;
    const allowed = intersect([[o.u0, o.u1]], spans(v, v + ch));
    const stagger = rng.float(0.15, 0.85) * o.blockLen;
    for (const [a, bEnd] of allowed) {
      let u = a;
      // Stagger only when the span is long enough that a short first block is plausible.
      if (bEnd - a > o.blockLen * 1.9) u = a - stagger;
      let guard = 0;
      while (u < bEnd - 0.02 && guard++ < 400) {
        let len = o.blockLen * rng.float(0.62, 1.45);
        let s = Math.max(u, a);
        let e = Math.min(u + len, bEnd);
        u += len;
        if (bEnd - u < o.blockLen * 0.42) {
          e = bEnd; // absorb the runt into this block rather than leaving a sliver
          u = bEnd;
        }
        len = e - s;
        if (len < 0.14) continue;

        const cu = (s + e) * 0.5;
        const cv = v + ch * 0.5;
        const decay = weather.decay(cu, cv);
        const lost = o.ruin > 0 && decay > 1.02 - o.ruin * 1.4 && rng.bool(0.55);
        if (lost) {
          losses?.push({ u: cu, v: v });
          continue;
        }

        const cracked = len > o.blockLen * 0.8 && decay > 0.86 && rng.bool(0.35);
        const dz = rng.float(-0.42, 0.58) * o.relief;
        const rx = rng.float(-0.010, 0.010);
        const ry = rng.float(-0.012, 0.012);
        const rz = rng.float(-0.006, 0.006);
        weather.tone(cu, cv, o.occ, col);

        if (cracked) {
          const split = rng.float(0.35, 0.65);
          const g = 0.03;
          const w1 = len * split - joint * 0.5 - g;
          const w2 = len * (1 - split) - joint * 0.5 - g;
          if (w1 > 0.12 && w2 > 0.12) {
            sink.block(variants + course, s + w1 * 0.5 + joint * 0.25, cv, o.faceZ + dz,
              w1, ch - joint, o.depth, rx, ry, rz, col);
            sink.block(variants + course + 1, e - w2 * 0.5 - joint * 0.25, cv,
              o.faceZ + dz + rng.float(-0.05, 0.05), w2, ch - joint, o.depth,
              rx * 1.4, ry * -1.2, rz, col);
            u = Math.max(u, e);
            continue;
          }
        }

        sink.block(variants + course + (u * 3.1 | 0), cu, cv, o.faceZ + dz,
          len - joint, ch - joint, o.depth, rx, ry, rz, col);
        u = Math.max(u, e);
      }
    }
    v += ch;
    course++;
  }
}

/** A ring of radial voussoirs over a round-headed opening. */
function voussoirs(
  sink: InstanceSink, rng: Rng, weather: Weather, seed: number,
  cx: number, spring: number, r: number, ringDepth: number, faceZ: number, depth: number,
  count: number, occ: number,
) {
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const t0 = (i / count) * Math.PI;
    const t1 = ((i + 1) / count) * Math.PI;
    const tm = (t0 + t1) * 0.5;
    const rm = r + ringDepth * 0.5;
    const x = cx + Math.cos(tm) * rm;
    const y = spring + Math.sin(tm) * rm;
    const tang = (t1 - t0) * rm;
    weather.tone(x, y, occ, col);
    // block +y maps to the radial direction when rotated by (theta - 90 degrees)
    sink.block(seed + i, x, y, faceZ + rng.float(0.0, 0.09),
      tang - 0.08, ringDepth - 0.08, depth,
      0, 0, tm - Math.PI / 2, col);
  }
  // keystone, a touch prouder and taller
  weather.tone(cx, spring + r + ringDepth, occ, col);
  sink.block(seed + 91, cx, spring + r + ringDepth * 0.62, faceZ + 0.10,
    ringDepth * 0.95, ringDepth * 1.25, depth + 0.06, 0, 0, 0, col);
}

/** Long moulding blocks running the length of a wall (plinth steps, string courses). */
function band(
  sink: InstanceSink, rng: Rng, weather: Weather, seed: number,
  u0: number, u1: number, v0: number, v1: number, proj: number, occ: number,
  nominal = 1.9,
) {
  const col = new THREE.Color();
  let u = u0;
  let guard = 0;
  while (u < u1 - 0.02 && guard++ < 400) {
    let len = nominal * rng.float(0.7, 1.35);
    let e = Math.min(u + len, u1);
    if (u1 - e < nominal * 0.4) e = u1;
    len = e - u;
    if (len < 0.12) break;
    const cu = (u + e) * 0.5;
    weather.tone(cu, (v0 + v1) * 0.5, occ, col);
    sink.block(seed + (u * 2.7 | 0), cu, (v0 + v1) * 0.5, proj + rng.float(-0.025, 0.025),
      len - 0.09, v1 - v0 - 0.05, proj - BACK_Z,
      rng.float(-0.004, 0.004), rng.float(-0.006, 0.006), 0, col);
    u = e;
  }
}

export function buildWall(
  spec: WallSpec, rng: Rng, weather: Weather, variants: number, quality: 'low' | 'high',
): WallParts {
  const sink = new InstanceSink(variants);
  const losses: { u: number; v: number }[] = [];
  const blind: THREE.Matrix4[] = [];
  const blindColor: THREE.Color[] = [];
  const bays: { u0: number; u1: number; index: number }[] = [];
  const col = new THREE.Color();
  const hi = quality === 'high';
  const sizeK = hi ? 1.0 : 1.34;

  const L = spec.length;
  const uMin = -L / 2;
  const uMax = L / 2;
  const pw = spec.pierWidth;

  // --- stepped plinth, the whole length -------------------------------------------
  for (let i = 0; i < PLINTH.length; i++) {
    const p = PLINTH[i];
    let segs: [number, number][] = [[uMin, uMax]];
    if (spec.opening) segs = minus(segs, spec.opening.centre, spec.opening.halfWidthAt(p.v0));
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 0.3) continue;
      band(sink, rng, weather, 300 + i * 7, s0, s1, p.v0, p.v1, p.proj, 0.16, 2.1 * sizeK);
    }
  }
  // and a heavier footing under every pier, so the pier lands on something
  for (const px of spec.pierAt) {
    for (let i = 0; i < PLINTH.length; i++) {
      const p = PLINTH[i];
      const w = pw + 0.55 - i * 0.12;
      band(sink, rng, weather, 420 + i * 5, px - w / 2, px + w / 2, p.v0, p.v1,
        p.proj + PIER_PLINTH_EXTRA[i], 0.10, 1.5 * sizeK);
    }
  }

  // --- bays ------------------------------------------------------------------------
  for (let b = 0; b < spec.pierAt.length - 1; b++) {
    const left = spec.pierAt[b] + pw / 2;
    const right = spec.pierAt[b + 1] - pw / 2;
    bays.push({ u0: left, u1: right, index: b });
    if (b === spec.portalBay) {
      // portal.ts lays the orders; here we only close the wall around them
      const op = spec.opening;
      fillField(sink, rng, weather, variants, {
        u0: left, u1: right, v0: PLINTH_TOP, v1: STRING_TOP,
        faceZ: FACE_Z, depth: FACE_D,
        courseH: 0.88 * sizeK, blockLen: 1.62 * sizeK,
        occ: 0.10, relief: 0.13, ruin: spec.ruin,
        spans: (v0) => (op ? minus([[-1e9, 1e9]], op.centre, op.halfWidthAt(v0)) : [[-1e9, 1e9]]),
      }, losses);
      continue;
    }

    const clear = right - left;
    const open = clear * 0.84;
    const r = open / 2;
    const spring = CROWN - r;
    const cx = (left + right) * 0.5;
    const ring = 0.62;

    const inside: Spans = (v0) => {
      const hw = openingHalfWidth(r, spring, v0);
      return hw <= 0.05 ? [] : [[cx - hw, cx + hw]];
    };
    const outside: Spans = (v0) => {
      const hw = openingHalfWidth(r, spring, v0);
      if (hw <= 0.05) return [[-1e9, 1e9]];
      return [[-1e9, cx - hw], [cx + hw, 1e9]];
    };

    // the back of the recess, half a metre behind the wall face
    fillField(sink, rng, weather, variants, {
      u0: left, u1: right, v0: PLINTH_TOP, v1: spring + r,
      faceZ: RECESS_Z, depth: RECESS_D,
      courseH: 0.86 * sizeK, blockLen: 1.55 * sizeK,
      occ: 1.0, relief: 0.10, ruin: spec.ruin * 0.6, spans: inside,
    }, losses);

    // the wall face either side of, and above, the opening
    fillField(sink, rng, weather, variants, {
      u0: left, u1: right, v0: PLINTH_TOP, v1: BAND0,
      faceZ: FACE_Z, depth: FACE_D,
      courseH: 0.88 * sizeK, blockLen: 1.62 * sizeK,
      occ: 0.10, relief: 0.19, ruin: spec.ruin, spans: outside,
    }, losses);

    voussoirs(sink, rng, weather, 700 + b * 37, cx, spring, r, ring, FACE_Z, FACE_D + 0.1,
      hi ? 19 : 13, 0.06);
    // a hood mould over the ring: one more order of relief, and the line the damp
    // runs off before it stains the spandrel
    voussoirs(sink, rng, weather, 820 + b * 29, cx, spring, r + ring, 0.24,
      FACE_Z + 0.15, FACE_D + 0.25, hi ? 23 : 15, 0.0);

    // impost blocks where the arch springs
    for (const s of [-1, 1]) {
      weather.tone(cx + s * r, spring, 0.05, col);
      sink.block(760 + b, cx + s * (r + ring * 0.4), spring - 0.11, FACE_Z + 0.09,
        ring * 1.5, 0.22, FACE_D, 0, 0, 0, col);
    }
  }

  // --- blind arcade band + the wall behind it ---------------------------------------
  for (const bay of bays) {
    if (bay.index === spec.portalBay) continue;
    fillField(sink, rng, weather, variants, {
      u0: bay.u0, u1: bay.u1, v0: BAND0, v1: BAND1,
      faceZ: FACE_Z, depth: FACE_D,
      courseH: 0.40 * sizeK, blockLen: 1.0 * sizeK,
      occ: 0.30, relief: 0.06, ruin: 0,
    });
    if (!spec.blindArcade) continue;
    const w = bay.u1 - bay.u0;
    const n = Math.max(3, Math.round(w / (hi ? 0.60 : 0.86)));
    const unit = w / n;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const x = bay.u0 + (i + 0.5) * unit;
      weather.tone(x, BAND0 + 0.4, 0.02, col);
      m.compose(
        new THREE.Vector3(x, BAND0 + 0.06, FACE_Z + 0.02),
        new THREE.Quaternion(),
        new THREE.Vector3(unit, (BAND1 - BAND0) * 0.94, 0.17),
      );
      blind.push(m.clone());
      blindColor.push(col.clone());
    }
  }

  // --- piers -------------------------------------------------------------------------
  for (let i = 0; i < spec.pierAt.length; i++) {
    const px = spec.pierAt[i];
    // shaft, laid in courses of one or two stones
    let v = PLINTH_TOP;
    let c = 0;
    while (v < BAND0 - 0.05) {
      const ch = Math.min(0.78 * sizeK * rng.float(0.86, 1.16), BAND0 - v);
      if (ch < 0.2) break;
      const two = rng.bool(0.68);
      const dz = rng.float(-0.04, 0.05);
      weather.tone(px, v + ch * 0.5, 0.0, col);
      if (two) {
        const cut = rng.float(0.4, 0.6);
        sink.block(900 + i * 13 + c, px - pw / 2 + (pw * cut) / 2, v + ch / 2, PIER_PROJ + dz,
          pw * cut - 0.10, ch - 0.10, PIER_PROJ - BACK_Z, 0, rng.float(-0.008, 0.008), 0, col);
        sink.block(905 + i * 13 + c, px + pw / 2 - (pw * (1 - cut)) / 2, v + ch / 2,
          PIER_PROJ + dz + rng.float(-0.03, 0.03), pw * (1 - cut) - 0.10, ch - 0.10,
          PIER_PROJ - BACK_Z, 0, rng.float(-0.008, 0.008), 0, col);
      } else {
        sink.block(910 + i * 13 + c, px, v + ch / 2, PIER_PROJ + dz,
          pw - 0.10, ch - 0.10, PIER_PROJ - BACK_Z, 0, rng.float(-0.006, 0.006), 0, col);
      }
      v += ch;
      c++;
    }
    // capital: three corbelled courses
    for (let k = 0; k < CAPITAL.length; k++) {
      const cap = CAPITAL[k];
      weather.tone(px, (cap.v0 + cap.v1) * 0.5, 0.0, col);
      sink.block(940 + i * 5 + k, px, (cap.v0 + cap.v1) * 0.5, cap.proj,
        pw + cap.grow, cap.v1 - cap.v0 - 0.03, cap.proj - BACK_Z, 0, 0, 0, col);
    }
    // rib above the string course, running up into the dark
    let rv = STRING_TOP;
    let rc = 0;
    while (rv < spec.height - 0.05) {
      const ch = Math.min(0.82 * sizeK * rng.float(0.9, 1.15), spec.height - rv);
      if (ch < 0.24) break;
      weather.tone(px, rv + ch * 0.5, 0.0, col);
      sink.block(970 + i * 7 + rc, px, rv + ch / 2, RIB_PROJ + rng.float(-0.03, 0.04),
        pw * 0.66 - 0.10, ch - 0.10, RIB_PROJ - BACK_Z, 0, rng.float(-0.006, 0.006), 0, col);
      rv += ch;
      rc++;
    }
  }

  // --- string course ------------------------------------------------------------------
  const stringSpans: [number, number][] =
    spec.portalBay === undefined
      ? [[uMin, uMax]]
      : (() => {
        const bay = bays[spec.portalBay];
        return [[uMin, bay.u0 - 0.6], [bay.u1 + 0.6, uMax]] as [number, number][];
      })();
  for (const [s0, s1] of stringSpans) {
    if (s1 - s0 < 0.5) continue;
    for (let i = 0; i < STRING.length; i++) {
      const st = STRING[i];
      band(sink, rng, weather, 1100 + i * 11, s0, s1, st.v0, st.v1, st.proj, 0.05, 2.0 * sizeK);
    }
  }

  // --- everything above: coursed, and going dark ----------------------------------------
  const ribSpans: Spans = (v0) => {
    let out: [number, number][] = [];
    let prev = uMin;
    for (const px of spec.pierAt) {
      const half = (pw * 0.66) / 2 + 0.04;
      if (px - half > prev) out.push([prev, px - half]);
      prev = px + half;
    }
    if (uMax > prev) out.push([prev, uMax]);
    if (spec.opening) out = minus(out, spec.opening.centre, spec.opening.halfWidthAt(v0));
    return out;
  };
  fillField(sink, rng, weather, variants, {
    u0: uMin, u1: uMax, v0: STRING_TOP, v1: spec.height,
    faceZ: FACE_Z, depth: FACE_D,
    courseH: 1.00 * sizeK, blockLen: 2.05 * sizeK,
    occ: 0.14, relief: 0.17, ruin: spec.ruin * 0.5, spans: ribSpans,
  }, losses);

  return { sink, blind, blindColor, losses, bays };
}
