/**
 * PIECE: pieces — the six carvings.
 *
 * Built against refs/frames/knight-looking-up.webp, and against nothing else. What that
 * frame actually shows, once you stop guessing and look:
 *
 *   pawn    a crouching foot-soldier under a smooth rounded dome helm, head down, both
 *           arms folded forward onto the plinth in front of him, kite shield leaning at
 *           his side. Wider than he is tall. From behind, a row of domed shells.
 *   knight  an armoured rider on a horse: a flat-topped crusader helm with a CROSS-SHAPED
 *           void in the face, a vast chainmail cape falling off the shoulders and over the
 *           horse's rump, the body committed forward, a CURVED sabre out at arm's length.
 *   bishop  a tall standing armoured figure: helm, pauldrons, hands joined at the chest on
 *           a sword carried point-down, a kite shield at the side, armoured legs with a
 *           real gap between them. Narrow.
 *   rook    a castle turret in banded masonry courses: arrow slits, a corbelled machicolation,
 *           crenellations, one merlon long gone.
 *   queen   the standing figure again, taller, under a crowned helm inside a long cape.
 *   king    the same, taller still, the tallest thing on the board, carrying a staff.
 *
 * Three rules the previous round broke and this one does not:
 *
 *   1. NOTHING is a cone. Every figure has a helm narrower than its shoulders, shoulders
 *      wider than its waist, and a gap between its legs. That trio is what makes a
 *      silhouette read as a person rather than as a bollard.
 *   2. The plinth is roughly a third of the object. It is stepped and moulded and carries a
 *      blind arcade of colonnettes and a dentil course — it is architecture, and in the
 *      frame it is a third of every piece's pixels.
 *   3. Capes are chainmail, hooded, deeply folded, and their hems stop clear of the plinth
 *      so the legs beneath them show. A cape that reaches the ground IS a cone.
 *
 * Everything is cut, not revolved: cross-sections are small polygons lofted in stacks and
 * along paths, so every surface is a plane and every silhouette has corners in it.
 *
 * Authored in approximate metres with the base at y = 0; the factory scales the finished
 * carving so the crown lands exactly on PIECE_HEIGHT.
 *
 * Local frame: +Y up, +Z the direction the piece faces, +X the piece's own left.
 */
import * as THREE from 'three';
import type { PieceType } from '../core/constants';
import type { Rng } from '../core/rng';
import { Part, frameRing, loft, ringXZ, slab } from './mesh';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface BreakSite {
  /** A point inside the feature to be broken off. */
  p: THREE.Vector3;
  /** Outward direction of the break; everything past `p` along this axis is lost. */
  n: THREE.Vector3;
  /** How deep behind `p` the plane sits (metres) — larger removes more. */
  depth: number;
}

export interface FormResult {
  body: Part[];
  /** An independently articulated limb/weapon, or null. */
  arm: Part[] | null;
  armPivot: THREE.Vector3;
  /** Where the weapon actually connects, in authored metres. */
  tip: THREE.Vector3;
  /** Approximate centre-of-mass height, authored metres. */
  comY: number;
  /** Candidate places for the one significant, pre-existing break. */
  breaks: BreakSite[];
  /**
   * Height of the plinth's top face, authored metres — the `h` handed to `plinth()`.
   * Only device.ts reads these; they describe geometry that was always here.
   */
  plinthTop: number;
  /** Radius of the plinth's widest course, authored metres — the `r` handed to `plinth()`. */
  plinthR: number;
}

// ---------------------------------------------------------------------------------------
// profile helpers
// ---------------------------------------------------------------------------------------

function jitArr(n: number, rng: Rng, amt: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(1 + rng.float(-amt, amt));
  return a;
}

function ngon(n: number, rx: number, rz: number, rot = 0, jit?: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const k = jit ? jit[i % jit.length] : 1;
    out.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  return out;
}

/** Rectangle with cut corners — the blocky workhorse profile. 8 points. */
function rrect(hw: number, hd: number, cut = 0.34): number[][] {
  const cx = hw * cut, cz = hd * cut;
  return [
    [-hw + cx, -hd], [hw - cx, -hd],
    [hw, -hd + cz], [hw, hd - cz],
    [hw - cx, hd], [-hw + cx, hd],
    [-hw, hd - cz], [-hw, -hd + cz],
  ];
}

/** Asymmetric block section: half-width, forward extent, back extent. 8 points. */
function boxProf(hw: number, up: number, dn: number, cut = 0.34): number[][] {
  const cx = hw * cut, cy = Math.min(up, dn) * cut;
  return [
    [-hw + cx, -dn], [hw - cx, -dn],
    [hw, -dn + cy], [hw, up - cy],
    [hw - cx, up], [-hw + cx, up],
    [-hw, up - cy], [-hw, -dn + cy],
  ];
}

/**
 * A breastplate section: flat-ish across the back, a shallow keel down the front. This is
 * what makes a torso read as armour instead of as a pipe.
 */
function cuirass(hw: number, front: number, back: number): number[][] {
  return [
    [-hw * 0.62, -back], [hw * 0.62, -back],
    [hw, -back * 0.35], [hw * 0.94, front * 0.42],
    [hw * 0.52, front * 0.88], [0, front],
    [-hw * 0.52, front * 0.88], [-hw * 0.94, front * 0.42],
    [-hw, -back * 0.35],
  ];
}

function scaleProf(prof: number[][], sx: number, sz: number, ox = 0, oz = 0): number[][] {
  return prof.map(([x, z]) => [x * sx + ox, z * sz + oz]);
}

interface Station {
  y: number;
  sx: number;
  sz: number;
  ox?: number;
  oz?: number;
}

/** A vertical stack of one profile at varying scale/offset. */
function stack(p: Part, prof: number[][], st: Station[], capA = true, capB = true): void {
  loft(
    p,
    st.map((s) => ringXZ(s.y, scaleProf(prof, s.sx, s.sz, s.ox ?? 0, s.oz ?? 0))),
    capA,
    capB,
  );
}

/** A swept solid along a path; profs[i] is the cross-section at path[i]. */
function tube(
  p: Part,
  path: THREE.Vector3[],
  profs: number[][][],
  up = V(0, 1, 0),
  capA = true,
  capB = true,
): void {
  const rings: THREE.Vector3[][] = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const fwd = tmp.clone().subVectors(b, a);
    if (fwd.lengthSq() < 1e-9) fwd.set(0, 1, 0);
    let u = up;
    if (Math.abs(fwd.clone().normalize().dot(up)) > 0.985) u = V(0, 0, 1);
    rings.push(frameRing(path[i], fwd, u, profs[i]));
  }
  loft(p, rings, capA, capB);
}

/** A faceted dome — helm caps, pauldrons, shield bosses, the pawn's shell back. */
function dome(
  p: Part,
  cx: number, cy: number, cz: number,
  rx: number, rz: number, h: number,
  sides: number, rows: number, rot = 0,
): void {
  const prof = ngon(sides, rx, rz, rot);
  const st: Station[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const s = Math.pow(Math.cos((t * Math.PI) / 2), 0.72);
    st.push({ y: cy + t * h, sx: s, sz: s, ox: cx, oz: cz });
  }
  stack(p, prof, st);
}

function quatFromAxes(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(
    x.clone().normalize(), y.clone().normalize(), z.clone().normalize(),
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Bake a transform into everything this Part has grown since `from`. */
function xform(p: Part, from: number, m: THREE.Matrix4): void {
  const v = new THREE.Vector3();
  for (let i = from; i < p.pos.length; i += 3) {
    v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]).applyMatrix4(m);
    p.pos[i] = v.x; p.pos[i + 1] = v.y; p.pos[i + 2] = v.z;
  }
}

/** A tapering wedge — crown points, ears, merlon spurs, finials. */
function spike(
  p: Part,
  base: THREE.Vector3,
  tip: THREE.Vector3,
  hw: number,
  hd: number,
  lean: THREE.Vector3,
): void {
  const dir = tip.clone().sub(base);
  const path = [
    base.clone(),
    base.clone().addScaledVector(dir, 0.42).addScaledVector(lean, 0.5),
    base.clone().addScaledVector(dir, 0.80).addScaledVector(lean, 1.0),
    base.clone().addScaledVector(dir, 1.0).addScaledVector(lean, 1.15),
  ];
  tube(p, path, [
    rrect(hw, hd, 0.3),
    rrect(hw * 0.66, hd * 0.72, 0.3),
    rrect(hw * 0.30, hd * 0.34, 0.3),
    rrect(hw * 0.07, hd * 0.08, 0.3),
  ]);
}

const lens = (w: number, t: number): number[][] => [
  [-w, 0], [-w * 0.55, -t], [w * 0.55, -t], [w, 0], [w * 0.55, t], [-w * 0.55, t],
];

