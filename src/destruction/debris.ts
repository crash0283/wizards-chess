/**
 * PIECE: destruction — weight.
 *
 * Everything about how the wreckage moves has to say "this is a ton of stone": full
 * gravity at true metre scale, almost no bounce, a lot of tumble, and a hard stop.
 * The integrator is a single-body solver with real contact points taken from each
 * fragment's own hull, which is what makes a block land on a corner, rock down onto a
 * face and stay there instead of sliding about like a puck.
 *
 * Debris that has come to rest is stamped into a height field, so the next fragment
 * lands ON the pile rather than through it. That is what builds a heap that leans
 * against itself, and it is why the wreckage of nine captures accumulates into
 * something with shape by the time the king surrenders.
 *
 * Torn fabric is the same solver with different numbers: light, heavily damped,
 * fluttering, and it comes to rest draped rather than stacked.
 */
import * as THREE from 'three';

export type BodyKind = 'stone' | 'fabric';

export interface Body {
  kind: BodyKind;
  object: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  omega: THREE.Vector3;
  /** Hull points relative to the centroid. */
  support: Float32Array;
  radius: number;
  mass: number;
  invI: number;
  restitution: number;
  friction: number;
  drag: number;
  angDrag: number;
  /** Fabric only: how strongly it sails. */
  flutter: number;
  phase: number;
  sleeping: boolean;
  contact: number;
  /** Total time spent touching anything — a body cannot roll for ever. */
  touching: number;
  age: number;
}

const G = 9.81;
/** Stone density, kg/m³ — a limestone chessman fragment really is this heavy. */
const DENSITY = 2400;
/** Nothing is allowed to keep moving past this, so `settled()` always resolves. */
const MAX_AGE = 3.0;

export interface Ground {
  /** Height of the rest surface (board or existing rubble) under a point. */
  heightAt(x: number, z: number): number;
  /** Surface normal of the rubble pile, for debris that lands on debris. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Record a body that has come to rest. */
  stamp(x: number, z: number, radius: number, top: number): void;
}

/** Tallest a heap of rubble is allowed to get, metres above the marble. */
const PILE_CAP = 0.75;

