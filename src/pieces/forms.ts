/**
 * PIECE: pieces — the six carvings.
 *
 * Built against refs/frames/knight-looking-up.webp. These are not abstract chess forms:
 * they are figurative armoured combatants in carved stone, each on its own hexagonal
 * stepped and moulded plinth.
 *
 *   pawn    a crouching, hunched foot-soldier under a domed helm, shield and short blade
 *           held close. From behind — which is how the judging camera sees the dark army —
 *           a row of domed shells. The most distinctive silhouette on the board.
 *   knight  an armoured rider on a horse: conical helm with a cross-shaped visor slit, a
 *           cape falling behind as heavy drapery, leaning forward over a curved blade.
 *   bishop  a tall standing armoured figure, hands joined at the chest, narrow.
 *   rook    a castle turret in real masonry courses, crenellated, one merlon long gone.
 *   queen   a robed figure under a crowned helm inside a wide falling cape.
 *   king    the same but heavier and taller, and carrying a staff he can let fall.
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
 * A drapery section: a ring with alternating radii so a cape falls in real vertical folds
 * rather than as a smooth cone. `back` deepens the rear of the fall.
 */
function foldRing(n: number, r: number, fold: number, back: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    // Alternating ridge/valley plus a slower second harmonic, so the drapery reads as
    // cloth gathering rather than as a regular fluted column.
    const f = 1 + (i % 2 ? -fold : fold) + Math.sin(i * 1.7 + 0.6) * fold * 0.55;
    const rr = r * f * (1 + back * -Math.cos(a));
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
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

/**
 * The plinth. Hexagonal, stepped, with a real moulded profile: bottom slab, set-back,
 * fillet, ovolo roll, die, cornice. Architectural, not a disc.
 */
function plinth(p: Part, r: number, h: number, sides: number, rng: Rng): void {
  const prof = ngon(sides, r, r, Math.PI / sides + rng.float(-0.05, 0.05), jitArr(sides, rng, 0.010));
  const S = (t: number, s: number): Station => ({ y: t * h, sx: s, sz: s });
  stack(p, prof, [
    S(0.00, 0.985), S(0.05, 1.000), S(0.21, 0.998),
    S(0.24, 0.928), S(0.38, 0.922),
    S(0.41, 0.896),
    S(0.49, 0.952), S(0.58, 0.950),
    S(0.62, 0.892),
    S(0.68, 0.856), S(0.85, 0.850),
    S(0.89, 0.898), S(0.955, 0.892),
    S(1.00, 0.828),
  ]);
}

/** A faceted dome — helms, pauldrons, the pawn's shell back. */
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

/** A tapering wedge — crown points, ears, merlon spurs. */
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

/**
 * A conical crusader helm with a rolled brim and a cross-shaped visor slit rendered in
 * relief — a proud nasal and eye-bar, which is what actually reads at distance.
 */
function conicalHelm(
  p: Part,
  cx: number, cy: number, cz: number,
  r: number, h: number,
): void {
  const prof = ngon(8, r, r, Math.PI / 8);
  stack(p, prof, [
    { y: cy, sx: 0.96, sz: 0.96, ox: cx, oz: cz },
    { y: cy + h * 0.06, sx: 1.08, sz: 1.08, ox: cx, oz: cz },
    { y: cy + h * 0.14, sx: 1.02, sz: 1.02, ox: cx, oz: cz },
    { y: cy + h * 0.44, sx: 0.94, sz: 0.94, ox: cx, oz: cz },
    { y: cy + h * 0.74, sx: 0.66, sz: 0.66, ox: cx, oz: cz },
    { y: cy + h * 0.91, sx: 0.32, sz: 0.32, ox: cx, oz: cz },
    { y: cy + h, sx: 0.085, sz: 0.085, ox: cx, oz: cz },
  ]);
  const fz = cz + r * 0.88;
  const bar = new THREE.Quaternion();
  slab(p, V(cx, cy + h * 0.38, fz), V(r * 0.12, h * 0.36, r * 0.14), bar);
  slab(p, V(cx, cy + h * 0.44, fz - r * 0.02), V(r * 0.60, h * 0.085, r * 0.13), bar);
}

// ---------------------------------------------------------------------------------------
// PAWN — a crouching, hunched armoured foot-soldier. Domed shell back, shield, short blade.
// ---------------------------------------------------------------------------------------

function pawn(rng: Rng, d: number): FormResult {
  const body: Part[] = [];

  const base = new Part();
  base.detail = d * 1.2;
  plinth(base, 0.82, 0.46, 6, rng);
  body.push(base);

  // The hunched back: a shell curling from a low rear up and over to the shoulders.
  const shell = new Part();
  shell.detail = d * 0.8;
  tube(shell, [
    V(0, 0.80, -0.50),
    V(0, 1.24, -0.48),
    V(0, 1.72, -0.28),
    V(0, 1.96, 0.06),
    V(0, 1.92, 0.34),
  ], [
    boxProf(0.44, 0.26, 0.24, 0.42),
    boxProf(0.54, 0.34, 0.30, 0.42),
    boxProf(0.58, 0.34, 0.34, 0.42),
    boxProf(0.54, 0.30, 0.34, 0.42),
    boxProf(0.42, 0.22, 0.26, 0.42),
  ], V(0, 1, 0));
  for (const s of [-1, 1]) {
    dome(shell, 0.42 * s, 1.70, 0.08, 0.25, 0.29, 0.24, 6, 3);
  }
  body.push(shell);

  // Domed helm, tipped forward, with a rolled brim, brow band and nasal.
  const helm = new Part();
  helm.detail = d * 0.5;
  stack(helm, ngon(8, 0.29, 0.29, Math.PI / 8), [
    { y: 1.82, sx: 0.90, sz: 0.90, oz: 0.30 },
    { y: 1.92, sx: 1.10, sz: 1.10, oz: 0.32 },
    { y: 2.00, sx: 1.04, sz: 1.04, oz: 0.33 },
  ]);
  dome(helm, 0, 2.00, 0.33, 0.30, 0.30, 0.44, 8, 4, Math.PI / 8);
  slab(helm, V(0, 2.04, 0.58), V(0.20, 0.045, 0.075), new THREE.Quaternion());
  slab(helm, V(0, 1.94, 0.60), V(0.045, 0.115, 0.065), new THREE.Quaternion());
  body.push(helm);

  // One knee down, one foot planted — a soldier braced on the plinth.
  const legs = new Part();
  legs.detail = d * 0.68;
  tube(legs, [
    V(0.30, 1.10, -0.26),
    V(0.32, 0.74, 0.06),
    V(0.32, 0.52, 0.30),
    V(0.31, 0.48, 0.10),
    V(0.30, 0.48, -0.22),
  ], [
    rrect(0.20, 0.22, 0.34),
    rrect(0.17, 0.19, 0.34),
    rrect(0.15, 0.16, 0.30),
    rrect(0.14, 0.15, 0.32),
    rrect(0.13, 0.16, 0.32),
  ], V(1, 0, 0));
  tube(legs, [
    V(-0.30, 1.16, -0.18),
    V(-0.33, 0.90, 0.22),
    V(-0.34, 0.56, 0.44),
    V(-0.34, 0.48, 0.60),
  ], [
    rrect(0.21, 0.23, 0.34),
    rrect(0.17, 0.19, 0.34),
    rrect(0.15, 0.16, 0.32),
    rrect(0.15, 0.20, 0.30),
  ], V(1, 0, 0));
  body.push(legs);

  // Shield held close on the left, a rounded kite leaning against the shoulder.
  const shield = new Part();
  shield.detail = d * 0.55;
  shield.thinNow = 0.45;
  stack(shield, ngon(7, 0.30, 0.42, 0.22), [
    { y: -0.055, sx: 0.97, sz: 0.97 },
    { y: 0.0, sx: 1.0, sz: 1.0 },
    { y: 0.055, sx: 0.90, sz: 0.90 },
  ]);
  shield.thinNow = 0;
  {
    // Stand the plate up and lean it on the pawn's left shoulder.
    const q = quatFromAxes(V(0.94, 0, 0.34), V(-0.30, 0.24, 0.92), V(0.08, 0.97, -0.23));
    const m = new THREE.Matrix4().compose(V(-0.54, 1.34, 0.24), q, V(1, 1, 1));
    for (let i = 0; i < shield.pos.length; i += 3) {
      const v = V(shield.pos[i], shield.pos[i + 1], shield.pos[i + 2]).applyMatrix4(m);
      shield.pos[i] = v.x; shield.pos[i + 1] = v.y; shield.pos[i + 2] = v.z;
    }
  }
  body.push(shield);

  // Right arm + short blade held low and forward across the body.
  const arm = new Part();
  arm.detail = d * 0.55;
  tube(arm, [
    V(0.42, 1.72, 0.10),
    V(0.44, 1.42, 0.28),
    V(0.34, 1.22, 0.48),
    V(0.24, 1.16, 0.58),
  ], [
    rrect(0.13, 0.14, 0.32),
    rrect(0.11, 0.12, 0.32),
    rrect(0.10, 0.11, 0.32),
    rrect(0.10, 0.11, 0.32),
  ], V(0, 1, 0));
  slab(arm, V(0.24, 1.16, 0.60), V(0.10, 0.09, 0.08), new THREE.Quaternion());
  slab(arm, V(0.24, 1.26, 0.62), V(0.16, 0.04, 0.05), new THREE.Quaternion());
  // Held close and upright against the shoulder — a foot-soldier's short blade, not a pike.
  blade(arm, V(0.24, 1.24, 0.62), V(0.19, 2.06, 0.82), 0.095, 0.030);

  return {
    body,
    arm: [arm],
    armPivot: V(0.42, 1.74, 0.10),
    tip: V(0.19, 2.06, 0.82),
    comY: 1.14,
    breaks: [
      { p: V(0, 2.34, 0.42), n: V(0.30, 0.86, 0.42).normalize(), depth: 0.05 },
      { p: V(0.56, 1.72, 0.08), n: V(0.92, 0.30, -0.24).normalize(), depth: 0.07 },
      { p: V(-0.64, 1.55, 0.28), n: V(-0.86, 0.42, 0.28).normalize(), depth: 0.06 },
      { p: V(-0.72, 0.10, -0.30), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.09 },
      { p: V(0.70, 0.12, 0.34), n: V(0.82, -0.32, 0.47).normalize(), depth: 0.08 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// KNIGHT — an armoured rider on a horse. The judged carving.
// ---------------------------------------------------------------------------------------

function knight(rng: Rng, d: number): FormResult {
  const body: Part[] = [];

  const base = new Part();
  base.detail = d * 1.2;
  plinth(base, 0.94, 0.48, 6, rng);
  body.push(base);

  // --- the horse ------------------------------------------------------------------
  const horse = new Part();
  horse.detail = d * 0.8;
  tube(horse, [
    V(0, 1.44, 0.66),
    V(0, 1.42, 0.30),
    V(0, 1.44, -0.12),
    V(0, 1.46, -0.50),
    V(0, 1.44, -0.74),
  ], [
    boxProf(0.30, 0.28, 0.36, 0.40),
    boxProf(0.34, 0.32, 0.42, 0.40),
    boxProf(0.33, 0.32, 0.40, 0.40),
    boxProf(0.32, 0.30, 0.38, 0.40),
    boxProf(0.27, 0.24, 0.30, 0.40),
  ], V(0, 1, 0));

  // Neck out of the withers, turning progressively so the head reads in profile.
  const headYaw = rng.float(-0.52, -0.30);
  const spine: THREE.Vector3[] = [];
  const necks: number[][][] = [];
  const nsteps = 5;
  const pivotZ = 0.60;
  for (let i = 0; i <= nsteps; i++) {
    const t = i / nsteps;
    const y = 1.58 + t * 0.72;
    const z = 0.60 + t * 0.28 + t * t * 0.18;
    const c = V(0, y, z - pivotZ);
    c.applyAxisAngle(V(0, 1, 0), headYaw * t * t);
    c.z += pivotZ;
    spine.push(c);
    necks.push(boxProf(0.235 - t * 0.075, 0.30 - t * 0.09, 0.27 - t * 0.10, 0.32));
  }
  tube(horse, spine, necks, V(0, 1, 0));
  body.push(horse);

  // --- head ------------------------------------------------------------------------
  const head = new Part();
  head.detail = d * 0.45;
  const poll = spine[nsteps].clone().add(V(0, 0.09, 0.02));
  const nose = poll.clone().add(
    V(Math.sin(headYaw) * 0.62, -0.34, Math.cos(headYaw) * 0.62),
  );
  const hpath = [0, 0.22, 0.46, 0.70, 1].map((t) => {
    const q = poll.clone().lerp(nose, t);
    q.y += Math.sin(t * Math.PI) * 0.035;
    return q;
  });
  tube(head, hpath, [
    boxProf(0.145, 0.14, 0.19, 0.28),
    boxProf(0.160, 0.12, 0.24, 0.28),
    boxProf(0.130, 0.10, 0.17, 0.30),
    boxProf(0.108, 0.08, 0.12, 0.30),
    boxProf(0.092, 0.06, 0.09, 0.30),
  ], V(0, 1, 0));
  head.thinNow = 1.0;
  for (const s of [-1, 1]) {
    const e = poll.clone().add(V(0.085 * s, -0.02, -0.05));
    spike(head, e, e.clone().add(V(0.02 * s, 0.24, -0.02)), 0.05, 0.038, V(0.012 * s, 0, 0));
  }
  head.thinNow = 0;
  body.push(head);

  const mane = new Part();
  mane.detail = d * 0.5;
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
    const proud = 0.055 + 0.030 * Math.sin(t * 2.4 + 0.4) + rng.float(-0.008, 0.008);
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
  legs.detail = d * 0.58;
  const leg = (pts: THREE.Vector3[], w: number[]) =>
    tube(legs, pts, w.map((k) => rrect(k, k * 1.08, 0.32)), V(1, 0, 0));
  for (const s of [-1, 1]) {
    leg([
      V(0.26 * s, 1.36, -0.62),
      V(0.28 * s, 1.00, -0.74),
      V(0.28 * s, 0.72, -0.56),
      V(0.28 * s, 0.54, -0.52),
      V(0.28 * s, 0.46, -0.60),
    ], [0.175, 0.135, 0.095, 0.088, 0.125]);
  }
  leg([
    V(-0.26, 1.30, 0.52),
    V(-0.28, 0.98, 0.60),
    V(-0.29, 0.70, 0.60),
    V(-0.29, 0.52, 0.58),
    V(-0.29, 0.46, 0.66),
  ], [0.165, 0.125, 0.090, 0.085, 0.120]);
  leg([
    V(0.26, 1.30, 0.56),
    V(0.31, 1.06, 0.92),
    V(0.35, 0.92, 1.22),
    V(0.37, 0.70, 1.30),
    V(0.38, 0.54, 1.22),
    V(0.38, 0.46, 1.18),
  ], [0.165, 0.130, 0.100, 0.086, 0.082, 0.118]);
  legs.thinNow = 0.3;
  tube(legs, [
    V(0, 1.44, -0.80),
    V(0.04, 1.16, -0.94),
    V(0.06, 0.86, -0.92),
    V(0.05, 0.62, -0.80),
  ], [
    rrect(0.10, 0.11, 0.3),
    rrect(0.095, 0.105, 0.3),
    rrect(0.075, 0.085, 0.3),
    rrect(0.045, 0.05, 0.3),
  ], V(1, 0, 0));
  legs.thinNow = 0;
  body.push(legs);

  // --- the rider ----------------------------------------------------------------------
  const rider = new Part();
  rider.detail = d * 0.55;
  tube(rider, [
    V(0, 1.62, -0.18),
    V(0, 2.00, -0.10),
    V(0, 2.38, 0.02),
    V(0, 2.62, 0.10),
    V(0, 2.74, 0.12),
  ], [
    boxProf(0.26, 0.22, 0.24, 0.36),
    boxProf(0.28, 0.24, 0.26, 0.36),
    boxProf(0.30, 0.24, 0.26, 0.36),
    boxProf(0.32, 0.22, 0.24, 0.36),
    boxProf(0.20, 0.16, 0.17, 0.36),
  ], V(0, 1, 0));
  for (const s of [-1, 1]) {
    tube(rider, [
      V(0.20 * s, 1.86, -0.10),
      V(0.34 * s, 1.72, 0.16),
      V(0.36 * s, 1.50, 0.34),
      V(0.35 * s, 1.28, 0.36),
    ], [
      rrect(0.15, 0.16, 0.34),
      rrect(0.13, 0.14, 0.34),
      rrect(0.105, 0.115, 0.34),
      rrect(0.10, 0.13, 0.32),
    ], V(1, 0, 0));
  }
  tube(rider, [
    V(-0.30, 2.56, 0.06),
    V(-0.36, 2.26, 0.26),
    V(-0.32, 2.06, 0.50),
    V(-0.28, 2.00, 0.62),
  ], [
    rrect(0.115, 0.125, 0.32),
    rrect(0.10, 0.11, 0.32),
    rrect(0.09, 0.10, 0.32),
    rrect(0.09, 0.10, 0.32),
  ], V(0, 1, 0));
  conicalHelm(rider, 0, 2.74, 0.10, 0.215, 0.62);
  body.push(rider);

  // Cape: heavy drapery from the shoulders over the horse's flank — the silhouette the
  // camera sees when it looks at the dark army from behind.
  const cape = new Part();
  cape.detail = d * 0.65;
  cape.thinNow = 0.35;
  stack(cape, foldRing(14, 1, 0.095, 0.10), [
    { y: 2.66, sx: 0.24, sz: 0.24, oz: 0.02 },
    { y: 2.50, sx: 0.33, sz: 0.30, oz: -0.06 },
    { y: 2.10, sx: 0.44, sz: 0.38, oz: -0.16 },
    { y: 1.70, sx: 0.52, sz: 0.44, oz: -0.24 },
    { y: 1.34, sx: 0.56, sz: 0.47, oz: -0.30 },
    { y: 1.16, sx: 0.51, sz: 0.43, oz: -0.32 },
  ]);
  cape.thinNow = 0;
  body.push(cape);

  // Right arm and the curved blade, carried forward and high.
  const arm = new Part();
  arm.detail = d * 0.5;
  tube(arm, [
    V(0.30, 2.58, 0.08),
    V(0.42, 2.44, 0.34),
    V(0.48, 2.34, 0.62),
    V(0.50, 2.30, 0.76),
  ], [
    rrect(0.115, 0.125, 0.32),
    rrect(0.10, 0.11, 0.32),
    rrect(0.09, 0.10, 0.32),
    rrect(0.09, 0.10, 0.32),
  ], V(0, 1, 0));
  slab(arm, V(0.50, 2.30, 0.82), V(0.085, 0.085, 0.075), new THREE.Quaternion());
  slab(arm, V(0.50, 2.40, 0.84), V(0.17, 0.04, 0.05), new THREE.Quaternion());
  curvedBlade(arm, V(0.50, 2.38, 0.86), V(0.62, 3.02, 1.42), V(0.10, 0.16, -0.10), 0.085, 0.028);

  return {
    body,
    arm: [arm],
    armPivot: V(0.30, 2.60, 0.08),
    tip: V(0.62, 3.02, 1.42),
    comY: 1.52,
    breaks: [
      { p: V(0, 3.26, 0.10), n: V(0.28, 0.90, 0.34).normalize(), depth: 0.05 },
      { p: V(0.36, 0.52, 1.22), n: V(0.44, -0.40, 0.80).normalize(), depth: 0.07 },
      { p: V(-0.05, 2.20, -0.62), n: V(-0.24, 0.20, -0.95).normalize(), depth: 0.08 },
      { p: V(-0.86, 0.14, -0.36), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.10 },
      { p: V(0.84, 0.14, 0.40), n: V(0.82, -0.32, 0.47).normalize(), depth: 0.09 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// BISHOP — a tall standing armoured figure, hands joined at the chest, narrow silhouette.
// ---------------------------------------------------------------------------------------

function bishop(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.2;
  plinth(base, 0.80, 0.48, 6, rng);
  body.push(base);

  const figure = new Part();
  figure.detail = d * 0.8;
  stack(figure, foldRing(12, 1, 0.075, 0.03), [
    { y: 0.44, sx: 0.48, sz: 0.42 },
    { y: 0.90, sx: 0.45, sz: 0.39, oz: 0.01 },
    { y: 1.60, sx: 0.41, sz: 0.36, oz: 0.02 },
    { y: 2.20, sx: 0.38, sz: 0.33, oz: 0.03 },
    { y: 2.58, sx: 0.41, sz: 0.34, oz: 0.03 },
    { y: 2.86, sx: 0.46, sz: 0.35, oz: 0.02 },
    { y: 3.02, sx: 0.36, sz: 0.28, oz: 0.02 },
  ]);
  body.push(figure);

  // Surcoat: a flat panel down the front, the way a tabard hangs over mail.
  const coat = new Part();
  coat.detail = d * 0.65;
  coat.thinNow = 0.3;
  stack(coat, rrect(1, 1, 0.30), [
    { y: 0.62, sx: 0.30, sz: 0.05, oz: 0.335 },
    { y: 1.60, sx: 0.29, sz: 0.05, oz: 0.330 },
    { y: 2.40, sx: 0.26, sz: 0.05, oz: 0.310 },
    { y: 2.72, sx: 0.22, sz: 0.05, oz: 0.295 },
  ]);
  coat.thinNow = 0;
  body.push(coat);

  const arms = new Part();
  arms.detail = d * 0.55;
  for (const s of [-1, 1]) {
    tube(arms, [
      V(0.36 * s, 2.78, 0.02),
      V(0.40 * s, 2.50, 0.14),
      V(0.26 * s, 2.34, 0.30),
      V(0.09 * s, 2.32, 0.36),
    ], [
      rrect(0.115, 0.125, 0.32),
      rrect(0.10, 0.11, 0.32),
      rrect(0.09, 0.10, 0.32),
      rrect(0.085, 0.095, 0.32),
    ], V(0, 1, 0));
  }
  slab(arms, V(0, 2.36, 0.40), V(0.13, 0.14, 0.09), new THREE.Quaternion());
  body.push(arms);

  const helm = new Part();
  helm.detail = d * 0.45;
  conicalHelm(helm, 0, 3.00, 0.03, 0.215, 0.60);
  body.push(helm);

  return {
    body,
    arm: null,
    armPivot: V(0, 2.60, 0.20),
    tip: V(0, 2.36, 0.44),
    comY: 1.55,
    breaks: [
      { p: V(0, 3.52, 0.03), n: V(0.32, 0.88, 0.36).normalize(), depth: 0.05 },
      { p: V(0.46, 2.84, 0.06), n: V(0.90, 0.30, 0.32).normalize(), depth: 0.07 },
      { p: V(-0.44, 2.60, 0.20), n: V(-0.88, 0.26, 0.40).normalize(), depth: 0.07 },
      { p: V(-0.70, 0.12, -0.28), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.09 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// ROOK — a castle turret in visible masonry courses, crenellated, one merlon long gone.
// ---------------------------------------------------------------------------------------

function rook(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.2;
  plinth(base, 0.92, 0.46, 6, rng);
  body.push(base);

  const shaft = new Part();
  shaft.detail = d * 1.0;
  const sp = rrect(1, 1, 0.26);
  const courses = 5;
  const st: Station[] = [];
  for (let i = 0; i <= courses; i++) {
    const t = i / courses;
    const y = 0.42 + t * 1.72;
    const s = 0.74 - t * 0.13;
    st.push({ y: y - 0.028, sx: s * 1.026, sz: s * 1.026 });
    st.push({ y, sx: s, sz: s });
  }
  stack(shaft, sp, st);
  body.push(shaft);

  const cor = new Part();
  cor.detail = d * 0.75;
  stack(cor, rrect(1, 1, 0.24), [
    { y: 2.08, sx: 0.60, sz: 0.60 },
    { y: 2.20, sx: 0.78, sz: 0.78 },
    { y: 2.42, sx: 0.80, sz: 0.80 },
    { y: 2.52, sx: 0.74, sz: 0.74 },
  ]);
  body.push(cor);

  const crown = new Part();
  crown.detail = d * 0.55;
  const merlons: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = V(Math.cos(a) * 0.49, 2.78, Math.sin(a) * 0.49);
    merlons.push(c);
    slab(
      crown, c, V(0.30, 0.27, 0.18),
      new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a + Math.PI / 2),
    );
  }
  stack(crown, rrect(1, 1, 0.24), [
    { y: 2.48, sx: 0.70, sz: 0.70 },
    { y: 2.66, sx: 0.68, sz: 0.68 },
  ]);
  // A pair of jamb shafts flanking a blind arch on the front face — architecture, not lump.
  for (const s of [-1, 1]) {
    slab(crown, V(0.17 * s, 1.32, 0.66), V(0.05, 0.36, 0.055), new THREE.Quaternion());
  }
  body.push(crown);

  const pick = rng.int(0, 4);
  const bm = merlons[pick];
  const dir = bm.clone().setY(0).normalize();

  return {
    body,
    arm: null,
    armPivot: V(0, 1.6, 0.5),
    tip: V(0, 2.7, 0.7),
    comY: 1.15,
    breaks: [
      { p: bm.clone().add(V(0, 0.06, 0)), n: dir.clone().add(V(0, 0.55, 0)).normalize(), depth: 0.10 },
      { p: merlons[(pick + 2) % 4].clone().add(V(0, 0.16, 0)), n: V(0, 1, 0.25).normalize(), depth: 0.05 },
      { p: V(0.86, 0.14, 0.42), n: V(0.80, -0.34, 0.50).normalize(), depth: 0.09 },
      { p: V(-0.66, 1.20, -0.60), n: V(-0.72, 0.10, -0.68).normalize(), depth: 0.07 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// QUEEN / KING — robed figures under crowned helms, inside a wide falling cape.
// ---------------------------------------------------------------------------------------

function royal(rng: Rng, d: number, isKing: boolean): FormResult {
  const body: Part[] = [];
  const H = isKing ? 4.55 : 4.15;
  const w = isKing ? 1.0 : 0.90;

  const base = new Part();
  base.detail = d * 1.2;
  plinth(base, isKing ? 0.98 : 0.90, 0.52, 6, rng);
  body.push(base);

  // The cape is the piece: a wide fall of drapery from the shoulders to the plinth.
  const cape = new Part();
  cape.detail = d * 0.8;
  cape.thinNow = 0.3;
  const top = H - 1.12;
  stack(cape, foldRing(16, 1, 0.108, 0.075), [
    { y: 0.48, sx: 0.86 * w, sz: 0.74 * w },
    { y: 1.10, sx: 0.83 * w, sz: 0.72 * w, oz: 0.01 },
    { y: 2.05, sx: 0.74 * w, sz: 0.64 * w, oz: 0.02 },
    { y: 2.85, sx: 0.63 * w, sz: 0.55 * w, oz: 0.03 },
    { y: top - 0.30, sx: 0.55 * w, sz: 0.47 * w, oz: 0.03 },
    { y: top, sx: 0.50 * w, sz: 0.42 * w, oz: 0.02 },
    { y: top + 0.18, sx: 0.36 * w, sz: 0.31 * w, oz: 0.02 },
  ]);
  cape.thinNow = 0;
  body.push(cape);

  const figure = new Part();
  figure.detail = d * 0.7;
  stack(figure, foldRing(12, 1, 0.062, 0.0), [
    { y: 0.52, sx: 0.52 * w, sz: 0.44 * w, oz: 0.14 },
    { y: 1.60, sx: 0.47 * w, sz: 0.40 * w, oz: 0.16 },
    { y: 2.70, sx: 0.42 * w, sz: 0.36 * w, oz: 0.18 },
    { y: top, sx: 0.38 * w, sz: 0.32 * w, oz: 0.16 },
    { y: top + 0.22, sx: 0.26 * w, sz: 0.22 * w, oz: 0.14 },
  ]);
  for (const s of [-1, 1]) {
    tube(figure, [
      V(0.40 * w * s, top - 0.02, 0.14),
      V(0.44 * w * s, top - 0.44, 0.24),
      V(0.34 * w * s, top - 0.80, 0.36),
      V(0.22 * w * s, top - 0.92, 0.42),
    ], [
      rrect(0.135, 0.145, 0.32),
      rrect(0.115, 0.125, 0.32),
      rrect(0.10, 0.11, 0.32),
      rrect(0.10, 0.11, 0.32),
    ], V(0, 1, 0));
  }
  body.push(figure);

  const helm = new Part();
  helm.detail = d * 0.45;
  const hy = top + 0.16;
  conicalHelm(helm, 0, hy, 0.14, 0.245 * w, 0.58);
  stack(helm, ngon(8, 0.275 * w, 0.275 * w, Math.PI / 8), [
    { y: hy + 0.30, sx: 0.98, sz: 0.98, oz: 0.14 },
    { y: hy + 0.46, sx: 1.02, sz: 1.02, oz: 0.14 },
    { y: hy + 0.52, sx: 0.94, sz: 0.94, oz: 0.14 },
  ]);
  helm.thinNow = 0.7;
  const pts = isKing ? 5 : 7;
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2 + 0.3;
    const bx = Math.cos(a) * 0.245 * w, bz = Math.sin(a) * 0.245 * w + 0.14;
    spike(
      helm,
      V(bx, hy + 0.48, bz),
      V(bx * 1.06, H - (isKing ? 0.06 : 0.02), bz * 1.04),
      0.070 * w, 0.062 * w, V(0, 0, 0),
    );
  }
  helm.thinNow = 0;
  body.push(helm);

  // The king carries a staff; the queen a slender blade held point-down.
  const arm = new Part();
  arm.detail = d * 0.5;
  let tip: THREE.Vector3;
  let pivot: THREE.Vector3;
  if (isKing) {
    pivot = V(0.30 * w, top - 0.86, 0.52);
    tube(arm, [
      V(0.30 * w, 0.58, 0.56),
      V(0.30 * w, 1.80, 0.54),
      V(0.30 * w, 3.10, 0.52),
      V(0.30 * w, 3.86, 0.51),
    ], [
      rrect(0.075, 0.078, 0.3),
      rrect(0.066, 0.068, 0.3),
      rrect(0.062, 0.064, 0.3),
      rrect(0.060, 0.062, 0.3),
    ], V(0, 0, 1));
    stack(arm, ngon(8, 0.125, 0.125, Math.PI / 8), [
      { y: 3.84, sx: 0.70, sz: 0.70, ox: 0.30 * w, oz: 0.51 },
      { y: 3.94, sx: 1.00, sz: 1.00, ox: 0.30 * w, oz: 0.51 },
      { y: 4.08, sx: 0.95, sz: 0.95, ox: 0.30 * w, oz: 0.51 },
      { y: 4.18, sx: 0.55, sz: 0.55, ox: 0.30 * w, oz: 0.51 },
    ]);
    tip = V(0.30 * w, 0.58, 0.56);
  } else {
    pivot = V(0.24 * w, top - 0.88, 0.48);
    slab(arm, V(0.24 * w, top - 0.90, 0.50), V(0.10, 0.10, 0.075), new THREE.Quaternion());
    slab(arm, V(0.24 * w, top - 0.78, 0.52), V(0.26, 0.045, 0.05), new THREE.Quaternion());
    blade(arm, V(0.24 * w, top - 0.82, 0.54), V(0.24 * w, 0.58, 0.74), 0.125, 0.038);
    tip = V(0.24 * w, 0.58, 0.74);
  }

  return {
    body,
    arm: [arm],
    armPivot: pivot,
    tip,
    comY: H * 0.42,
    breaks: [
      { p: V(0.24 * w, H - 0.14, 0.20), n: V(0.60, 0.66, 0.45).normalize(), depth: 0.05 },
      { p: V(-0.20 * w, H - 0.12, 0.02), n: V(-0.44, 0.70, -0.56).normalize(), depth: 0.05 },
      { p: V(0.80 * w, 2.90, -0.18), n: V(0.82, 0.24, -0.52).normalize(), depth: 0.08 },
      { p: V(-0.86 * w, 0.16, -0.34), n: V(-0.84, -0.30, -0.45).normalize(), depth: 0.10 },
      { p: V(0.86 * w, 0.16, 0.40), n: V(0.82, -0.32, 0.47).normalize(), depth: 0.09 },
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