/** A straight blade: lens section, sharp on both long edges. */
function blade(
  p: Part,
  hilt: THREE.Vector3,
  point: THREE.Vector3,
  width: number,
  thick: number,
): void {
  const path = [
    hilt.clone(),
    hilt.clone().lerp(point, 0.24),
    hilt.clone().lerp(point, 0.58),
    hilt.clone().lerp(point, 0.85),
    point.clone(),
  ];
  p.thinNow = 0.9;
  tube(p, path, [
    lens(width * 0.92, thick),
    lens(width, thick),
    lens(width * 0.88, thick * 0.9),
    lens(width * 0.58, thick * 0.7),
    lens(width * 0.07, thick * 0.2),
  ], V(0, 0, 1));
  p.thinNow = 0;
}

/** A curved blade — the knight's sabre. `bow` bends it away from the chord. */
function curvedBlade(
  p: Part,
  hilt: THREE.Vector3,
  point: THREE.Vector3,
  bow: THREE.Vector3,
  width: number,
  thick: number,
): void {
  const path: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const q = hilt.clone().lerp(point, t);
    q.addScaledVector(bow, Math.sin(t * Math.PI));
    path.push(q);
  }
  p.thinNow = 0.9;
  tube(p, path, [
    lens(width * 0.85, thick),
    lens(width, thick),
    lens(width * 0.98, thick * 0.95),
    lens(width * 0.88, thick * 0.85),
    lens(width * 0.60, thick * 0.60),
    lens(width * 0.06, thick * 0.18),
  ], V(0, 1, 0));
  p.thinNow = 0;
}

/** Grip, crossguard and pommel — the bit that makes a blade read as a *sword*. */
function hilt(
  p: Part,
  grip: THREE.Vector3,
  up: THREE.Vector3,
  across: THREE.Vector3,
  guardHalf: number,
  scale: number,
): void {
  const q = quatFromAxes(
    across.clone().normalize(),
    up.clone().normalize(),
    new THREE.Vector3().crossVectors(across, up).normalize().negate(),
  );
  slab(p, grip.clone(), V(0.055 * scale, 0.13 * scale, 0.048 * scale), q);
  slab(p, grip.clone().addScaledVector(up, -0.14 * scale),
    V(guardHalf, 0.042 * scale, 0.052 * scale), q);
  slab(p, grip.clone().addScaledVector(up, 0.16 * scale),
    V(0.085 * scale, 0.065 * scale, 0.075 * scale), q);
}

// ---------------------------------------------------------------------------------------
// Repeating courses. The one thing the reference frame has that a smooth render never
// does is edges that run in ORIENTED FAMILIES: dentils, bead courses, rows of rivets,
// rows of mail. Isotropic noise at any amplitude is not a substitute — it is the exact
// signature of the thing being wrong. Everything below exists to put repeating relief
// with real shadow lines onto surfaces that were previously unbroken.
// ---------------------------------------------------------------------------------------

/**
 * A course of small proud blocks marching across every flat face of a polygonal solid.
 * Dentils, a bead course, a rivet row, a string of studs on a rim — all the same move,
 * and the cheapest carved incident there is: twelve triangles each, no subdivision, and
 * a hard shadow under every one of them.
 */
function faceCourse(
  p: Part,
  r: number, sides: number, rot: number,
  y: number, n: number, span: number,
  hw: number, hh: number, hd: number,
  tilt = 0,
): void {
  const apo = Math.cos(Math.PI / sides);
  const half = Math.sin(Math.PI / sides);
  const step = (Math.PI * 2) / sides;
  for (let f = 0; f < sides; f++) {
    const a = rot + (f + 0.5) * step;
    const nx = Math.cos(a), nz = Math.sin(a);
    const tx = Math.sin(a), tz = -Math.cos(a);
    const q = quatFromAxes(V(tx, 0, tz), V(0, 1, 0), V(nx, 0, nz));
    if (tilt !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt));
    for (let k = 0; k < n; k++) {
      const off = (n === 1 ? 0 : k / (n - 1) - 0.5) * span * r * half;
      slab(p, V(nx * r * apo + tx * off, y, nz * r * apo + tz * off), V(hw, hh, hd), q);
    }
  }
}

/**
 * A ring of rivet heads around a helm brim or a shield rim: proud studs on a circle,
 * each one squared to the surface it sits on. Nine of these on a helm is the difference
 * between a riveted iron pot and a thumb-smoothed lump of clay.
 */
function rivetRing(
  p: Part,
  cx: number, cy: number, cz: number,
  rad: number, n: number, size: number, rise: number, rot = 0,
): void {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const nx = Math.cos(a), nz = Math.sin(a);
    const q = quatFromAxes(V(-nz, 0, nx), V(0, 1, 0), V(nx, 0, nz));
    slab(p, V(cx + nx * rad, cy, cz + nz * rad), V(size, size * 0.86, rise), q);
  }
}

// ---------------------------------------------------------------------------------------
// The plinth. Hexagonal, stepped, moulded, and carrying a blind arcade — in the reference
// frame it is a full third of every piece, and it is the most obviously *carved* thing
// on the board. It is not a disc and it is not a footnote.
// ---------------------------------------------------------------------------------------

function plinth(p: Part, r: number, h: number, sides: number, rng: Rng, cols: number): void {
  const rot = Math.PI / sides + rng.float(-0.04, 0.04);
  const jit = jitArr(sides, rng, 0.008);
  const prof = ngon(sides, r, r, rot, jit);
  const S = (t: number, s: number): Station => ({ y: t * h, sx: s, sz: s });
  // bottom step - chamfer - fillet - cavetto - DIE - astragal - cornice - top plate
  stack(p, prof, [
    S(0.000, 0.988), S(0.070, 1.000), S(0.145, 0.996),
    S(0.180, 0.934),
    S(0.200, 0.922), S(0.248, 0.918),
    S(0.276, 0.870),
    S(0.312, 0.846), S(0.638, 0.842),
    S(0.672, 0.880), S(0.706, 0.886),
    S(0.744, 0.858),
    S(0.788, 0.898), S(0.858, 0.910),
    S(0.900, 0.882),
    S(0.944, 0.862), S(1.000, 0.848),
  ]);

  const faceStep = (Math.PI * 2) / sides;
  const apo = Math.cos(Math.PI / sides);
  const half = Math.sin(Math.PI / sides);

  // Blind arcade on the die: shafts with capitals, standing proud of each flat face.
  const dieR = r * 0.844;
  const y0 = h * 0.330, y1 = h * 0.618;
  for (let f = 0; f < sides; f++) {
    const a = rot + (f + 0.5) * faceStep;
    const nx = Math.cos(a), nz = Math.sin(a);
    const tx = Math.sin(a), tz = -Math.cos(a);
    const q = quatFromAxes(V(tx, 0, tz), V(0, 1, 0), V(nx, 0, nz));
    for (let k = 0; k < cols; k++) {
      const u = cols === 1 ? 0 : (k / (cols - 1) - 0.5) * 1.34;
      const off = u * dieR * half;
      const cx = nx * dieR * apo + tx * off;
      const cz = nz * dieR * apo + tz * off;
      const wsh = Math.min(0.088 * r, dieR * half * 0.62 / Math.max(1, cols));
      slab(p, V(cx, (y0 + y1) * 0.5, cz),
        V(wsh, (y1 - y0) * 0.42, 0.052 * r), q);
      // Base and capital, so the shaft is a shaft and not a stripe.
      slab(p, V(cx, y0 + (y1 - y0) * 0.055, cz),
        V(wsh * 1.50, (y1 - y0) * 0.052, 0.062 * r), q);
      slab(p, V(cx, y1 - (y1 - y0) * 0.06, cz),
        V(wsh * 1.45, (y1 - y0) * 0.055, 0.064 * r), q);
      // The arch over the bay: three voussoirs and a keystone standing proud of the
      // spandrel, which is what makes an arcade an arcade instead of a picket fence.
      const archR = Math.min(wsh * 2.3, (dieR * half * 1.34) / Math.max(1, cols) * 0.52);
      for (let vv = 0; vv < 3; vv++) {
        const ang = Math.PI * (0.22 + vv * 0.28);
        const fu = off + Math.cos(ang) * archR;
        const fv = y1 + (y1 - y0) * 0.035 + Math.sin(ang) * archR * 0.68;
        const qq = q.clone().multiply(
          new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), ang - Math.PI / 2),
        );
        slab(
          p,
          V(nx * dieR * apo + tx * fu, fv, nz * dieR * apo + tz * fu),
          V(wsh * 0.62, wsh * 0.50, 0.048 * r),
          qq,
        );
      }
    }
  }

  // Dentil course under the cornice — small square blocks, twice the arcade's density.
  faceCourse(p, r * 0.888, sides, rot, h * 0.822, cols + 4, 1.58,
    0.038 * r, h * 0.032, 0.042 * r);
  // Bead course on the fillet below the die: a run of small studs, tighter still. Three
  // courses at three densities on one plinth is what "carved" looks like from four metres
  // — a single moulding profile does not survive the distance.
  faceCourse(p, r * 0.905, sides, rot, h * 0.291, cols * 2 + 5, 1.62,
    0.026 * r, h * 0.020, 0.030 * r);
  // Chamfer-stop blocks on the bottom step, where the plinth meets the marble.
  faceCourse(p, r * 0.978, sides, rot, h * 0.108, cols + 1, 1.30,
    0.052 * r, h * 0.026, 0.028 * r);
}

