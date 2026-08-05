/**
 * PIECE: pieces — the six carvings.
 *
 * Every form here is cut, not revolved. Cross-sections are small polygons (6–12 sides)
 * lofted in stacks and along paths, so every surface is a plane and every silhouette has
 * corners in it. Nothing is a lathe. The knight in particular is a real horse's head and
 * neck built from blocky sections, with the mane in literal stepped slabs.
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

/** Asymmetric block section: half-width, up extent, down extent. 8 points. */
function boxProf(hw: number, up: number, dn: number, cut = 0.34): number[][] {
  const cx = hw * cut, cy = Math.min(up, dn) * cut;
  return [
    [-hw + cx, -dn], [hw - cx, -dn],
    [hw, -dn + cy], [hw, up - cy],
    [hw - cx, up], [-hw + cx, up],
    [-hw, up - cy], [-hw, -dn + cy],
  ];
}

/** A thick arc — used for the bishop's cowl, which is a real cavity, not a painted face. */
function crescent(rOut: number, rIn: number, openDeg: number, n: number, face = Math.PI / 2): number[][] {
  const half = ((360 - openDeg) / 2) * (Math.PI / 180);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = face + half - (2 * half * i) / (n - 1) + Math.PI;
    out.push([Math.cos(a) * rOut, Math.sin(a) * rOut]);
  }
  for (let i = 0; i < n; i++) {
    const a = face - half + (2 * half * i) / (n - 1) + Math.PI;
    out.push([Math.cos(a) * rIn, Math.sin(a) * rIn]);
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

function plinth(p: Part, rx: number, rz: number, h: number, n: number, rng: Rng): void {
  const j = jitArr(n, rng, 0.045);
  const prof = ngon(n, rx, rz, rng.float(0, 0.4), j);
  stack(p, prof, [
    { y: 0.0, sx: 0.955, sz: 0.955 },
    { y: h * 0.16, sx: 1.0, sz: 1.0 },
    { y: h * 0.72, sx: 0.99, sz: 0.99 },
    { y: h, sx: 0.885, sz: 0.885 },
  ]);
}

function quatFromAxes(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(x.clone().normalize(), y.clone().normalize(), z.clone().normalize());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** A tapering wedge — ears, crown points, coronet spikes. */
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

/** A blade: lens section, sharp on both long edges. */
function blade(
  p: Part,
  hilt: THREE.Vector3,
  point: THREE.Vector3,
  width: number,
  thick: number,
): void {
  const lens = (w: number, t: number): number[][] => [
    [-w, 0], [-w * 0.55, -t], [w * 0.55, -t], [w, 0], [w * 0.55, t], [-w * 0.55, t],
  ];
  const path = [
    hilt.clone(),
    hilt.clone().lerp(point, 0.22),
    hilt.clone().lerp(point, 0.55),
    hilt.clone().lerp(point, 0.84),
    point.clone(),
  ];
  p.thinNow = 0.9;
  tube(p, path, [
    lens(width * 0.92, thick),
    lens(width, thick),
    lens(width * 0.9, thick * 0.9),
    lens(width * 0.6, thick * 0.72),
    lens(width * 0.08, thick * 0.2),
  ], V(0, 0, 1));
  p.thinNow = 0;
}

// ---------------------------------------------------------------------------------------
// KNIGHT — a horse's head, neck and raised foreleg, cut in planes. The judged carving.
// ---------------------------------------------------------------------------------------

function knight(rng: Rng, d: number): FormResult {
  const body: Part[] = [];

  const base = new Part();
  base.detail = d * 1.25;
  plinth(base, 0.88, 0.88, 0.26, 10, rng);
  body.push(base);

  // Chest and withers. Deep front-to-back, narrower across — a horse, not a barrel.
  const chest = new Part();
  chest.detail = d * 1.1;
  const cp = rrect(1, 1, 0.36);
  stack(chest, cp, [
    { y: 0.20, sx: 0.70, sz: 0.80 },
    { y: 0.62, sx: 0.66, sz: 0.86, oz: 0.03 },
    { y: 1.06, sx: 0.60, sz: 0.84, oz: 0.06 },
    { y: 1.40, sx: 0.52, sz: 0.74, oz: 0.06 },
    { y: 1.66, sx: 0.40, sz: 0.58, oz: 0.04 },
  ]);
  body.push(chest);

  // Neck: rises and leans forward, progressively yawed so the head turns off-axis.
  const headYaw = rng.float(-0.62, -0.34);
  const neck = new Part();
  neck.detail = d * 0.9;
  const spine: THREE.Vector3[] = [];
  const necks: number[][][] = [];
  const nsteps = 6;
  const yawPivot = 0.16;
  for (let i = 0; i <= nsteps; i++) {
    const t = i / nsteps;
    const y = 1.30 + t * 1.42;
    const z = 0.10 + t * t * 0.52 + t * 0.10;
    const yaw = headYaw * t * t;
    const c = V(0, y, z - yawPivot);
    c.applyAxisAngle(V(0, 1, 0), yaw);
    c.z += yawPivot;
    spine.push(c);
    const lat = 0.36 - t * 0.145;
    const crest = 0.46 - t * 0.14;
    const throat = 0.40 - t * 0.19;
    necks.push(boxProf(lat, crest, throat, 0.30));
  }
  tube(neck, spine, necks, V(0, 1, 0));
  body.push(neck);

  // Head. Built along its own axis then swung to the neck's yaw.
  const head = new Part();
  head.detail = d * 0.62;
  const poll = V(0, 3.00, 0.50);
  const nose = V(0, 2.44, 1.44);
  const hpath = [0, 0.2, 0.42, 0.64, 0.84, 1].map((t) => {
    const p = poll.clone().lerp(nose, t);
    p.y += Math.sin(t * Math.PI) * 0.05; // slight dish to the face
    return p;
  });
  tube(head, hpath, [
    boxProf(0.215, 0.20, 0.28, 0.26),
    boxProf(0.245, 0.17, 0.35, 0.26),
    boxProf(0.215, 0.14, 0.29, 0.28),
    boxProf(0.175, 0.12, 0.22, 0.3),
    boxProf(0.150, 0.10, 0.17, 0.3),
    boxProf(0.135, 0.085, 0.13, 0.3),
  ], V(0, 1, 0));
  // Cranium block behind the poll, and the brow ridge over the eye.
  stack(head, rrect(1, 1, 0.34), [
    { y: 2.78, sx: 0.20, sz: 0.20, oz: 0.36 },
    { y: 2.92, sx: 0.22, sz: 0.24, oz: 0.42 },
    { y: 3.04, sx: 0.19, sz: 0.20, oz: 0.47 },
  ]);
  for (const s of [-1, 1]) {
    const brow = quatFromAxes(V(1, 0, 0), V(0.1 * s, 0.9, 0.42), V(0, -0.42, 0.9));
    slab(head, V(0.17 * s, 2.905, 0.66), V(0.085, 0.055, 0.15), brow);
    // cheek plate
    const cheek = quatFromAxes(V(1, 0, 0), V(0.2 * s, 0.95, 0.24), V(0, -0.24, 0.97));
    slab(head, V(0.20 * s, 2.76, 0.72), V(0.055, 0.14, 0.19), cheek);
  }
  // Jaw / jowl mass under the cranium.
  stack(head, rrect(1, 1, 0.40), [
    { y: 2.58, sx: 0.17, sz: 0.20, oz: 0.56 },
    { y: 2.72, sx: 0.215, sz: 0.25, oz: 0.55 },
    { y: 2.86, sx: 0.20, sz: 0.22, oz: 0.52 },
  ]);
  body.push(head);

  // Ears — thin stone, the classic thing to lose.
  const ears = new Part();
  ears.detail = d * 0.5;
  ears.thinNow = 1.0;
  for (const s of [-1, 1]) {
    spike(ears, V(0.135 * s, 2.98, 0.40), V(0.16 * s, 3.36, 0.34), 0.075, 0.055, V(0.03 * s, 0, -0.02));
  }
  ears.thinNow = 0;
  body.push(ears);

  // Mane — stepped slabs down the crest. Explicitly slabs, not a smooth ridge.
  const mane = new Part();
  mane.detail = d * 0.6;
  mane.thinNow = 0.5;
  const nm = 9;
  for (let i = 0; i < nm; i++) {
    const t = i / (nm - 1);
    const si = t * (spine.length - 1);
    const i0 = Math.min(spine.length - 2, Math.floor(si));
    const fr = si - i0;
    const c = spine[i0].clone().lerp(spine[i0 + 1], fr);
    const fwd = spine[i0 + 1].clone().sub(spine[i0]).normalize();
    const right = new THREE.Vector3().crossVectors(V(0, 1, 0), fwd).normalize();
    const up2 = new THREE.Vector3().crossVectors(fwd, right).normalize();
    const crest = 0.46 - (si / (spine.length - 1)) * 0.14;
    const proud = 0.075 + 0.075 * Math.sin(t * 2.6 + 0.5) + rng.float(-0.012, 0.012);
    const centre = c.clone().addScaledVector(up2, crest + proud * 0.55);
    centre.addScaledVector(right, rng.float(-0.03, 0.03) + (i % 2 ? 0.022 : -0.022));
    const q = quatFromAxes(right, up2, fwd);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rng.float(-0.22, 0.22)));
    slab(
      mane,
      centre,
      V(0.10 - t * 0.028, proud, 0.115 - t * 0.03),
      q,
    );
  }
  // A forelock slab flopping forward over the poll.
  mane.thinNow = 0.75;
  slab(
    mane,
    V(-0.04, 3.06, 0.52),
    V(0.085, 0.115, 0.075),
    quatFromAxes(V(1, 0, 0.1), V(0.05, 0.9, 0.44), V(-0.1, -0.44, 0.9)),
  );
  mane.thinNow = 0;
  body.push(mane);

  // Forelegs. The near one (+X, the horse's left) is raised and cocked — this is the
  // limb that crosses the top of frame in the low angle, and the thing it strikes with.
  const legs = new Part();
  legs.detail = d * 0.72;
  const standing = [
    V(-0.34, 1.12, 0.44),
    V(-0.36, 0.80, 0.54),
    V(-0.37, 0.48, 0.55),
    V(-0.37, 0.30, 0.54),
    V(-0.37, 0.19, 0.58),
  ];
  tube(legs, standing, [
    rrect(0.20, 0.22, 0.3),
    rrect(0.155, 0.185, 0.3),
    rrect(0.115, 0.135, 0.3),
    rrect(0.115, 0.130, 0.3),
    rrect(0.165, 0.165, 0.28),
  ], V(0, 0, 1));

  const raised = [
    V(0.33, 1.14, 0.46),
    V(0.42, 1.48, 0.82),
    V(0.50, 1.79, 1.14),
    V(0.55, 1.58, 1.33),
    V(0.57, 1.33, 1.32),
    V(0.58, 1.19, 1.29),
  ];
  tube(legs, raised, [
    rrect(0.20, 0.23, 0.3),
    rrect(0.165, 0.195, 0.3),
    rrect(0.145, 0.165, 0.28),
    rrect(0.115, 0.135, 0.3),
    rrect(0.105, 0.125, 0.3),
    rrect(0.155, 0.155, 0.26),
  ], V(1, 0, 0));
  body.push(legs);

  return {
    body,
    arm: null,
    armPivot: V(0, 1.2, 0.4),
    tip: V(0.58, 1.19, 1.30),
    comY: 1.42,
    breaks: [
      { p: V(0.145, 3.22, 0.36), n: V(0.28, 0.90, -0.32), depth: 0.05 },
      { p: V(-0.145, 3.20, 0.36), n: V(-0.30, 0.88, -0.30), depth: 0.05 },
      { p: V(0.10, 2.70, 1.30), n: V(0.55, -0.45, 0.70), depth: 0.06 },
      { p: V(-0.02, 2.42, 0.10), n: V(-0.32, 0.30, -0.90), depth: 0.10 },
      { p: V(0.80, 0.12, -0.30), n: V(0.86, -0.28, -0.42), depth: 0.09 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// PAWN — a squat helmeted footman, short sword held before him.
// ---------------------------------------------------------------------------------------

function pawn(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.25;
  plinth(base, 0.78, 0.78, 0.22, 9, rng);
  body.push(base);

  const torso = new Part();
  torso.detail = d;
  const pr = rrect(1, 1, 0.42);
  stack(torso, pr, [
    { y: 0.16, sx: 0.64, sz: 0.55 },
    { y: 0.52, sx: 0.58, sz: 0.50, oz: 0.02 },
    { y: 0.95, sx: 0.47, sz: 0.42, oz: 0.03 },
    { y: 1.42, sx: 0.45, sz: 0.39, oz: 0.03 },
    { y: 1.62, sx: 0.52, sz: 0.41, oz: 0.02 },
    { y: 1.76, sx: 0.44, sz: 0.35, oz: 0.02 },
  ]);
  body.push(torso);

  const helm = new Part();
  helm.detail = d * 0.62;
  stack(helm, rrect(1, 1, 0.3), [
    { y: 1.72, sx: 0.20, sz: 0.19, oz: 0.03 },
    { y: 1.88, sx: 0.30, sz: 0.30, oz: 0.03 },
    { y: 2.16, sx: 0.31, sz: 0.31, oz: 0.03 },
    { y: 2.32, sx: 0.24, sz: 0.25, oz: 0.02 },
    { y: 2.40, sx: 0.12, sz: 0.14, oz: 0.01 },
  ]);
  // Visor bar and a low crest.
  slab(helm, V(0, 2.03, 0.32), V(0.28, 0.045, 0.045), new THREE.Quaternion());
  helm.thinNow = 0.7;
  spike(helm, V(0, 2.30, 0.02), V(0, 2.56, -0.02), 0.055, 0.11, V(0, 0, -0.02));
  helm.thinNow = 0;
  body.push(helm);

  // Arms + short sword.
  const arm = new Part();
  arm.detail = d * 0.7;
  for (const s of [-1, 1]) {
    tube(arm, [
      V(0.44 * s, 1.58, 0.06),
      V(0.42 * s, 1.30, 0.22),
      V(0.26 * s, 1.16, 0.38),
      V(0.13 * s, 1.14, 0.44),
    ], [
      rrect(0.11, 0.12, 0.3),
      rrect(0.095, 0.105, 0.3),
      rrect(0.085, 0.095, 0.3),
      rrect(0.085, 0.09, 0.3),
    ], V(0, 1, 0));
  }
  slab(arm, V(0, 1.20, 0.46), V(0.10, 0.10, 0.075), new THREE.Quaternion());
  slab(arm, V(0, 1.34, 0.48), V(0.23, 0.045, 0.05), new THREE.Quaternion());
  blade(arm, V(0, 1.30, 0.49), V(0, 0.24, 0.62), 0.115, 0.035);

  return {
    body,
    arm: [arm],
    armPivot: V(0, 1.56, 0.10),
    tip: V(0, 0.24, 0.62),
    comY: 1.00,
    breaks: [
      { p: V(0, 2.46, -0.02), n: V(0.20, 0.85, -0.48), depth: 0.05 },
      { p: V(0.46, 1.62, 0.08), n: V(0.86, 0.42, -0.28), depth: 0.07 },
      { p: V(-0.66, 0.30, -0.20), n: V(-0.88, -0.24, -0.40), depth: 0.08 },
      { p: V(0.28, 2.28, 0.30), n: V(0.52, 0.62, 0.58), depth: 0.06 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// ROOK — a battered tower in visible courses, crenellated, one merlon gone.
// ---------------------------------------------------------------------------------------

function rook(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.3;
  plinth(base, 0.90, 0.90, 0.24, 8, rng);
  body.push(base);

  const shaft = new Part();
  shaft.detail = d * 1.15;
  const sp = rrect(1, 1, 0.26);
  // Six courses, each stepped very slightly proud of the one above: real masonry reads
  // as a stack of blocks, not a cone.
  const courses = 6;
  const st: Station[] = [];
  for (let i = 0; i <= courses; i++) {
    const t = i / courses;
    const y = 0.18 + t * 2.06;
    const s = 0.78 - t * 0.16;
    st.push({ y: y - 0.004, sx: s * 1.022, sz: s * 1.022 });
    st.push({ y, sx: s, sz: s });
  }
  stack(shaft, sp, st);
  body.push(shaft);

  const cor = new Part();
  cor.detail = d * 0.85;
  stack(cor, rrect(1, 1, 0.24), [
    { y: 2.18, sx: 0.63, sz: 0.63 },
    { y: 2.30, sx: 0.80, sz: 0.80 },
    { y: 2.52, sx: 0.82, sz: 0.82 },
    { y: 2.62, sx: 0.76, sz: 0.76 },
  ]);
  body.push(cor);

  const crown = new Part();
  crown.detail = d * 0.62;
  const merlons: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = V(Math.cos(a) * 0.50, 2.86, Math.sin(a) * 0.50);
    merlons.push(c);
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a + Math.PI / 2);
    slab(crown, c, V(0.30, 0.26, 0.19), q);
  }
  // The parapet walk between the merlons.
  stack(crown, rrect(1, 1, 0.24), [
    { y: 2.58, sx: 0.72, sz: 0.72 },
    { y: 2.74, sx: 0.70, sz: 0.70 },
  ]);
  body.push(crown);

  const pick = rng.int(0, 4);
  const bm = merlons[pick];
  const dir = bm.clone().setY(0).normalize();

  return {
    body,
    arm: null,
    armPivot: V(0, 1.6, 0.5),
    tip: V(0, 2.9, 0.7),
    comY: 1.20,
    breaks: [
      { p: bm.clone().add(V(0, 0.06, 0)), n: dir.clone().add(V(0, 0.55, 0)).normalize(), depth: 0.10 },
      { p: merlons[(pick + 2) % 4].clone().add(V(0, 0.16, 0)), n: V(0, 1, 0.25).normalize(), depth: 0.05 },
      { p: V(0.86, 0.14, 0.42), n: V(0.80, -0.34, 0.50), depth: 0.09 },
      { p: V(-0.70, 1.20, -0.62), n: V(-0.72, 0.10, -0.68), depth: 0.07 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// BISHOP — a hooded figure. The cowl is a genuine cavity; the face is a void.
// ---------------------------------------------------------------------------------------

function bishop(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.25;
  plinth(base, 0.80, 0.80, 0.22, 12, rng);
  body.push(base);

  const robe = new Part();
  robe.detail = d;
  // Vertical folds: alternate radii round a 12-gon.
  const folds = jitArr(12, rng, 0.0).map((_, i) => (i % 2 ? 0.93 : 1.06));
  const rp = ngon(12, 1, 1, 0.13, folds);
  stack(robe, rp, [
    { y: 0.16, sx: 0.70, sz: 0.62 },
    { y: 0.70, sx: 0.62, sz: 0.55, oz: 0.02 },
    { y: 1.50, sx: 0.52, sz: 0.47, oz: 0.04 },
    { y: 2.20, sx: 0.44, sz: 0.41, oz: 0.05 },
    { y: 2.62, sx: 0.47, sz: 0.43, oz: 0.04 },
    { y: 2.86, sx: 0.42, sz: 0.38, oz: 0.03 },
  ]);
  body.push(robe);

  const cowl = new Part();
  cowl.detail = d * 0.6;
  const cr = crescent(1, 0.60, 108, 7);
  stack(cowl, cr, [
    { y: 2.78, sx: 0.40, sz: 0.40, oz: 0.04 },
    { y: 3.02, sx: 0.42, sz: 0.42, oz: 0.05 },
    { y: 3.24, sx: 0.36, sz: 0.36, oz: 0.05 },
    { y: 3.40, sx: 0.25, sz: 0.25, oz: 0.04 },
  ], true, true);
  // The mitre point above the cowl.
  cowl.thinNow = 0.6;
  spike(cowl, V(0, 3.30, 0.02), V(0, 3.62, 0.10), 0.13, 0.13, V(0, 0, 0.03));
  cowl.thinNow = 0;
  // The head inside the hood, set well back so the cowl reads as shadow.
  stack(cowl, rrect(1, 1, 0.34), [
    { y: 2.86, sx: 0.15, sz: 0.14, oz: -0.02 },
    { y: 3.06, sx: 0.17, sz: 0.16, oz: -0.02 },
    { y: 3.22, sx: 0.13, sz: 0.13, oz: -0.02 },
  ]);
  body.push(cowl);

  // Crozier — a long staff with a crook, held at the piece's right.
  const arm = new Part();
  arm.detail = d * 0.65;
  tube(arm, [
    V(-0.40, 2.58, 0.10),
    V(-0.50, 2.36, 0.26),
    V(-0.55, 2.22, 0.34),
  ], [
    rrect(0.11, 0.12, 0.3),
    rrect(0.10, 0.11, 0.3),
    rrect(0.095, 0.10, 0.3),
  ], V(0, 1, 0));
  tube(arm, [
    V(-0.57, 0.22, 0.40),
    V(-0.57, 1.20, 0.38),
    V(-0.57, 2.20, 0.36),
    V(-0.57, 3.02, 0.34),
    V(-0.56, 3.34, 0.34),
  ], [
    rrect(0.075, 0.075, 0.3),
    rrect(0.065, 0.065, 0.3),
    rrect(0.062, 0.062, 0.3),
    rrect(0.060, 0.060, 0.3),
    rrect(0.058, 0.058, 0.3),
  ], V(0, 0, 1));
  arm.thinNow = 0.55;
  tube(arm, [
    V(-0.56, 3.34, 0.34),
    V(-0.56, 3.52, 0.42),
    V(-0.56, 3.56, 0.60),
    V(-0.56, 3.44, 0.70),
    V(-0.56, 3.32, 0.64),
  ], [
    rrect(0.058, 0.058, 0.3),
    rrect(0.056, 0.056, 0.3),
    rrect(0.052, 0.052, 0.3),
    rrect(0.046, 0.046, 0.3),
    rrect(0.036, 0.036, 0.3),
  ], V(1, 0, 0));
  arm.thinNow = 0;

  return {
    body,
    arm: [arm],
    armPivot: V(-0.40, 2.58, 0.12),
    tip: V(-0.56, 3.36, 0.66),
    comY: 1.42,
    breaks: [
      { p: V(0, 3.52, 0.07), n: V(0.34, 0.86, 0.38).normalize(), depth: 0.06 },
      { p: V(0.30, 3.14, 0.36), n: V(0.76, 0.28, 0.58).normalize(), depth: 0.07 },
      { p: V(-0.62, 0.28, -0.22), n: V(-0.84, -0.30, -0.44).normalize(), depth: 0.08 },
      { p: V(0.46, 2.66, -0.24), n: V(0.72, 0.34, -0.60).normalize(), depth: 0.07 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// QUEEN — tall, robed, coronet of points, a slender blade held down.
// ---------------------------------------------------------------------------------------

function queen(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.25;
  plinth(base, 0.86, 0.86, 0.24, 12, rng);
  body.push(base);

  const robe = new Part();
  robe.detail = d;
  const folds = new Array(14).fill(0).map((_, i) => (i % 2 ? 0.94 : 1.05) * (1 + (i % 3 === 0 ? 0.02 : 0)));
  const rp = ngon(14, 1, 0.9, 0.2, folds);
  stack(robe, rp, [
    { y: 0.18, sx: 0.82, sz: 0.78 },
    { y: 0.80, sx: 0.72, sz: 0.68, oz: 0.02 },
    { y: 1.70, sx: 0.60, sz: 0.56, oz: 0.04 },
    { y: 2.44, sx: 0.50, sz: 0.47, oz: 0.05 },
    { y: 2.90, sx: 0.55, sz: 0.49, oz: 0.05 },
    { y: 3.12, sx: 0.48, sz: 0.42, oz: 0.04 },
    { y: 3.24, sx: 0.24, sz: 0.22, oz: 0.04 },
  ]);
  body.push(robe);

  const headP = new Part();
  headP.detail = d * 0.6;
  stack(headP, rrect(1, 1, 0.32), [
    { y: 3.18, sx: 0.16, sz: 0.15, oz: 0.04 },
    { y: 3.36, sx: 0.24, sz: 0.23, oz: 0.05 },
    { y: 3.62, sx: 0.25, sz: 0.24, oz: 0.05 },
    { y: 3.76, sx: 0.20, sz: 0.20, oz: 0.04 },
  ]);
  // Coronet band + points.
  stack(headP, ngon(9, 1, 1, 0.1), [
    { y: 3.60, sx: 0.27, sz: 0.26, oz: 0.05 },
    { y: 3.80, sx: 0.28, sz: 0.27, oz: 0.05 },
  ]);
  headP.thinNow = 0.85;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.22;
    const bx = Math.cos(a) * 0.21, bz = Math.sin(a) * 0.20 + 0.05;
    spike(headP, V(bx, 3.74, bz), V(bx * 1.25, 4.16, bz * 1.25 + 0.01), 0.055, 0.05, V(bx * 0.1, 0, bz * 0.1));
  }
  headP.thinNow = 0;
  body.push(headP);

  const arm = new Part();
  arm.detail = d * 0.68;
  for (const s of [-1, 1]) {
    tube(arm, [
      V(0.46 * s, 2.82, 0.10),
      V(0.48 * s, 2.42, 0.26),
      V(0.30 * s, 2.16, 0.44),
      V(0.14 * s, 2.10, 0.52),
    ], [
      rrect(0.115, 0.125, 0.3),
      rrect(0.10, 0.11, 0.3),
      rrect(0.09, 0.10, 0.3),
      rrect(0.085, 0.095, 0.3),
    ], V(0, 1, 0));
  }
  slab(arm, V(0, 2.16, 0.55), V(0.11, 0.11, 0.08), new THREE.Quaternion());
  slab(arm, V(0, 2.30, 0.56), V(0.30, 0.05, 0.055), new THREE.Quaternion());
  blade(arm, V(0, 2.26, 0.57), V(0, 0.42, 0.80), 0.135, 0.04);

  return {
    body,
    arm: [arm],
    armPivot: V(0, 2.80, 0.12),
    tip: V(0, 0.42, 0.80),
    comY: 1.72,
    breaks: [
      { p: V(0.21, 4.02, 0.09), n: V(0.62, 0.66, 0.42).normalize(), depth: 0.05 },
      { p: V(-0.14, 4.00, 0.28), n: V(-0.42, 0.68, 0.60).normalize(), depth: 0.05 },
      { p: V(0.62, 2.92, -0.20), n: V(0.80, 0.30, -0.52).normalize(), depth: 0.07 },
      { p: V(-0.74, 0.30, -0.28), n: V(-0.84, -0.28, -0.46).normalize(), depth: 0.09 },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// KING — broadest, heaviest, a blocky crown and a great sword he can let fall.
// ---------------------------------------------------------------------------------------

function king(rng: Rng, d: number): FormResult {
  const body: Part[] = [];
  const base = new Part();
  base.detail = d * 1.3;
  plinth(base, 0.94, 0.94, 0.26, 12, rng);
  body.push(base);

  const robe = new Part();
  robe.detail = d * 1.05;
  const folds = new Array(12).fill(0).map((_, i) => (i % 2 ? 0.95 : 1.06));
  const rp = ngon(12, 1, 0.94, 0.26, folds);
  stack(robe, rp, [
    { y: 0.20, sx: 0.90, sz: 0.84 },
    { y: 1.00, sx: 0.80, sz: 0.74, oz: 0.02 },
    { y: 2.00, sx: 0.68, sz: 0.62, oz: 0.04 },
    { y: 2.76, sx: 0.60, sz: 0.55, oz: 0.05 },
    { y: 3.10, sx: 0.68, sz: 0.58, oz: 0.05 },
    { y: 3.34, sx: 0.72, sz: 0.58, oz: 0.04 },
    { y: 3.50, sx: 0.52, sz: 0.44, oz: 0.03 },
  ]);
  body.push(robe);

  const mantle = new Part();
  mantle.detail = d * 0.8;
  // Square mantle over the shoulders — reads as mass at a distance.
  stack(mantle, rrect(1, 1, 0.22), [
    { y: 2.94, sx: 0.58, sz: 0.50, oz: 0.04 },
    { y: 3.18, sx: 0.78, sz: 0.58, oz: 0.04 },
    { y: 3.36, sx: 0.74, sz: 0.55, oz: 0.03 },
  ]);
  body.push(mantle);

  const headP = new Part();
  headP.detail = d * 0.6;
  stack(headP, rrect(1, 1, 0.30), [
    { y: 3.40, sx: 0.20, sz: 0.19, oz: 0.04 },
    { y: 3.58, sx: 0.28, sz: 0.27, oz: 0.05 },
    { y: 3.88, sx: 0.29, sz: 0.28, oz: 0.05 },
    { y: 4.02, sx: 0.23, sz: 0.23, oz: 0.04 },
  ]);
  stack(headP, rrect(1, 1, 0.22), [
    { y: 3.84, sx: 0.32, sz: 0.31, oz: 0.05 },
    { y: 4.10, sx: 0.335, sz: 0.325, oz: 0.05 },
    { y: 4.16, sx: 0.31, sz: 0.30, oz: 0.05 },
  ]);
  headP.thinNow = 0.7;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.35;
    const bx = Math.cos(a) * 0.26, bz = Math.sin(a) * 0.25 + 0.05;
    spike(headP, V(bx, 4.08, bz), V(bx * 1.1, 4.42, bz * 1.1), 0.085, 0.075, V(0, 0, 0));
  }
  headP.thinNow = 0;
  // Finial.
  stack(headP, rrect(1, 1, 0.3), [
    { y: 4.12, sx: 0.10, sz: 0.10, oz: 0.05 },
    { y: 4.42, sx: 0.075, sz: 0.075, oz: 0.05 },
    { y: 4.50, sx: 0.13, sz: 0.055, oz: 0.05 },
    { y: 4.56, sx: 0.10, sz: 0.045, oz: 0.05 },
  ]);
  body.push(headP);

  // Hands stay with the body; the sword is its own node so it can be released.
  const hands = new Part();
  hands.detail = d * 0.7;
  for (const s of [-1, 1]) {
    tube(hands, [
      V(0.56 * s, 3.06, 0.10),
      V(0.58 * s, 2.66, 0.30),
      V(0.34 * s, 2.42, 0.52),
      V(0.15 * s, 2.38, 0.62),
    ], [
      rrect(0.135, 0.15, 0.3),
      rrect(0.12, 0.13, 0.3),
      rrect(0.105, 0.115, 0.3),
      rrect(0.10, 0.11, 0.3),
    ], V(0, 1, 0));
  }
  body.push(hands);

  const sword = new Part();
  sword.detail = d * 0.6;
  slab(sword, V(0, 2.44, 0.66), V(0.10, 0.20, 0.075), new THREE.Quaternion());
  slab(sword, V(0, 2.68, 0.67), V(0.11, 0.075, 0.085), new THREE.Quaternion());
  slab(sword, V(0, 2.62, 0.67), V(0.42, 0.055, 0.07), new THREE.Quaternion());
  blade(sword, V(0, 2.56, 0.68), V(0, 0.30, 0.88), 0.19, 0.05);

  return {
    body,
    arm: [sword],
    armPivot: V(0, 2.66, 0.67),
    tip: V(0, 0.30, 0.88),
    comY: 1.90,
    breaks: [
      { p: V(0.26, 4.32, 0.14), n: V(0.62, 0.64, 0.45).normalize(), depth: 0.06 },
      { p: V(0.74, 3.28, 0.40), n: V(0.66, 0.28, 0.70).normalize(), depth: 0.08 },
      { p: V(-0.80, 0.32, -0.30), n: V(-0.82, -0.30, -0.48).normalize(), depth: 0.10 },
      { p: V(-0.30, 4.34, -0.22), n: V(-0.52, 0.66, -0.54).normalize(), depth: 0.06 },
    ],
  };
}

const BUILDERS: Record<PieceType, (rng: Rng, d: number) => FormResult> = {
  pawn,
  knight,
  bishop,
  rook,
  queen,
  king,
};

export function buildForm(type: PieceType, rng: Rng, detail: number): FormResult {
  return BUILDERS[type](rng, detail);
}