/** A coarse height field over the whole board, in world XZ. */
export function createGround(topY: number): Ground {
  const CELL = 0.16;
  const EXTENT = 26;
  const N = Math.ceil(EXTENT / CELL);
  const half = N / 2;
  const h = new Float32Array(N * N);
  const idx = (ix: number, iz: number) => iz * N + ix;
  const cellOf = (v: number) => Math.floor(v / CELL + half);

  const heightAt = (x: number, z: number) => {
    const ix = cellOf(x), iz = cellOf(z);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return topY;
    return topY + h[idx(ix, iz)];
  };

  return {
    heightAt,
    normalAt(x, z, out) {
      const e = CELL;
      const dx = heightAt(x + e, z) - heightAt(x - e, z);
      const dz = heightAt(x, z + e) - heightAt(x, z - e);
      // Clamped: a heap is not a cliff, and a near-vertical contact normal makes
      // fragments shoot sideways off the pile.
      return out.set(-dx * 0.5, 2 * e, -dz * 0.5).normalize().lerp(UP, 0.35).normalize();
    },
    stamp(x, z, radius, top) {
      // Only real blocks hold anything up, and a heap does not ratchet: each body records
      // rather less than its own height, and the field is capped. Stamping the full top
      // of everything lets one pile lift the next body, and the next, until debris is
      // hovering half a metre off the marble.
      if (radius < 0.07) return;
      top = Math.min(top, topY + PILE_CAP);
      const r = Math.max(CELL, radius * 0.78);
      const i0 = cellOf(x - r), i1 = cellOf(x + r);
      const j0 = cellOf(z - r), j1 = cellOf(z + r);
      for (let iz = j0; iz <= j1; iz++) {
        if (iz < 0 || iz >= N) continue;
        for (let ix = i0; ix <= i1; ix++) {
          if (ix < 0 || ix >= N) continue;
          const cx = (ix - half + 0.5) * CELL, cz = (iz - half + 0.5) * CELL;
          const d = Math.hypot(cx - x, cz - z);
          if (d > r) continue;
          // Domed, so a pile grows a shape rather than a plateau.
          const k = Math.sqrt(Math.max(0, 1 - (d / r) * (d / r)));
          const want = (top - topY) * 0.72 * (0.30 + 0.70 * k);
          if (want > h[idx(ix, iz)]) h[idx(ix, iz)] = want;
        }
      }
    },
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _dq = new THREE.Quaternion();

export function makeBody(opts: {
  kind: BodyKind;
  object: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  omega: THREE.Vector3;
  support: Float32Array;
  radius: number;
  volume: number;
  phase: number;
}): Body {
  const stone = opts.kind === 'stone';
  const mass = stone
    ? Math.max(0.35, opts.volume * DENSITY)
    : Math.max(0.06, opts.volume * 240 + 0.10);
  return {
    kind: opts.kind,
    object: opts.object,
    pos: opts.pos.clone(),
    quat: opts.quat.clone(),
    vel: opts.vel.clone(),
    omega: opts.omega.clone(),
    support: opts.support,
    radius: opts.radius,
    mass,
    invI: 1 / Math.max(1e-4, 0.42 * mass * opts.radius * opts.radius),
    restitution: stone ? 0.13 : 0.02,
    friction: stone ? 0.85 : 0.95,
    // Stone this size does not care about air. Cloth cares about nothing else.
    drag: stone ? 0.06 : 2.35,
    angDrag: stone ? 0.30 : 2.10,
    flutter: stone ? 0 : 1,
    phase: opts.phase,
    sleeping: false,
    contact: 0,
    touching: 0,
    age: 0,
  };
}

/** One deterministic step. `dt` is fixed under capture, so this is a pure function. */
export function stepBody(b: Body, dt: number, ground: Ground): void {
  if (b.sleeping) return;
  b.age += dt;

  if (b.kind === 'fabric') {
    // Cloth sails: a slow swim across the fall, plus a wobble about its own plane.
    const a = b.age * 3.1 + b.phase;
    b.vel.x += Math.sin(a) * 1.9 * dt * b.flutter;
    b.vel.z += Math.cos(a * 0.83 + 1.7) * 1.9 * dt * b.flutter;
    b.omega.x += Math.sin(a * 1.7 + b.phase) * 2.2 * dt;
    b.omega.z += Math.cos(a * 1.3) * 2.2 * dt;
  }

  b.vel.y -= G * dt;
  const damp = Math.max(0, 1 - b.drag * dt);
  b.vel.multiplyScalar(damp);
  b.omega.multiplyScalar(Math.max(0, 1 - b.angDrag * dt));
  b.pos.addScaledVector(b.vel, dt);

  // Exponential-map orientation integration.
  const w = b.omega.length();
  if (w > 1e-6) {
    _dq.setFromAxisAngle(_n.copy(b.omega).multiplyScalar(1 / w), w * dt);
    b.quat.premultiply(_dq).normalize();
  }

  // --- contact: the deepest few hull points against the rest surface ------------------
  let touched = false;
  let leverX = 0, leverZ = 0;
  for (let pass = 0; pass < 4; pass++) {
    let worst = 0;
    let gap = Infinity;
    let wx = 0, wy = 0, wz = 0;
    for (let i = 0; i < b.support.length; i += 3) {
      _p.set(b.support[i], b.support[i + 1], b.support[i + 2]).applyQuaternion(b.quat);
      const y = b.pos.y + _p.y;
      const gy = ground.heightAt(b.pos.x + _p.x, b.pos.z + _p.z);
      const pen = gy - y;
      if (pen > worst) {
        worst = pen; wx = _p.x; wy = _p.y; wz = _p.z;
      }
      if (-pen < gap) gap = -pen;
    }
    if (worst <= 1e-4) {
      // Resting exactly on the surface is contact too. Without this a body that the
      // solver has pushed flush reports "not touching" for ever and never sleeps, and
      // `settled()` never comes true.
      if (gap < 0.006) touched = true;
      break;
    }
    touched = true;
    if (pass === 0) { leverX = -wx; leverZ = -wz; }

    ground.normalAt(b.pos.x + wx, b.pos.z + wz, _n);
    // Push out of the surface, but only partly and never far. A full positional
    // correction every pass is free energy: a spinning fragment gets lifted by its own
    // contact and climbs the pile instead of settling into it.
    b.pos.y += Math.min(worst * (pass === 0 ? 0.8 : 0.5), 0.03);

    _rn.set(wx, wy, wz);
    _vc.copy(b.vel).add(_tan.copy(b.omega).cross(_rn));
    const vn = _vc.dot(_n);
    if (vn < 0) {
      const rxn = _imp.copy(_rn).cross(_n);
      const denom = 1 / b.mass + rxn.lengthSq() * b.invI;
      const e = Math.abs(vn) < 0.7 ? 0 : b.restitution;
      const j = (-(1 + e) * vn) / denom;
      b.vel.addScaledVector(_n, j / b.mass);
      b.omega.addScaledVector(_imp.copy(_rn).cross(_tan.copy(_n).multiplyScalar(j)), b.invI);

      // Friction, on the tangential part of the contact velocity.
      _tan.copy(_vc).addScaledVector(_n, -vn);
      const vt = _tan.length();
      if (vt > 1e-4) {
        _tan.multiplyScalar(-1 / vt);
        const rxt = _vc.copy(_rn).cross(_tan);
        const dent = 1 / b.mass + rxt.lengthSq() * b.invI;
        const jt = Math.min((b.friction * j), vt / dent);
        b.vel.addScaledVector(_tan, jt / b.mass);
        b.omega.addScaledVector(_imp.copy(_rn).cross(_vc.copy(_tan).multiplyScalar(jt)), b.invI);
      }
      // Stone landing on stone loses most of its spin instantly. This is the single
      // number that decides whether the rubble reads as rock or as dice.
      b.omega.multiplyScalar(b.kind === 'stone' ? 0.62 : 0.45);
      b.vel.multiplyScalar(0.9);
    }
  }

  // Toppling. A block that lands on a corner is standing on a lever with its own weight
  // on the end of it, and it falls onto a face — that is most of what "heavy" looks like
  // as debris settles. Without this term the solver happily parks shards on their points
  // and the heap reads as scattered confetti.
  if (touched) {
    // Resting friction. Stone dropped on marble does not skate: once it is down it
    // grinds to a halt in a few centimetres, and it stops spinning at the same time.
    const kv = Math.max(0, 1 - 3.5 * dt);
    b.vel.x *= kv;
    b.vel.z *= kv;
    b.omega.multiplyScalar(Math.max(0, 1 - 5.0 * dt));
    const h = Math.hypot(leverX, leverZ);
    // Only while it is still nearly still: a fragment that is already tumbling does not
    // need help, and driving it further is how a contact solver invents energy.
    const calm = Math.max(0, 1 - b.omega.length() * 0.6);
    if (h > 0.015 && calm > 0) {
      const k = G * b.mass * b.invI * 0.35 * calm * dt;
      b.omega.x += leverZ * k;
      b.omega.z -= leverX * k;
      const w2 = b.omega.lengthSq();
      if (w2 > 400) b.omega.multiplyScalar(20 / Math.sqrt(w2));
    }
  }

  const slow = b.vel.lengthSq() < 0.020 && b.omega.lengthSq() < 0.95;
  if (touched) b.touching += dt;
  if (touched && slow) b.contact += dt;
  else if (!touched) b.contact = 0;

  // Down and still, or down and out of momentum: either way it is finished. The second
  // test is what stops a fragment creeping across the marble for the rest of the game.
  if ((touched && b.contact > 0.22) || b.touching > 0.85 || b.age > MAX_AGE) {
    sleep(b, ground);
  }
}

function sleep(b: Body, ground: Ground): void {
  b.sleeping = true;
  b.vel.set(0, 0, 0);
  b.omega.set(0, 0, 0);
  // Settle it exactly onto the surface it is touching.
  let lowest = Infinity;
  let top = -Infinity;
  for (let i = 0; i < b.support.length; i += 3) {
    _p.set(b.support[i], b.support[i + 1], b.support[i + 2]).applyQuaternion(b.quat);
    const gy = ground.heightAt(b.pos.x + _p.x, b.pos.z + _p.z);
    lowest = Math.min(lowest, b.pos.y + _p.y - gy);
    top = Math.max(top, _p.y);
  }
  if (Number.isFinite(lowest)) b.pos.y -= lowest;
  ground.stamp(b.pos.x, b.pos.z, b.radius, b.pos.y + top);
  apply(b);
}

/** Push a body's state onto its scene object. */
export function apply(b: Body): void {
  b.object.position.copy(b.pos);
  b.object.quaternion.copy(b.quat);
}