// ---------------------------------------------------------------------------------------
// Drapery. A cape is a hollow cone only if you build it as one: this one is pulled tight
// at the front, billows at the back, falls in real alternating folds, and finishes on a
// scalloped hem well above the plinth so what is underneath still reads.
// ---------------------------------------------------------------------------------------

function drape(
  p: Part,
  st: Station[],
  n: number,
  fold: number,
  frontIn: number,
  backOut: number,
  hem: number,
  rng: Rng,
  band = 0,
): void {
  const prof: number[][] = [];
  const ridge: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    // 0 at the front of the piece, 1 directly behind it.
    const k = 0.5 - 0.5 * Math.sin(a);
    const rg = i % 2 === 0 ? 1 : -1;
    const f =
      1 + rg * fold + Math.sin(i * 2.27 + 0.7) * fold * 0.55 + rng.float(-0.014, 0.014);
    const rr = f * (1 - frontIn * (1 - k)) * (1 + backOut * k);
    prof.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    ridge.push(rg > 0 ? 1 : 0);
  }
  const rings = st.map((s) => ringXZ(s.y, scaleProf(prof, s.sx, s.sz, s.ox ?? 0, s.oz ?? 0)));
  // A rolled hem. Cloth that ends on a knife-edge is a sheet of glass; cloth that ends on
  // a thickened, turned-back border has an edge you can see the shadow under, and that
  // border is visible on every cape and tabard in the reference frame.
  if (band > 0) {
    const s = st[st.length - 1];
    rings.push(
      ringXZ(s.y - band * 0.42, scaleProf(prof, s.sx * 1.075, s.sz * 1.075, s.ox ?? 0, s.oz ?? 0)),
    );
    rings.push(
      ringXZ(s.y - band, scaleProf(prof, s.sx * 0.965, s.sz * 0.965, s.ox ?? 0, s.oz ?? 0)),
    );
  }
  if (hem > 0) {
    const last = rings[rings.length - 1];
    for (let i = 0; i < n; i++) {
      last[i].y -= ridge[i] * hem * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.93 + 0.4)));
    }
  }
  loft(p, rings, true, true);
}

/**
 * The cowl over the shoulders. In the frame the dark knight's cape rises into a distinct
 * hood that leans back off the helm — it is the single feature that stops the mass from
 * being a bell, and it is visible from every angle.
 */
function cowl(
  p: Part,
  cy: number, cz: number,
  rx: number, rz: number, h: number,
  lean: number,
  rng: Rng,
): void {
  const n = 12;
  const prof: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const f = 1 + (i % 2 ? -0.055 : 0.055) + rng.float(-0.012, 0.012);
    prof.push([Math.cos(a) * f, Math.sin(a) * f]);
  }
  const st: Station[] = [];
  const rows = 5;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const s = Math.pow(Math.cos((t * Math.PI) / 2), 0.60);
    st.push({ y: cy + t * h, sx: rx * s, sz: rz * s, oz: cz - lean * t * t });
  }
  stack(p, prof, st);
}

// ---------------------------------------------------------------------------------------
// Helms. A helm is narrower than the shoulders under it, has a brim, and has a face.
// ---------------------------------------------------------------------------------------

/**
 * The crusader great-helm the frame puts front and centre: a slightly tapered drum with a
 * rolled brim, a flat crown and a finial. The cross-shaped visor is cut as the GAP between
 * four proud quadrant plates, so it reads as a dark cross at any distance — a modelled
 * groove that shallow would vanish, and a painted one would be a lie.
 */
function helmCross(
  p: Part,
  cx: number, cy: number, cz: number,
  r: number, h: number,
  flat: boolean,
): void {
  const prof = ngon(9, r, r, Math.PI / 9);
  const st: Station[] = [
    { y: cy, sx: 0.88, sz: 0.88, ox: cx, oz: cz },
    { y: cy + h * 0.045, sx: 1.10, sz: 1.10, ox: cx, oz: cz },
    { y: cy + h * 0.125, sx: 1.02, sz: 1.02, ox: cx, oz: cz },
    { y: cy + h * 0.50, sx: 0.99, sz: 0.99, ox: cx, oz: cz },
  ];
  if (flat) {
    st.push(
      { y: cy + h * 0.80, sx: 0.93, sz: 0.93, ox: cx, oz: cz },
      { y: cy + h * 0.90, sx: 0.86, sz: 0.86, ox: cx, oz: cz },
      { y: cy + h * 0.945, sx: 0.70, sz: 0.70, ox: cx, oz: cz },
    );
  } else {
    st.push(
      { y: cy + h * 0.74, sx: 0.72, sz: 0.72, ox: cx, oz: cz },
      { y: cy + h * 0.90, sx: 0.36, sz: 0.36, ox: cx, oz: cz },
      { y: cy + h * 0.965, sx: 0.10, sz: 0.10, ox: cx, oz: cz },
    );
  }
  stack(p, prof, st);

  // A rolled rim around the bottom of the drum — the turned edge of the iron.
  stack(p, prof, [
    { y: cy + h * 0.016, sx: 1.02, sz: 1.02, ox: cx, oz: cz },
    { y: cy + h * 0.058, sx: 1.20, sz: 1.20, ox: cx, oz: cz },
    { y: cy + h * 0.100, sx: 1.03, sz: 1.03, ox: cx, oz: cz },
  ]);

  // The four visor plates. The cross is the cross-shaped void they leave between them.
  const fz = cz + r * 0.90;
  const q = new THREE.Quaternion();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      slab(
        p,
        V(cx + sx * r * 0.335, cy + h * 0.455 + sy * h * 0.125, fz),
        V(r * 0.255, h * 0.088, r * 0.055),
        q,
      );
    }
  }
  // A brow band and a chin band close the face off top and bottom.
  slab(p, V(cx, cy + h * 0.632, fz - r * 0.02), V(r * 0.62, h * 0.038, r * 0.048), q);
  slab(p, V(cx, cy + h * 0.272, fz - r * 0.02), V(r * 0.58, h * 0.036, r * 0.044), q);
  // A brow RIDGE above the brow band: proud, canted, and casting the hard horizontal
  // shadow that tells you a helm has a face under it. Without it the front of the drum
  // is a blank cylinder wall and the cross reads as a decal.
  slab(p, V(cx, cy + h * 0.706, fz - r * 0.06), V(r * 0.70, h * 0.052, r * 0.105),
    new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.30));
  // Rivets: one row holding the rim on, one holding the brow band.
  rivetRing(p, cx, cy + h * 0.058, cz, r * 1.21, 9, r * 0.062, r * 0.052, Math.PI / 9);
  for (const sx of [-1, 1]) {
    slab(p, V(cx + sx * r * 0.60, cy + h * 0.632, fz - r * 0.01),
      V(r * 0.052, h * 0.036, r * 0.052), q);
  }
  // Vertical seam ribs up the crown — the plates the helm is made of, and one more
  // family of oriented edges on what was a smooth drum.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const bx = cx + Math.cos(a) * r * 0.95, bz = cz + Math.sin(a) * r * 0.95;
    slab(
      p,
      V(bx, cy + h * (flat ? 0.52 : 0.46), bz),
      V(r * 0.048, h * (flat ? 0.30 : 0.24), r * 0.058),
      quatFromAxes(V(-Math.sin(a), 0, Math.cos(a)), V(0, 1, 0), V(Math.cos(a), 0, Math.sin(a))),
    );
  }
  if (flat) {
    // Flat-topped great helm: a riveted crown plate with its own rim.
    stack(p, prof, [
      { y: cy + h * 0.868, sx: 0.90, sz: 0.90, ox: cx, oz: cz },
      { y: cy + h * 0.904, sx: 1.00, sz: 1.00, ox: cx, oz: cz },
      { y: cy + h * 0.938, sx: 0.88, sz: 0.88, ox: cx, oz: cz },
    ]);
    rivetRing(p, cx, cy + h * 0.904, cz, r * 1.00, 9, r * 0.050, r * 0.042, Math.PI / 9);
  }
  if (flat) {
    p.thinNow = 0.55;
    spike(p, V(cx, cy + h * 0.94, cz), V(cx, cy + h * 1.30, cz), r * 0.10, r * 0.10, V(0, 0, 0));
    p.thinNow = 0;
  }
}

/** The pawn's helm: a smooth rounded dome with a rolled brim and a stubby nasal. */
function kettleHelm(
  p: Part,
  cx: number, cy: number, cz: number,
  r: number, h: number,
): void {
  stack(p, ngon(9, r, r, Math.PI / 9), [
    { y: cy, sx: 0.84, sz: 0.84, ox: cx, oz: cz },
    { y: cy + h * 0.10, sx: 1.14, sz: 1.14, ox: cx, oz: cz },
    { y: cy + h * 0.23, sx: 1.04, sz: 1.04, ox: cx, oz: cz },
  ]);
  // A rounded skull, not an egg: the frame's pawns wear a low hemisphere with a brim.
  dome(p, cx, cy + h * 0.22, cz, r * 1.03, r * 1.03, h * 0.58, 9, 4, Math.PI / 9);
  // Brow band and nasal — the front has to have a face on it.
  slab(p, V(cx, cy + h * 0.30, cz + r * 1.00), V(r * 0.085, h * 0.30, r * 0.10),
    new THREE.Quaternion());
  slab(p, V(cx, cy + h * 0.19, cz + r * 0.86), V(r * 0.62, h * 0.055, r * 0.30),
    new THREE.Quaternion());
  // A brow RIDGE over the nasal, canted forward, and eye recesses either side of it. Seen
  // from behind — which is how most of the pawns in the frame are seen — the dome carries
  // a medial comb and a riveted brim instead of being one unbroken white shell.
  slab(p, V(cx, cy + h * 0.355, cz + r * 0.90), V(r * 0.60, h * 0.055, r * 0.22),
    new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.34));
  // Medial comb, front to back over the crown.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const zz = cz + (t - 0.5) * r * 1.62;
    const yy = cy + h * (0.24 + 0.56 * Math.cos((t - 0.5) * 2.2));
    slab(p, V(cx, yy, zz), V(r * 0.055, h * 0.075, r * 0.19), new THREE.Quaternion());
  }
  // Rivet row around the brim.
  rivetRing(p, cx, cy + h * 0.105, cz, r * 1.13, 9, r * 0.068, r * 0.055, Math.PI / 9);
}

/** A circlet of points over a helm — the royal crown. */
function crown(
  p: Part,
  cx: number, cy: number, cz: number,
  r: number, top: number, pts: number,
): void {
  stack(p, ngon(9, r, r, Math.PI / 9), [
    { y: cy, sx: 1.00, sz: 1.00, ox: cx, oz: cz },
    { y: cy + (top - cy) * 0.20, sx: 1.10, sz: 1.10, ox: cx, oz: cz },
    { y: cy + (top - cy) * 0.34, sx: 1.05, sz: 1.05, ox: cx, oz: cz },
  ]);
  p.thinNow = 0.7;
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2 + 0.31;
    const bx = cx + Math.cos(a) * r * 1.02;
    const bz = cz + Math.sin(a) * r * 1.02;
    const y = cy + (top - cy) * 0.30;
    spike(p, V(bx, y, bz), V(bx * 1.02, top, bz * 1.02), r * 0.24, r * 0.20, V(0, 0, 0));
  }
  p.thinNow = 0;
}

// ---------------------------------------------------------------------------------------
// Limbs and kit.
// ---------------------------------------------------------------------------------------

/** Sabaton, greave, knee cop, thigh. Built as one swept limb plus a proud knee. */
function armouredLeg(
  p: Part,
  hip: THREE.Vector3,
  knee: THREE.Vector3,
  ankle: THREE.Vector3,
  toe: THREE.Vector3,
  r: number,
): void {
  tube(p, [hip, knee.clone().lerp(hip, 0.30), knee, ankle, toe], [
    rrect(r * 1.12, r * 1.18, 0.34),
    rrect(r * 0.90, r * 0.96, 0.34),
    rrect(r * 0.80, r * 0.88, 0.32),
    rrect(r * 0.60, r * 0.66, 0.32),
    rrect(r * 0.56, r * 0.92, 0.30),
  ], V(1, 0, 0));
  dome(p, knee.x, knee.y - r * 0.34, knee.z + r * 0.62, r * 0.62, r * 0.42, r * 0.70, 6, 3);
}

/** Upper arm, elbow cop, forearm, gauntlet. */
function armTo(
  p: Part,
  shoulder: THREE.Vector3,
  elbow: THREE.Vector3,
  wrist: THREE.Vector3,
  r: number,
): void {
  tube(p, [shoulder, shoulder.clone().lerp(elbow, 0.55), elbow, wrist], [
    rrect(r * 1.10, r * 1.16, 0.34),
    rrect(r * 0.88, r * 0.94, 0.34),
    rrect(r * 0.82, r * 0.88, 0.32),
    rrect(r * 0.68, r * 0.74, 0.32),
  ], V(0, 1, 0));
  slab(p, wrist.clone(), V(r * 0.80, r * 0.72, r * 0.80), new THREE.Quaternion());
}

/**
 * A kite shield: rounded head, straight flanks, a point at the bottom, a raised rim and a
 * boss. Laid out flat then rotated into place — the frame shows every pale piece carrying
 * one and they are half of what reads at the edges of the ranks.
 */
function kiteShield(
  p: Part,
  at: THREE.Vector3,
  q: THREE.Quaternion,
  hw: number,
  up: number,
  dn: number,
  thick: number,
): void {
  const prof: number[][] = [
    [-hw * 0.52, up], [hw * 0.52, up],
    [hw * 0.94, up * 0.62], [hw, up * 0.10],
    [hw * 0.90, -dn * 0.30], [hw * 0.52, -dn * 0.70],
    [0, -dn],
    [-hw * 0.52, -dn * 0.70], [-hw * 0.90, -dn * 0.30],
    [-hw, up * 0.10], [-hw * 0.94, up * 0.62],
  ];
  const from = p.pos.length;
  p.thinNow = 0.40;
  stack(p, prof, [
    { y: -thick, sx: 0.90, sz: 0.90 },
    { y: -thick * 0.35, sx: 0.985, sz: 0.985 },
    { y: thick * 0.30, sx: 1.0, sz: 1.0 },
    { y: thick, sx: 0.90, sz: 0.90 },
  ]);
  p.thinNow = 0;
  // A RAISED RIM standing proud of the face all the way round the outline — a shield's
  // most identifiable feature after its shape, and the reason a shield in the frame has a
  // bright line around a shadowed field instead of being one flat lozenge. Built as a
  // genuine ANNULUS — a closed rectangular-section ring, not a bigger plate laid on top,
  // which would simply bury the field, the boss and the device under itself.
  {
    const ry0 = thick * 0.20, ry1 = thick * 1.62;
    const ro = 1.075, ri = 0.855;
    const r0 = ringXZ(ry0, scaleProf(prof, ro, ro));
    const r1 = ringXZ(ry1, scaleProf(prof, ro, ro));
    const r2 = ringXZ(ry1, scaleProf(prof, ri, ri));
    const r3 = ringXZ(ry0, scaleProf(prof, ri, ri));
    loft(p, [r0, r1, r2, r3, r0.map((v) => v.clone())], false, false);
  }
  // Rivets through the rim, at every corner of the outline.
  for (let i = 0; i < prof.length; i++) {
    const [px, pz] = prof[i];
    slab(p, V(px * 0.985, thick * 1.58, pz * 0.985),
      V(hw * 0.052, thick * 0.40, hw * 0.052), new THREE.Quaternion());
  }
  // Boss with its own rim, and a cross device on the face.
  dome(p, 0, thick * 0.6, up * 0.10, hw * 0.20, hw * 0.20, hw * 0.24, 7, 3);
  stack(p, ngon(9, hw * 0.28, hw * 0.28, Math.PI / 9), [
    { y: thick * 0.55, sx: 1.0, sz: 1.0, oz: up * 0.10 },
    { y: thick * 1.10, sx: 0.94, sz: 0.94, oz: up * 0.10 },
  ]);
  slab(p, V(0, thick * 0.95, up * 0.10), V(hw * 0.86, thick * 0.34, up * 0.11),
    new THREE.Quaternion());
  slab(p, V(0, thick * 0.95, (up - dn) * 0.08), V(up * 0.10, thick * 0.34, (up + dn) * 0.40),
    new THREE.Quaternion());
  xform(p, from, new THREE.Matrix4().compose(at, q, V(1, 1, 1)));
}

// ---------------------------------------------------------------------------------------
// PAWN — a crouching foot-soldier: dome helm, head down, arms folded onto the plinth.
// ---------------------------------------------------------------------------------------

function pawn(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const PH = 0.72;
  const PR = 0.80;

  const base = new Part();
  base.detail = d * 1.15;
  plinth(base, PR, PH, 6, rng, 3);
  body.push(base);

  // The hunched back: a carapace curling from a low, wide rear up over the shoulders and
  // down into a bowed neck. Rounded in section and RIBBED in banded lames, because from
  // behind this shell is the pawn's entire silhouette and a smooth box the size of a car
  // bonnet just reads as a boulder that happens to be lit.
  const shell = new Part();
  shell.detail = d * 0.88;
  const carapace = (hw: number, up: number, dn: number, k: number): number[][] => {
    const out: number[][] = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const c = Math.cos(a), sn = Math.sin(a);
      out.push([c * hw * k, sn * (sn > 0 ? up : dn) * k]);
    }
    return out;
  };
  {
    const spine: THREE.Vector3[] = [];
    const profs: number[][][] = [];
    const key = [
      [0.12, -0.50, 0.24, 0.14, 0.12],
      [0.28, -0.44, 0.33, 0.19, 0.19],
      [0.42, -0.30, 0.36, 0.21, 0.24],
      [0.52, -0.10, 0.35, 0.20, 0.25],
      [0.55, 0.08, 0.31, 0.17, 0.23],
      [0.50, 0.22, 0.25, 0.13, 0.19],
      [0.42, 0.32, 0.19, 0.10, 0.15],
    ];
    for (let i = 0; i < key.length; i++) {
      const [y, z, hw, up, dn] = key[i];
      // Alternating collar scale turns the sweep into banded lames for free. Pushed hard
      // enough that each lame throws a real shadow onto the one below: from behind, this
      // shell IS the pawn, and a smooth one reads as a boulder.
      const k = i % 2 === 0 ? 1.0 : 1.135;
      spine.push(V(0, PH + y, z));
      profs.push(carapace(hw, up, dn, k));
    }
    tube(shell, spine, profs, V(0, 1, 0));
  }
  // Pauldrons. These are the widest thing about him and they must stand OUTSIDE the back,
  // not inside it: shoulder lobes either side of a spine is what separates a crouching man
  // from a snail shell, and at this distance it is the whole read.
  for (const s of [-1, 1]) {
    dome(shell, 0.36 * s, PH + 0.40, 0.02, 0.22, 0.26, 0.24, 7, 3);
    dome(shell, 0.30 * s, PH + 0.34, 0.22, 0.16, 0.19, 0.18, 6, 3);
  }
  body.push(shell);

  // The helm rides forward of the spine and above it. If it sits inside the back's envelope
  // the two masses fuse and the piece stops being a figure at all — which is exactly what
  // the round-1 carving did.
  const helm = new Part();
  helm.detail = d * 0.58;
  kettleHelm(helm, 0, PH + 0.46, 0.42, 0.250, 0.52);
  // Bowed neck joining the helm back to the spine.
  tube(helm, [V(0, PH + 0.54, 0.10), V(0, PH + 0.52, 0.26), V(0, PH + 0.48, 0.38)], [
    rrect(0.15, 0.13, 0.34), rrect(0.14, 0.12, 0.34), rrect(0.13, 0.12, 0.34),
  ], V(0, 1, 0));
  body.push(helm);

  // Both arms fold forward and down onto the plinth in front of him — that low, braced
  // triangle under the dome is the pawn's whole silhouette.
  const arms = new Part();
  arms.detail = d * 0.66;
  for (const s of [-1, 1]) {
    armTo(
      arms,
      V(0.36 * s, PH + 0.40, 0.06),
      V(0.42 * s, PH + 0.20, 0.36),
      V(0.28 * s, PH + 0.05, 0.58),
      0.110,
    );
  }
  slab(arms, V(0, PH + 0.04, 0.62), V(0.26, 0.080, 0.115), new THREE.Quaternion());
  body.push(arms);

  // Legs tucked under: one knee down, one foot planted.
  const legs = new Part();
  legs.detail = d * 0.76;
  armouredLeg(
    legs,
    V(0.26, PH + 0.24, -0.30), V(0.30, PH + 0.08, 0.06),
    V(0.30, PH + 0.02, 0.24), V(0.29, PH + 0.02, -0.16), 0.125,
  );
  armouredLeg(
    legs,
    V(-0.26, PH + 0.28, -0.24), V(-0.32, PH + 0.14, 0.20),
    V(-0.32, PH + 0.03, 0.42), V(-0.32, PH + 0.02, 0.58), 0.125,
  );
  body.push(legs);

  // Shield leaning on his left, tilted back against the shoulder.
  const shield = new Part();
  shield.detail = d * 0.66;
  kiteShield(
    shield,
    V(-0.54, PH + 0.28, 0.18),
    quatFromAxes(V(0.94, 0, 0.34), V(-0.31, 0.30, 0.90), V(0.10, 0.95, -0.28)),
    0.30, 0.36, 0.54, 0.055,
  );
  body.push(shield);

  // Short blade held upright against the right shoulder.
  const arm = new Part();
  arm.detail = d * 0.66;
  armTo(arm, V(0.40, PH + 0.40, -0.08), V(0.46, PH + 0.28, 0.16), V(0.40, PH + 0.24, 0.40), 0.10);
  hilt(arm, V(0.40, PH + 0.32, 0.44), V(0.02, 1, 0.10), V(1, 0, 0), 0.15, 0.85);
  blade(arm, V(0.40, PH + 0.42, 0.46), V(0.34, PH + 1.16, 0.60), 0.085, 0.028);

  return {
    body,
    plinthTop: PH,
    plinthR: PR,
    arm: [arm],
    armPivot: V(0.40, PH + 0.42, -0.08),
    tip: V(0.34, PH + 1.16, 0.60),
    comY: PH * 0.62 + 0.20,
    breaks: [
      { p: V(0, PH + 0.86, 0.44), n: V(0.28, 0.88, 0.40).normalize(), depth: 0.05 },
      { p: V(0.54, PH + 0.42, 0.02), n: V(0.92, 0.30, -0.24).normalize(), depth: 0.07 },
      { p: V(-0.62, PH + 0.48, 0.24), n: V(-0.86, 0.42, 0.28).normalize(), depth: 0.06 },
      { p: V(-0.66, 0.10, -0.28), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.09 },
      { p: V(0.64, 0.12, 0.32), n: V(0.82, -0.32, 0.47).normalize(), depth: 0.08 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// KNIGHT — an armoured rider on a horse. The judged carving.
// ---------------------------------------------------------------------------------------

function knight(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const PH = 1.10;
  const PR = 1.36;

  const base = new Part();
  base.detail = d * 1.15;
  plinth(base, PR, PH, 6, rng, 3);
  body.push(base);

  // --- the horse ------------------------------------------------------------------
  const horse = new Part();
  horse.detail = d * 0.78;
  const barrelY = PH + 1.08;
  tube(horse, [
    V(0, barrelY + 0.02, 0.70),
    V(0, barrelY, 0.32),
    V(0, barrelY + 0.02, -0.10),
    V(0, barrelY + 0.04, -0.48),
    V(0, barrelY + 0.02, -0.74),
  ], [
    boxProf(0.29, 0.28, 0.34, 0.40),
    boxProf(0.34, 0.32, 0.42, 0.40),
    boxProf(0.33, 0.32, 0.40, 0.40),
    boxProf(0.32, 0.30, 0.38, 0.40),
    boxProf(0.26, 0.23, 0.29, 0.40),
  ], V(0, 1, 0));

  // Neck out of the withers, turning progressively so the head reads in profile.
  const headYaw = rng.float(-0.54, -0.32);
  const spine: THREE.Vector3[] = [];
  const necks: number[][][] = [];
  const nsteps = 5;
  const pivotZ = 0.62;
  for (let i = 0; i <= nsteps; i++) {
    const t = i / nsteps;
    const y = barrelY + 0.16 + t * 0.74;
    const z = 0.62 + t * 0.28 + t * t * 0.18;
    const c = V(0, y, z - pivotZ);
    c.applyAxisAngle(V(0, 1, 0), headYaw * t * t);
    c.z += pivotZ;
    spine.push(c);
    necks.push(boxProf(0.230 - t * 0.072, 0.30 - t * 0.09, 0.27 - t * 0.10, 0.32));
  }
  tube(horse, spine, necks, V(0, 1, 0));
  body.push(horse);

  // --- head ------------------------------------------------------------------------
  const head = new Part();
  head.detail = d * 0.42;
  const poll = spine[nsteps].clone().add(V(0, 0.09, 0.02));
  const nose = poll.clone().add(
    V(Math.sin(headYaw) * 0.64, -0.36, Math.cos(headYaw) * 0.64),
  );
  const hpath = [0, 0.22, 0.46, 0.70, 1].map((t) => {
    const q = poll.clone().lerp(nose, t);
    q.y += Math.sin(t * Math.PI) * 0.035;
    return q;
  });
  tube(head, hpath, [
    boxProf(0.145, 0.14, 0.19, 0.28),
    boxProf(0.162, 0.12, 0.24, 0.28),
    boxProf(0.130, 0.10, 0.17, 0.30),
    boxProf(0.106, 0.08, 0.12, 0.30),
    boxProf(0.090, 0.06, 0.09, 0.30),
  ], V(0, 1, 0));
  // Cheek plate and a chamfron band — armour on the horse, as the frame shows.
  slab(head, hpath[1].clone(), V(0.175, 0.115, 0.135),
    quatFromAxes(V(Math.cos(headYaw), 0, -Math.sin(headYaw)), V(0, 1, 0),
      V(Math.sin(headYaw), 0, Math.cos(headYaw))));
  head.thinNow = 1.0;
  for (const s of [-1, 1]) {
    const e = poll.clone().add(V(0.085 * s, -0.02, -0.05));
    spike(head, e, e.clone().add(V(0.02 * s, 0.25, -0.02)), 0.05, 0.038, V(0.012 * s, 0, 0));
  }
  head.thinNow = 0;
  body.push(head);

  const mane = new Part();
  mane.detail = d * 0.48;
  mane.thinNow = 0.45;
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const si = t * (spine.length - 1);
    const i0 = Math.min(spine.length - 2, Math.floor(si));
    const c = spine[i0].clone().lerp(spine[i0 + 1], si - i0);
    const fwd = spine[i0 + 1].clone().sub(spine[i0]).normalize();
    const right = new THREE.Vector3().crossVectors(V(0, 1, 0), fwd).normalize();
    const up2 = new THREE.Vector3().crossVectors(fwd, right).normalize();
    const crest = 0.30 - (si / (spine.length - 1)) * 0.09;
    const proud = 0.058 + 0.032 * Math.sin(t * 2.4 + 0.4) + rng.float(-0.008, 0.008);
    const centre = c.clone().addScaledVector(up2, crest + proud * 0.4);
    centre.addScaledVector(right, i % 2 ? 0.014 : -0.014);
    const q = quatFromAxes(right, up2, fwd);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rng.float(-0.11, 0.11)));
    slab(mane, centre, V(0.075 - t * 0.018, proud, 0.115 - t * 0.02), q);
  }
  mane.thinNow = 0;
  body.push(mane);

  // --- legs and tail ------------------------------------------------------------------
  const legs = new Part();
  legs.detail = d * 0.56;
  const leg = (pts: THREE.Vector3[], w: number[]) =>
    tube(legs, pts, w.map((k) => rrect(k, k * 1.08, 0.32)), V(1, 0, 0));
  for (const s of [-1, 1]) {
    leg([
      V(0.26 * s, barrelY - 0.10, -0.62),
      V(0.28 * s, barrelY - 0.44, -0.76),
      V(0.28 * s, PH + 0.44, -0.58),
      V(0.28 * s, PH + 0.20, -0.54),
      V(0.28 * s, PH + 0.02, -0.62),
    ], [0.175, 0.132, 0.092, 0.085, 0.122]);
  }
  leg([
    V(-0.26, barrelY - 0.14, 0.54),
    V(-0.28, barrelY - 0.46, 0.62),
    V(-0.29, PH + 0.42, 0.62),
    V(-0.29, PH + 0.18, 0.60),
    V(-0.29, PH + 0.02, 0.68),
  ], [0.165, 0.124, 0.088, 0.083, 0.118]);
  // The near foreleg is up and reaching — the horses in the frame are never at rest.
  leg([
    V(0.26, barrelY - 0.14, 0.58),
    V(0.32, barrelY - 0.36, 0.96),
    V(0.36, PH + 0.66, 1.26),
    V(0.38, PH + 0.38, 1.34),
    V(0.38, PH + 0.14, 1.24),
    V(0.38, PH + 0.02, 1.20),
  ], [0.165, 0.130, 0.100, 0.086, 0.082, 0.118]);
  legs.thinNow = 0.3;
  tube(legs, [
    V(0, barrelY + 0.02, -0.82),
    V(0.04, barrelY - 0.28, -0.96),
    V(0.06, PH + 0.60, -0.94),
    V(0.05, PH + 0.34, -0.82),
  ], [
    rrect(0.10, 0.11, 0.3),
    rrect(0.095, 0.105, 0.3),
    rrect(0.075, 0.085, 0.3),
    rrect(0.045, 0.05, 0.3),
  ], V(1, 0, 0));
  legs.thinNow = 0;
  body.push(legs);

  // --- the rider ----------------------------------------------------------------------
  const seatY = barrelY + 0.30;
  const shoY = seatY + 0.86;
  const rider = new Part();
  rider.detail = d * 0.52;
  // Torso: leaning forward, waisted, and clearly narrower than the shoulders above it.
  tube(rider, [
    V(0, seatY - 0.10, -0.20),
    V(0, seatY + 0.30, -0.14),
    V(0, seatY + 0.62, -0.02),
    V(0, shoY, 0.10),
    V(0, shoY + 0.16, 0.14),
  ], [
    cuirass(0.30, 0.26, 0.28),
    cuirass(0.25, 0.22, 0.24),
    cuirass(0.28, 0.26, 0.24),
    cuirass(0.31, 0.24, 0.24),
    cuirass(0.18, 0.16, 0.16),
  ], V(0, 1, 0));
  // Thighs gripping the barrel, boots down at the flank.
  for (const s of [-1, 1]) {
    armouredLeg(
      rider,
      V(0.24 * s, seatY - 0.06, -0.12),
      V(0.36 * s, seatY - 0.30, 0.26),
      V(0.35 * s, barrelY - 0.42, 0.34),
      V(0.35 * s, barrelY - 0.50, 0.50),
      0.115,
    );
  }
  for (const s of [-1, 1]) dome(rider, 0.30 * s, shoY - 0.06, 0.02, 0.20, 0.24, 0.20, 6, 3);
  // Bridle arm, reaching down and forward to the reins.
  armTo(rider, V(-0.30, shoY - 0.06, 0.06), V(-0.38, shoY - 0.36, 0.30),
    V(-0.32, shoY - 0.58, 0.62), 0.105);
  helmCross(rider, 0, shoY + 0.14, 0.12, 0.215, 0.56, true);
  body.push(rider);

  // Cape: chainmail drapery off the shoulders and over the horse's rump. Hooded, deeply
  // folded, hem scalloped and stopping high enough that the horse still reads under it.
  const cape = new Part();
  cape.detail = d * 0.60;
  cape.thinNow = 0.20;
  cape.mailNow = 1;
  drape(cape, [
    { y: shoY + 0.10, sx: 0.30, sz: 0.28, oz: -0.04 },
    { y: shoY - 0.14, sx: 0.44, sz: 0.40, oz: -0.14 },
    { y: shoY - 0.62, sx: 0.60, sz: 0.52, oz: -0.28 },
    { y: barrelY + 0.10, sx: 0.70, sz: 0.60, oz: -0.36 },
    { y: barrelY - 0.34, sx: 0.72, sz: 0.62, oz: -0.40 },
    { y: barrelY - 0.60, sx: 0.66, sz: 0.57, oz: -0.40 },
  ], 16, 0.160, 0.30, 0.34, 0.20, rng, 0.10);
  cowl(cape, shoY + 0.06, -0.16, 0.34, 0.30, 0.52, 0.30, rng);
  cape.mailNow = 0;
  cape.thinNow = 0;
  body.push(cape);

  // Saddle and caparison over the barrel.
  const tack = new Part();
  tack.detail = d * 0.55;
  stack(tack, rrect(1, 1, 0.30), [
    { y: barrelY + 0.26, sx: 0.34, sz: 0.42, oz: 0.10 },
    { y: barrelY + 0.34, sx: 0.30, sz: 0.40, oz: 0.10 },
  ]);
  for (const s of [-1, 1]) {
    slab(tack, V(0.30 * s, barrelY + 0.24, 0.14), V(0.06, 0.16, 0.30),
      new THREE.Quaternion());
  }
  body.push(tack);

  // Sabre arm: out and forward, the way the frame's rider carries it.
  const arm = new Part();
  arm.detail = d * 0.46;
  armTo(arm, V(0.30, shoY - 0.04, 0.10), V(0.46, shoY - 0.22, 0.44),
    V(0.52, shoY - 0.28, 0.78), 0.105);
  hilt(arm, V(0.52, shoY - 0.22, 0.84), V(0.10, 0.92, 0.38), V(1, 0, -0.1), 0.19, 1.0);
  curvedBlade(
    arm,
    V(0.53, shoY - 0.14, 0.88),
    V(0.62, shoY + 0.44, 1.46),
    V(0.10, 0.20, -0.14),
    0.085, 0.028,
  );

  return {
    body,
    plinthTop: PH,
    plinthR: PR,
    arm: [arm],
    armPivot: V(0.30, shoY - 0.02, 0.10),
    tip: V(0.62, shoY + 0.44, 1.46),
    comY: PH * 0.55 + 0.72,
    breaks: [
      { p: V(0, shoY + 0.74, 0.12), n: V(0.28, 0.90, 0.34).normalize(), depth: 0.06 },
      { p: V(0.36, PH + 0.10, 1.24), n: V(0.44, -0.40, 0.80).normalize(), depth: 0.07 },
      { p: V(-0.05, shoY - 0.40, -0.86), n: V(-0.24, 0.20, -0.95).normalize(), depth: 0.09 },
      { p: V(-1.10, 0.14, -0.44), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.11 },
      { p: V(1.06, 0.14, 0.48), n: V(0.82, -0.32, 0.47).normalize(), depth: 0.10 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// The standing armoured figure — bishop, queen and king are all this, at three sizes.
//
// Proportions come off the two standing pale figures at the centre of the reference frame:
// shoulders about a quarter of the figure's height across, helm about a sixth of it tall,
// hands joined at the chest over a sword carried point-down, and a plain gap between the
// legs that you can see the floor through.
// ---------------------------------------------------------------------------------------

interface StandOpts {
  /** Plinth top. */
  y0: number;
  /** Figure height above the plinth. */
  hf: number;
  /** Lateral scale. */
  w: number;
  /** Cape hem, as a fraction of hf. 0 = no cape. */
  hem: number;
  /** Cape shoulder-to-hem billow. */
  billow: number;
  /** Long robe over the legs instead of bare greaves. */
  robe: boolean;
}

interface StandOut {
  shoulderY: number;
  handY: number;
  handZ: number;
  helmY: number;
  helmR: number;
  helmH: number;
}

function standing(body: Part[], rng: Rng, d: number, o: StandOpts): StandOut {
  const { y0, hf, w } = o;
  const Y = (t: number) => y0 + hf * t;
  const shoulderY = Y(0.780);
  const helmY = Y(0.828);
  const helmH = hf * 0.172;
  const helmR = hf * 0.076 * w;

  // --- legs: two of them, with daylight between --------------------------------------
  const legs = new Part();
  legs.detail = d * 0.58;
  const legR = hf * 0.052 * w;
  for (const s of [-1, 1]) {
    armouredLeg(
      legs,
      V(0.082 * hf * w * s, Y(0.480), -0.01 * hf),
      V(0.086 * hf * w * s, Y(0.260), 0.012 * hf),
      V(0.080 * hf * w * s, Y(0.040), -0.004 * hf),
      V(0.080 * hf * w * s, Y(0.012), 0.075 * hf),
      legR,
    );
  }
  body.push(legs);

  // --- torso: waisted, with a fauld skirt over the hips -------------------------------
  const torso = new Part();
  torso.detail = d * 0.62;
  tube(torso, [
    V(0, Y(0.440), 0),
    V(0, Y(0.530), 0.004 * hf),
    V(0, Y(0.640), 0.010 * hf),
    V(0, Y(0.742), 0.012 * hf),
    V(0, Y(0.800), 0.008 * hf),
  ], [
    cuirass(0.098 * hf * w, 0.070 * hf, 0.066 * hf),
    cuirass(0.082 * hf * w, 0.060 * hf, 0.058 * hf),
    cuirass(0.104 * hf * w, 0.076 * hf, 0.064 * hf),
    cuirass(0.112 * hf * w, 0.072 * hf, 0.062 * hf),
    cuirass(0.062 * hf * w, 0.048 * hf, 0.046 * hf),
  ], V(0, 1, 0));
  // Fauld / hauberk skirt: mail, flaring over the hips and cut off above the knee. It has
  // to stay NARROWER than the shoulders and narrower than the cape, or the figure turns
  // back into a bell from the waist down.
  torso.mailNow = 0.85;
  drape(torso, [
    { y: Y(0.520), sx: 0.088 * hf * w, sz: 0.074 * hf },
    { y: Y(0.440), sx: 0.104 * hf * w, sz: 0.088 * hf },
    { y: Y(o.robe ? 0.180 : 0.330), sx: 0.108 * hf * w, sz: 0.092 * hf },
    { y: Y(o.robe ? 0.026 : 0.300), sx: 0.116 * hf * w, sz: 0.098 * hf },
  ], 14, 0.095, 0.05, 0.06, hf * 0.026, rng, hf * 0.020);
  torso.mailNow = 0;
  // Collar and pauldrons — the shoulders must out-measure everything above them.
  for (const s of [-1, 1]) {
    dome(torso, 0.112 * hf * w * s, shoulderY - 0.030 * hf, 0.004 * hf,
      0.062 * hf * w, 0.068 * hf, 0.058 * hf, 6, 3);
  }
  stack(torso, ngon(8, 0.058 * hf * w, 0.052 * hf, Math.PI / 8), [
    { y: Y(0.790), sx: 1.06, sz: 1.06, oz: 0.008 * hf },
    { y: Y(0.822), sx: 0.96, sz: 0.96, oz: 0.008 * hf },
  ]);
  body.push(torso);

  // --- the tabard ----------------------------------------------------------------------
  //
  // A surcoat hanging over the mail: a flat panel front and back, hem-banded, with an
  // orphrey down the centre. It is the one piece of kit that gives an armoured figure
  // straight vertical CUT EDGES from chest to thigh, and every standing figure in the
  // reference frame has one. Carved as stone, but the cloth is the point: it breaks the
  // torso's smooth shell into panels with shadows between them.
  const tab = new Part();
  tab.detail = d * 0.60;
  // Front only: the cape already owns the whole back of the figure, and a rear panel
  // would be a solid buried inside another one, paying for triangles nothing can see.
  const tabProf = rrect(1, 1, 0.20);
  stack(tab, tabProf, [
    { y: Y(0.700), sx: 0.060 * hf * w, sz: 0.026 * hf, oz: 0.050 * hf },
    { y: Y(0.590), sx: 0.092 * hf * w, sz: 0.036 * hf, oz: 0.062 * hf },
    { y: Y(0.450), sx: 0.110 * hf * w, sz: 0.044 * hf, oz: 0.078 * hf },
    { y: Y(0.348), sx: 0.116 * hf * w, sz: 0.046 * hf, oz: 0.084 * hf },
    { y: Y(0.318), sx: 0.104 * hf * w, sz: 0.038 * hf, oz: 0.084 * hf },
  ]);
  // Hem band and orphrey — the borders are what carry the edge.
  slab(tab, V(0, Y(0.362), 0.090 * hf),
    V(0.120 * hf * w, hf * 0.019, 0.048 * hf), new THREE.Quaternion());
  slab(tab, V(0, Y(0.520), 0.094 * hf),
    V(0.024 * hf * w, hf * 0.155, 0.044 * hf), new THREE.Quaternion());
  body.push(tab);

  // --- arms brought together at the chest ----------------------------------------------
  const arms = new Part();
  arms.detail = d * 0.50;
  const handY = Y(0.600);
  const handZ = 0.128 * hf;
  for (const s of [-1, 1]) {
    armTo(
      arms,
      V(0.108 * hf * w * s, Y(0.762), 0.004 * hf),
      V(0.126 * hf * w * s, Y(0.632), 0.060 * hf),
      V(0.048 * hf * w * s, handY, handZ),
      0.042 * hf * w,
    );
  }
  body.push(arms);

  // --- the sword carried point-down between the hands ----------------------------------
  const sword = new Part();
  sword.detail = d * 0.46;
  hilt(sword, V(0, Y(0.650), handZ + 0.014 * hf), V(0, 1, 0.04), V(1, 0, 0), 0.100 * hf * w, hf * 0.30);
  blade(
    sword,
    V(0, Y(0.596), handZ + 0.020 * hf),
    V(0, Y(o.robe ? 0.150 : 0.118), handZ + 0.034 * hf),
    0.040 * hf * w, 0.013 * hf,
  );
  body.push(sword);

  // --- the cape ------------------------------------------------------------------------
  //
  // A mantle, not a marquee. It is clasped at the throat, hangs off the BACK of the
  // shoulders — the front is pulled hard in so the breastplate, the joined hands and the
  // sword all stay clear of it — and it stops well short of the plinth. Its top edge sits
  // under the pauldrons so the shoulder line survives as a separate, wider mass.
  if (o.hem > 0) {
    const cape = new Part();
    cape.detail = d * 0.62;
    cape.thinNow = 0.18;
    cape.mailNow = 1;
    const b = o.billow;
    drape(cape, [
      { y: Y(0.790), sx: 0.062 * hf * w, sz: 0.058 * hf, oz: -0.024 * hf },
      { y: Y(0.734), sx: 0.116 * hf * w, sz: 0.098 * hf, oz: -0.040 * hf },
      { y: Y(0.600), sx: 0.132 * hf * w * b, sz: 0.108 * hf * b, oz: -0.056 * hf },
      { y: Y(0.420), sx: 0.140 * hf * w * b, sz: 0.114 * hf * b, oz: -0.066 * hf },
      { y: Y(o.hem + 0.070), sx: 0.144 * hf * w * b, sz: 0.117 * hf * b, oz: -0.070 * hf },
      { y: Y(o.hem), sx: 0.128 * hf * w * b, sz: 0.104 * hf * b, oz: -0.070 * hf },
    ], 18, 0.160, 0.48, 0.34, hf * 0.052, rng, hf * 0.034);
    cape.mailNow = 0;
    cape.thinNow = 0;
    body.push(cape);
  }

  return { shoulderY, handY, handZ, helmY, helmR, helmH };
}

// ---------------------------------------------------------------------------------------
// BISHOP — the standing figure, armoured, kite shield at the side, short cape.
// ---------------------------------------------------------------------------------------

function bishop(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const PH = 0.98;
  const PR = 1.10;
  const HF = 2.62;

  const base = new Part();
  base.detail = d * 1.15;
  plinth(base, PR, PH, 6, rng, 3);
  body.push(base);

  const s = standing(body, rng, d, {
    y0: PH, hf: HF, w: 1.0, hem: 0.395, billow: 0.98, robe: false,
  });

  const helm = new Part();
  helm.detail = d * 0.42;
  helmCross(helm, 0, s.helmY, 0.020 * HF, s.helmR, s.helmH, false);
  body.push(helm);

  // Shield stood on its point beside him, leaning in against the hip.
  const shield = new Part();
  shield.detail = d * 0.50;
  kiteShield(
    shield,
    V(0.46, PH + HF * 0.400, 0.16),
    quatFromAxes(V(0.97, 0, 0.24), V(-0.20, 0.24, 0.95), V(0.14, 0.97, -0.20)),
    0.34, 0.44, 0.62, 0.055,
  );
  body.push(shield);

  return {
    body,
    plinthTop: PH,
    plinthR: PR,
    arm: null,
    armPivot: V(0, PH + HF * 0.760, 0.10),
    tip: V(0, s.handY, s.handZ + 0.06),
    comY: PH * 0.55 + HF * 0.34,
    breaks: [
      { p: V(0, PH + HF * 0.985, 0.02), n: V(0.32, 0.88, 0.36).normalize(), depth: 0.05 },
      { p: V(0.34, PH + HF * 0.790, 0.02), n: V(0.90, 0.30, 0.32).normalize(), depth: 0.07 },
      { p: V(-0.34, PH + HF * 0.790, 0.02), n: V(-0.88, 0.26, 0.40).normalize(), depth: 0.07 },
      { p: V(0.62, PH + HF * 0.150, 0.30), n: V(0.86, -0.18, 0.42).normalize(), depth: 0.08 },
      { p: V(-0.94, 0.12, -0.30), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.10 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// ROOK — a castle turret in visible masonry courses, crenellated, one merlon long gone.
// ---------------------------------------------------------------------------------------

function rook(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const PH = 0.86;
  const PR = 1.10;

  const base = new Part();
  base.detail = d * 1.15;
  plinth(base, PR, PH, 6, rng, 3);
  body.push(base);

  const shaft = new Part();
  shaft.detail = d * 0.95;
  const sp = ngon(8, 1, 1, Math.PI / 8);
  const courses = 7;
  const st: Station[] = [];
  const shaftTop = PH + 1.44;
  for (let i = 0; i <= courses; i++) {
    const t = i / courses;
    const y = PH + 0.02 + t * 1.42;
    const sc = 0.80 - t * 0.11;
    st.push({ y: y - 0.024, sx: sc * 1.030, sz: sc * 1.030 });
    st.push({ y, sx: sc, sz: sc });
  }
  stack(shaft, sp, st);
  body.push(shaft);

  // Arrow slits: proud jambs either side of a recessed centre, on three faces.
  const detailPart = new Part();
  detailPart.detail = d * 0.50;
  for (let f = 0; f < 3; f++) {
    const a = -Math.PI / 2 + (f - 1) * 0.95;
    const nx = Math.cos(a), nz = Math.sin(a);
    const tx = Math.sin(a), tz = -Math.cos(a);
    const q = quatFromAxes(V(tx, 0, tz), V(0, 1, 0), V(nx, 0, nz));
    const rr = 0.66;
    for (const sgn of [-1, 1]) {
      slab(detailPart,
        V(nx * rr + tx * 0.10 * sgn, PH + 0.86, nz * rr + tz * 0.10 * sgn),
        V(0.048, 0.30, 0.045), q);
    }
    slab(detailPart, V(nx * rr, PH + 1.19, nz * rr), V(0.155, 0.048, 0.045), q);
  }
  body.push(detailPart);

  // Corbelled machicolation, then the parapet.
  const cor = new Part();
  cor.detail = d * 0.70;
  stack(cor, ngon(8, 1, 1, Math.PI / 8), [
    { y: shaftTop - 0.10, sx: 0.70, sz: 0.70 },
    { y: shaftTop, sx: 0.86, sz: 0.86 },
    { y: shaftTop + 0.16, sx: 0.90, sz: 0.90 },
    { y: shaftTop + 0.26, sx: 0.84, sz: 0.84 },
  ]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    slab(cor, V(Math.cos(a) * 0.80, shaftTop - 0.02, Math.sin(a) * 0.80),
      V(0.10, 0.11, 0.09),
      new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a + Math.PI / 2));
  }
  body.push(cor);

  const crownP = new Part();
  crownP.detail = d * 0.55;
  const merlons: THREE.Vector3[] = [];
  const my = shaftTop + 0.50;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const c = V(Math.cos(a) * 0.58, my, Math.sin(a) * 0.58);
    merlons.push(c);
    slab(crownP, c, V(0.23, 0.24, 0.14),
      new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a + Math.PI / 2));
  }
  stack(crownP, ngon(8, 1, 1, Math.PI / 8), [
    { y: shaftTop + 0.24, sx: 0.76, sz: 0.76 },
    { y: shaftTop + 0.40, sx: 0.74, sz: 0.74 },
  ]);
  body.push(crownP);

  const pick = rng.int(0, 6);
  const bm = merlons[pick];
  const dir = bm.clone().setY(0).normalize();

  return {
    body,
    plinthTop: PH,
    plinthR: PR,
    arm: null,
    armPivot: V(0, PH + 0.9, 0.6),
    tip: V(0, my, 0.7),
    comY: PH * 0.55 + 0.62,
    breaks: [
      { p: bm.clone().add(V(0, 0.06, 0)), n: dir.clone().add(V(0, 0.55, 0)).normalize(), depth: 0.12 },
      { p: merlons[(pick + 3) % 6].clone().add(V(0, 0.14, 0)), n: V(0, 1, 0.25).normalize(), depth: 0.06 },
      { p: V(0.96, 0.14, 0.46), n: V(0.80, -0.34, 0.50).normalize(), depth: 0.10 },
      { p: V(-0.62, PH + 0.90, -0.56), n: V(-0.72, 0.10, -0.68).normalize(), depth: 0.07 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// QUEEN / KING — the standing figure again, taller, crowned, inside a long cape.
// ---------------------------------------------------------------------------------------

function royal(rng: Rng, d: number, isKing: boolean): FormResult {
  const body: Part[] = [];
  const PH = isKing ? 1.14 : 1.06;
  const PR = isKing ? 1.12 : 1.06;
  const HF = isKing ? 3.46 : 3.14;
  const w = isKing ? 1.02 : 0.94;

  const base = new Part();
  base.detail = d * 1.15;
  plinth(base, PR, PH, 6, rng, 3);
  body.push(base);

  const s = standing(body, rng, d, {
    y0: PH, hf: HF, w, hem: 0.300, billow: 1.06, robe: true,
  });

  const helm = new Part();
  helm.detail = d * 0.42;
  helmCross(helm, 0, s.helmY, 0.016 * HF, s.helmR, s.helmH * 0.80, true);
  crown(
    helm, 0, s.helmY + s.helmH * 0.62, 0.016 * HF,
    s.helmR * 1.02, PH + HF, isKing ? 5 : 7,
  );
  body.push(helm);

  // The king carries a staff; the queen a long blade held point-down at her side. Both are
  // the articulated part, so the king can let his fall when he is mated.
  const arm = new Part();
  arm.detail = d * 0.46;
  let tip: THREE.Vector3;
  let pivot: THREE.Vector3;
  const gx = 0.150 * HF * w;
  if (isKing) {
    pivot = V(gx, PH + HF * 0.600, 0.30);
    tube(arm, [
      V(gx, PH + 0.10, 0.32),
      V(gx, PH + HF * 0.35, 0.31),
      V(gx, PH + HF * 0.70, 0.30),
      V(gx, PH + HF * 0.90, 0.29),
    ], [
      rrect(0.072, 0.075, 0.3),
      rrect(0.064, 0.066, 0.3),
      rrect(0.060, 0.062, 0.3),
      rrect(0.058, 0.060, 0.3),
    ], V(0, 0, 1));
    stack(arm, ngon(8, 0.135, 0.135, Math.PI / 8), [
      { y: PH + HF * 0.892, sx: 0.68, sz: 0.68, ox: gx, oz: 0.29 },
      { y: PH + HF * 0.918, sx: 1.00, sz: 1.00, ox: gx, oz: 0.29 },
      { y: PH + HF * 0.950, sx: 0.94, sz: 0.94, ox: gx, oz: 0.29 },
      { y: PH + HF * 0.972, sx: 0.52, sz: 0.52, ox: gx, oz: 0.29 },
    ]);
    tip = V(gx, PH + 0.10, 0.32);
  } else {
    pivot = V(gx, PH + HF * 0.600, 0.30);
    hilt(arm, V(gx, PH + HF * 0.640, 0.32), V(0, 1, 0.05), V(1, 0, 0), 0.24, HF * 0.30);
    blade(arm, V(gx, PH + HF * 0.590, 0.34), V(gx, PH + 0.16, 0.44), 0.115, 0.036);
    tip = V(gx, PH + 0.16, 0.44);
  }

  return {
    body,
    plinthTop: PH,
    plinthR: PR,
    arm: [arm],
    armPivot: pivot,
    tip,
    comY: PH * 0.55 + HF * 0.36,
    breaks: [
      { p: V(0.22 * w, PH + HF * 0.985, 0.10), n: V(0.60, 0.66, 0.45).normalize(), depth: 0.05 },
      { p: V(-0.18 * w, PH + HF * 0.985, -0.02), n: V(-0.44, 0.70, -0.56).normalize(), depth: 0.05 },
      { p: V(0.36 * w, PH + HF * 0.780, -0.14), n: V(0.82, 0.24, -0.52).normalize(), depth: 0.08 },
      { p: V(-1.00 * w, 0.16, -0.34), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.11 },
      { p: V(0.98 * w, 0.16, 0.40), n: V(0.82, -0.32, 0.47).normalize(), depth: 0.10 },
    ],
  };
}

const BUILDERS: Record<PieceType, (rng: Rng, d: number) => FormResult> = {
  pawn,
  knight,
  bishop,
  rook,
  queen: (rng, d) => royal(rng, d, false),
  king: (rng, d) => royal(rng, d, true),
};

export function buildForm(type: PieceType, rng: Rng, detail: number): FormResult {
  return BUILDERS[type](rng, detail);
}
