/**
 * PIECE: pieces — motion. Stone does not glide and stone does not bounce.
 *
 * walkTo   a shove-off, a stick-slip grind (the piece rocks onto alternating base edges
 *          and drags), a dead stop, and a short heavy settle. Never a smooth lerp.
 * strike   windup onto the back edge, a committed rotation of the whole body plus a
 *          forward lunge — the promise resolves on the frame the weapon arrives.
 *          Centre of mass travels well past 15% of the piece's height.
 * surrender the king's blade drops out of his hands, the point takes the floor, and the
 *          hilt topples over. It lands dead: no bounce.
 *
 * TWO PATHS, and the split matters.
 *
 * FILM (`rig.interactive === false`, i.e. `world.capturing === true`) is everything below
 * that is not marked `play`. It is frozen. `piece-mid-strike` is captured at exactly
 * t = STRIKE_CONTACT and `king-surrender` has to keep returning the same md5, so the
 * numbers, the phase order and the arithmetic in the film branches must not move. Its
 * clock is `world.time`.
 *
 * PLAY (`rig.interactive === true`) runs the curves in play.ts instead: C2-continuous
 * travel with the oscillators enveloped to zero at both ends, a piece that turns to face
 * where it is going, a strike with real anticipation and follow-through, and a victim that
 * flinches before it is hit. Its clock is `world.realTime`, because a person is watching
 * it and `world.time` runs behind the wall clock on a slow frame.
 *
 * Both paths are pure functions of the time handed in. Nothing reads a clock, nothing
 * counts frames, nothing integrates dt.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import {
  clamp01,
  playReact,
  playStrike,
  playWalk,
  smoother,
  turnDelta,
  PLAY_BRACE,
  PLAY_CONTACT,
  PLAY_STRIKE_TOTAL,
  PLAY_WINDUP,
  type PlayPose,
  type PlayReactPose,
  type PlayStrikePose,
  type PlayStrikeSpec,
  type PlayWalkSpec,
} from './play';

/** Trapezoidal velocity: slow to break loose, steady grind, dead stop. */
const EASE_LUT = (() => {
  const N = 128;
  const v = new Float64Array(N + 1);
  const inA = 0.26, outA = 0.22;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    let s = 1;
    if (p < inA) {
      const k = p / inA;
      s = k * k * (3 - 2 * k) * 0.86 + 0.14 * k;
    } else if (p > 1 - outA) {
      const k = (1 - p) / outA;
      s = k * k * (3 - 2 * k);
    }
    v[i] = s;
  }
  const c = new Float64Array(N + 1);
  let acc = 0;
  for (let i = 1; i <= N; i++) {
    acc += (v[i] + v[i - 1]) * 0.5;
    c[i] = acc;
  }
  for (let i = 0; i <= N; i++) c[i] /= acc;
  return c;
})();

function heavyEase(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const f = p * 128;
  const i = Math.floor(f);
  const t = f - i;
  return EASE_LUT[i] + (EASE_LUT[i + 1] - EASE_LUT[i]) * t;
}

const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

const YAXIS = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);
/** Scratch. The play path runs every frame for every man; it must not allocate. */
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export interface MotionRig {
  group: THREE.Object3D;
  arm: THREE.Object3D | null;
  height: number;
  comY: number;
  baseHalf: number;
  facing: number;
  rng: Rng;
  emit: (event: string, payload: unknown) => void;
  id: string;
  /**
   * True for interactive play (`world.capturing === false`). Selects the play curves and
   * the real-time clock. Leave false and this class behaves exactly as it always has.
   */
  interactive?: boolean;
}

interface Walk {
  kind: 'walk';
  fx: number; fz: number; tx: number; tz: number;
  t0: number; dur: number; settle: number; shoves: number;
  /** Play path only. Null on the film path. */
  spec: PlayWalkSpec | null;
}
interface Strike {
  kind: 'strike';
  t0: number;
  yawDelta: number;
  windup: number; swing: number; hold: number; recover: number;
  lean: number; lunge: number;
  dirX: number; dirZ: number;
  fired: boolean;
  /** Play path only. Null on the film path. */
  spec: PlayStrikeSpec | null;
}
interface Surrender {
  kind: 'surrender';
  t0: number;
}
/** Play path only: the target registering a blow that is about to land on it. */
interface React {
  kind: 'react';
  contactAt: number;
  dirX: number; dirZ: number;
}

type Anim = Walk | Strike | Surrender | React;

interface Blend {
  t0: number; dur: number;
  px: number; py: number; pz: number;
  q: THREE.Quaternion;
  arm: THREE.Quaternion;
  /** The snapshot has the arm off its rest pose, so the arm is still moving. */
  armOff: boolean;
}

export class Motion {
  private rig: MotionRig;
  private anim: Anim | null = null;
  private pending: Array<{ at: number; fn: () => void }> = [];
  /** Resting square position. */
  private baseX = 0;
  private baseZ = 0;
  /** Idle micro-settle phases so a rank of pieces is never in lockstep. */
  private ph: number[];
  private armRest = new THREE.Quaternion();
  private armRestPos = new THREE.Vector3();
  private tipLocal = new THREE.Vector3();
  private hiltLocal = new THREE.Vector3();
  private armSwing: number;

  // --- play path state -------------------------------------------------------------------
  private readonly play: boolean;
  /** Absolute facing right now. On the film path this never leaves `rig.facing`. */
  private face: number;
  /** Where the piece was left when the previous animation was cut short. */
  private blend: Blend | null = null;
  private posed = false;
  private poseQ = new THREE.Quaternion();
  private poseArm = new THREE.Quaternion();
  private posePos = new THREE.Vector3();
  /** Set when an animation ends off its rest facing, so idle can square the piece up. */
  private squareUp: { t0: number; face: number } | null = null;
  private walkPose: PlayPose = { x: 0, y: 0, z: 0, face: 0, pitch: 0, roll: 0, step: -1 };
  private strikePose: PlayStrikePose = { push: 0, face: 0, pitch: 0, roll: 0, arm: 0 };
  private reactPose: PlayReactPose = { shove: 0, lean: 0, tremor: 0 };
  private lastStep = -1;

  constructor(rig: MotionRig, hilt: THREE.Vector3, tip: THREE.Vector3, armSwing: number) {
    this.rig = rig;
    this.play = rig.interactive === true;
    this.face = rig.facing;
    this.ph = [rig.rng.float(0, 6.28), rig.rng.float(0, 6.28), rig.rng.float(0, 6.28)];
    this.hiltLocal.copy(hilt);
    this.tipLocal.copy(tip);
    this.armSwing = armSwing;
    if (rig.arm) {
      this.armRestPos.copy(rig.arm.position);
      this.armRest.copy(rig.arm.quaternion);
    }
    this.poseArm.copy(this.armRest);
  }

  /**
   * True while an animation is driving the arm off its rest pose — the strike, and the
   * mated king's surrender. The low tier bakes arm into body for a single draw call and
   * reads this to know when it has to come apart again.
   *
   * On the play path a cross-fade out of a strike is still moving the arm after the strike
   * itself has been replaced, so the blend counts too.
   */
  armAnimating(): boolean {
    const a = this.anim;
    if (a !== null && (a.kind === 'strike' || a.kind === 'surrender')) return true;
    // A cross-fade out of a strike is still hauling the arm back down after the strike
    // itself has been replaced. A cross-fade that never touched the arm is not.
    return this.blend !== null && this.blend.armOff;
  }

  setSquare(x: number, z: number): void {
    this.baseX = x;
    this.baseZ = z;
    this.anim = null;
    this.pending.length = 0;
    this.blend = null;
    this.squareUp = null;
    this.face = this.rig.facing;
    this.apply(0, 0, 0, 0, 0, 0);
    if (this.rig.arm) {
      this.rig.arm.position.copy(this.armRestPos);
      this.rig.arm.quaternion.copy(this.armRest);
    }
  }

  walkTo(x: number, z: number, seconds: number, now: number): Promise<void> {
    const dist = Math.hypot(x - this.baseX, z - this.baseZ);
    const shoves = Math.max(2, Math.round(dist / 0.62));
    const dur = Math.max(0.35, seconds);

    if (this.play) {
      const dx = x - this.baseX;
      const dz = z - this.baseZ;
      const heading = dist > 1e-4 ? Math.atan2(dx, dz) : this.face;
      const turnBack = Math.abs(turnDelta(heading, this.rig.facing));
      // A stone body cannot pivot instantly, and 180 degrees costs more than 20.
      const turnIn = Math.min(
        dur * 0.60,
        Math.min(0.62, 0.20 + Math.abs(turnDelta(this.face, heading)) * 0.30),
      );
      // The settle is where it squares back up to face the enemy, so it lasts as long as
      // that takes.
      const settle = Math.min(1.0, 0.42 + turnBack * 0.22);
      this.anim = {
        kind: 'walk',
        fx: this.baseX, fz: this.baseZ, tx: x, tz: z,
        t0: now, dur, settle, shoves,
        spec: {
          fx: this.baseX, fz: this.baseZ, tx: x, tz: z,
          dur, settle, shoves,
          baseHalf: this.rig.baseHalf,
          yaw0: this.face, yawTravel: heading, yawRest: this.rig.facing,
          turnIn: Math.max(0.12, turnIn),
          turnOut: Math.max(0.25, Math.min(settle, 0.30 + turnBack * 0.26)),
          ph: this.ph,
        },
      };
      this.startBlend(now, 0.28);
      this.lastStep = -1;
      this.baseX = x;
      this.baseZ = z;
      return new Promise<void>((res) => {
        this.pending.push({ at: now + dur + settle, fn: res });
      });
    }

    const settle = 0.55;
    this.anim = {
      kind: 'walk',
      fx: this.baseX, fz: this.baseZ, tx: x, tz: z,
      t0: now, dur, settle, shoves,
      spec: null,
    };
    this.baseX = x;
    this.baseZ = z;
    return new Promise<void>((res) => {
      this.pending.push({ at: now + Math.max(0.35, seconds) + settle, fn: res });
    });
  }

  strike(tx: number, tz: number, now: number): Promise<void> {
    const dx = tx - this.baseX;
    const dz = tz - this.baseZ;
    const want = Math.atan2(dx, dz);
    const len = Math.hypot(dx, dz) || 1;

    if (this.play) {
      const delta = Math.abs(turnDelta(this.face, want));
      this.anim = {
        kind: 'strike',
        t0: now,
        yawDelta: turnDelta(this.face, want),
        windup: 0, swing: 0, hold: 0, recover: 0,
        lean: 0.34,
        lunge: this.rig.height * 0.12,
        dirX: dx / len, dirZ: dz / len,
        fired: false,
        spec: {
          // It is looking straight at what it is about to hit before the blade moves —
          // the film path only turns 78% of the way, which reads as a glance.
          yaw0: this.face, yawTarget: want,
          // Squared onto the victim before the wind-up finishes loading, always.
          turnIn: Math.max(0.12, Math.min(PLAY_WINDUP * 0.85, 0.14 + delta * 0.30)),
          lean: 0.34,
          lunge: this.rig.height * 0.12,
          armSwing: this.armSwing,
          ph: this.ph,
        },
      };
      this.startBlend(now, 0.22);
      return new Promise<void>((res) => {
        this.pending.push({ at: now + PLAY_CONTACT, fn: res });
      });
    }

    let dy = want - this.rig.facing;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    // A thrust, not a swing: the reference shows the attacker driving the blade straight
    // through with the arm fully out and the whole body committed behind it.
    const windup = 0.58, swing = 0.24, hold = 0.20, recover = 1.00;
    this.anim = {
      kind: 'strike',
      t0: now,
      yawDelta: dy * 0.78,
      windup, swing, hold, recover,
      // 0.32 rad of body rotation about the base plus a 12%-of-height lunge puts the
      // centre of mass roughly 25% of the piece's height from rest — well past the 15%
      // the brief demands, and it looks like weight rather than a gesture.
      lean: 0.32,
      lunge: this.rig.height * 0.12,
      dirX: dx / len, dirZ: dz / len,
      fired: false,
      spec: null,
    };
    return new Promise<void>((res) => {
      this.pending.push({ at: now + windup + swing, fn: res });
    });
  }

  /**
   * PLAY ONLY. Tell this piece a blade is on its way and when it lands, so it can be seen
   * registering the blow rather than standing perfectly still until it explodes. `dirX/dirZ`
   * point from the attacker to here — the way the blow shoves it.
   *
   * No-op on the film path, and no-op if the piece is busy doing something of its own.
   */
  braceFor(contactAt: number, dirX: number, dirZ: number): void {
    if (!this.play) return;
    if (this.anim !== null && this.anim.kind !== 'react') return;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.anim = { kind: 'react', contactAt, dirX: dirX / len, dirZ: dirZ / len };
  }

  surrender(now: number): Promise<void> {
    this.anim = { kind: 'surrender', t0: now };
    return new Promise<void>((res) => {
      this.pending.push({ at: now + 2.05, fn: res });
    });
  }

  /** Distance the centre of mass currently sits from its rest position, in metres. */
  comDisplacement(): number {
    const g = this.rig.group;
    const p = new THREE.Vector3(0, this.rig.comY, 0).applyQuaternion(g.quaternion);
    p.x += g.position.x - this.baseX;
    p.z += g.position.z - this.baseZ;
    p.y += g.position.y;
    return Math.hypot(p.x, p.y - this.rig.comY, p.z);
  }

  private apply(dx: number, dy: number, dz: number, pitch: number, yaw: number, roll: number): void {
    const g = this.rig.group;
    g.position.set(this.baseX + dx, dy, this.baseZ + dz);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rig.facing + yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    g.quaternion.copy(q);
  }

  // --- play path plumbing -----------------------------------------------------------------

  /**
   * Snapshot the pose so the animation starting now can be cross-faded out of it.
   *
   * Without this, ordering a walk while a strike is still following through snaps the piece
   * upright and the arm back to its side in one frame — which is exactly the kind of thing
   * that reads as a token rather than as stone.
   */
  private startBlend(now: number, dur: number): void {
    if (!this.posed) return;
    const b: Blend = this.blend ?? {
      t0: 0, dur: 0,
      px: 0, py: 0, pz: 0,
      q: new THREE.Quaternion(),
      arm: new THREE.Quaternion(),
      armOff: false,
    };
    b.t0 = now;
    b.dur = dur;
    b.px = this.posePos.x; b.py = this.posePos.y; b.pz = this.posePos.z;
    b.q.copy(this.poseQ);
    b.arm.copy(this.poseArm);
    b.armOff = Math.abs(b.arm.dot(this.armRest)) < 0.99995;
    this.blend = b;
  }

  /**
   * Write an absolute play pose, cross-fading out of whatever the piece was doing before.
   * `face` is an absolute heading, not an offset from rest.
   */
  private place(
    t: number,
    x: number, y: number, z: number,
    face: number, pitch: number, roll: number,
    arm: number,
  ): void {
    const q = this.poseQ;
    q.setFromAxisAngle(YAXIS, face);
    q.multiply(_qa.setFromAxisAngle(XAXIS, pitch));
    q.multiply(_qb.setFromAxisAngle(ZAXIS, roll));
    this.posePos.set(x, y, z);
    this.poseArm.copy(this.armRest);
    if (arm !== 0) this.poseArm.multiply(_qa.setFromAxisAngle(XAXIS, arm));

    const b = this.blend;
    if (b) {
      const k = smoother(clamp01((t - b.t0) / b.dur));
      if (k >= 1) {
        this.blend = null;
      } else {
        this.posePos.set(
          b.px + (x - b.px) * k,
          b.py + (y - b.py) * k,
          b.pz + (z - b.pz) * k,
        );
        _qa.copy(b.q).slerp(q, k);
        q.copy(_qa);
        _qb.copy(b.arm).slerp(this.poseArm, k);
        this.poseArm.copy(_qb);
      }
    }

    this.rig.group.position.copy(this.posePos);
    this.rig.group.quaternion.copy(q);
    if (this.rig.arm) this.rig.arm.quaternion.copy(this.poseArm);
    this.face = face;
    this.posed = true;
  }

  /**
   * An animation has run out. Cross-fade whatever residue it left into rest rather than
   * cutting to rest, and remember the facing so idle can square the piece up.
   */
  private finish(t: number): void {
    this.anim = null;
    this.startBlend(t, 0.18);
    if (Math.abs(turnDelta(this.face, this.rig.facing)) > 1e-4) {
      this.squareUp = { t0: t, face: this.face };
    }
  }

  update(t: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (t >= this.pending[i].at) {
        const fn = this.pending[i].fn;
        this.pending.splice(i, 1);
        fn();
      }
    }

    const a = this.anim;
    if (!a) {
      // Absolute stillness apart from an imperceptible creak — enough that a held frame
      // is not mathematically frozen, far too small to read as motion.
      const k = 0.00035;
      const pitch = Math.sin(t * 0.7 + this.ph[0]) * k;
      const roll = Math.sin(t * 0.53 + this.ph[1]) * k;
      if (!this.play) {
        this.apply(0, 0, 0, pitch, 0, roll);
        return;
      }
      let face = this.rig.facing;
      const su = this.squareUp;
      if (su) {
        const p = clamp01((t - su.t0) / 0.85);
        if (p >= 1) this.squareUp = null;
        face = su.face + turnDelta(su.face, this.rig.facing) * smoother(p);
      }
      this.place(t, this.baseX, 0, this.baseZ, face, pitch, roll, 0);
      return;
    }

    if (a.kind === 'walk') {
      if (a.spec) {
        this.playWalkFrame(t, a, a.spec);
        return;
      }
      const raw = (t - a.t0) / a.dur;
      if (raw >= 1) {
        const s = t - a.t0 - a.dur;
        if (s > a.settle) {
          this.anim = null;
          this.apply(0, 0, 0, 0, 0, 0);
          return;
        }
        const decay = Math.exp(-s * 8.5);
        this.apply(
          0, 0, 0,
          Math.sin(s * 27 + this.ph[0]) * 0.016 * decay,
          Math.sin(s * 19 + this.ph[2]) * 0.006 * decay,
          Math.sin(s * 33 + this.ph[1]) * 0.013 * decay,
        );
        return;
      }
      const p = raw < 0 ? 0 : raw;
      const e = heavyEase(p);
      const n = a.shoves;
      const phase = Math.PI * 2 * n * e + this.ph[0];
      // Stick–slip: the piece grinds forward in shoves rather than sliding.
      const slip = e - (0.85 * Math.sin(phase)) / (Math.PI * 2 * n);
      const env = smooth(p / 0.12) * smooth((1 - p) / 0.10);
      const roll = Math.sin(phase) * 0.030 * env;
      const pitch = -Math.cos(phase) * 0.016 * env;
      const lift = Math.abs(Math.sin(phase)) * this.rig.baseHalf * 0.030 * env;
      const yaw = Math.sin(phase * 0.5 + this.ph[2]) * 0.012 * env;
      const x = a.fx + (a.tx - a.fx) * slip;
      const z = a.fz + (a.tz - a.fz) * slip;
      this.apply(x - this.baseX, lift, z - this.baseZ, pitch, yaw, roll);
      // Each time the rocking crosses over, a base edge lands.
      const step = Math.floor((Math.PI * 2 * n * e) / Math.PI);
      if (step !== (a as Walk & { last?: number }).last) {
        (a as Walk & { last?: number }).last = step;
        if (step > 0) {
          this.rig.emit('piece-step', { id: this.rig.id, x, z, weight: this.rig.height });
        }
      }
      return;
    }

    if (a.kind === 'react') {
      this.playReactFrame(t, a);
      return;
    }

    if (a.kind === 'strike') {
      if (a.spec) {
        this.playStrikeFrame(t, a, a.spec);
        return;
      }
      const tt = t - a.t0;
      const total = a.windup + a.swing + a.hold + a.recover;
      if (tt >= total) {
        this.anim = null;
        this.apply(0, 0, 0, 0, 0, 0);
        if (this.rig.arm) this.rig.arm.quaternion.copy(this.armRest);
        return;
      }
      let lean = 0, yaw = 0, arm = 0, push = 0;
      if (tt < a.windup) {
        const k = smooth(tt / a.windup);
        lean = -0.125 * k;
        yaw = a.yawDelta * k * 0.55;
        arm = -this.armSwing * k;   // blade drawn back past the shoulder
        push = -0.065 * k;
      } else if (tt < a.windup + a.swing) {
        const p = (tt - a.windup) / a.swing;
        const k = Math.pow(p, 1.75); // accelerating into contact
        lean = -0.125 + (a.lean + 0.125) * k;
        yaw = a.yawDelta * (0.55 + 0.45 * k);
        arm = -this.armSwing + (this.armSwing + 1.15) * k; // arm drives fully out
        push = -0.065 + (a.lunge + 0.065) * k;
        if (!a.fired && p > 0.999) a.fired = true;
      } else if (tt < a.windup + a.swing + a.hold) {
        const p = (tt - a.windup - a.swing) / a.hold;
        if (!a.fired) {
          a.fired = true;
          this.rig.emit('piece-impact', {
            id: this.rig.id,
            x: this.baseX + a.dirX * a.lunge,
            z: this.baseZ + a.dirZ * a.lunge,
          });
        }
        lean = a.lean - 0.030 * smooth(p);
        yaw = a.yawDelta;
        arm = 1.15 + 0.06 * smooth(p);
        push = a.lunge;
      } else {
        const p = (tt - a.windup - a.swing - a.hold) / a.recover;
        const k = smooth(p);
        const shake = Math.exp(-p * 6) * Math.sin(p * 26 + this.ph[1]) * 0.018;
        lean = (a.lean - 0.030) * (1 - k) + shake;
        yaw = a.yawDelta * (1 - k);
        arm = 1.21 * (1 - k);
        push = a.lunge * (1 - k);
      }
      this.apply(a.dirX * push, 0, a.dirZ * push, lean, yaw, 0);
      if (this.rig.arm) {
        const q = this.armRest.clone();
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), arm));
        this.rig.arm.quaternion.copy(q);
      }
      return;
    }

    // surrender — the blade goes.
    const tt = t - a.t0;
    const armObj = this.rig.arm;
    this.apply(0, 0, 0, -0.02 * smooth(tt / 0.5), 0, 0);
    if (!armObj) return;
    const dropTime = 0.30;
    const fallTime = 0.90;
    const tipY = this.tipLocal.y;
    if (tt < dropTime) {
      const k = Math.min(1, tt / dropTime);
      const drop = (tipY - 0.02) * k * k;
      armObj.position.set(this.armRestPos.x, this.armRestPos.y - drop, this.armRestPos.z);
      armObj.quaternion.copy(this.armRest);
      return;
    }
    const p = Math.min(1, (tt - dropTime) / fallTime);
    const ang = (Math.PI / 2 + 0.06) * Math.pow(p, 1.7);
    const settle = p >= 1 ? Math.exp(-(tt - dropTime - fallTime) * 12) * Math.sin((tt - dropTime - fallTime) * 44) * 0.012 : 0;
    const axis = new THREE.Vector3(1, 0.0, 0).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, ang + settle);
    const tipFloor = new THREE.Vector3(this.tipLocal.x, 0.02, this.tipLocal.z);
    const hiltFromTip = new THREE.Vector3().subVectors(this.hiltLocal, this.tipLocal).applyQuaternion(q);
    armObj.position.copy(tipFloor).add(hiltFromTip);
    armObj.quaternion.copy(this.armRest).premultiply(q);
    if (p >= 1 && !(a as Surrender & { rang?: boolean }).rang) {
      (a as Surrender & { rang?: boolean }).rang = true;
      this.rig.emit('blade-fell', { id: this.rig.id, x: this.baseX, z: this.baseZ });
    }
  }

  // --- play frames ------------------------------------------------------------------------

  private playWalkFrame(t: number, a: Walk, spec: PlayWalkSpec): void {
    const tt = t - a.t0;
    if (tt >= a.dur + a.settle) {
      this.finish(t);
      this.place(t, this.baseX, 0, this.baseZ, this.rig.facing, 0, 0, 0);
      return;
    }
    const p = playWalk(spec, tt < 0 ? 0 : tt, this.walkPose);
    this.place(t, p.x, p.y, p.z, p.face, p.pitch, p.roll, 0);
    if (p.step !== this.lastStep) {
      const prev = this.lastStep;
      this.lastStep = p.step;
      if (p.step > 0 && prev >= 0) {
        this.rig.emit('piece-step', { id: this.rig.id, x: p.x, z: p.z, weight: this.rig.height });
      }
    }
  }

  private playStrikeFrame(t: number, a: Strike, spec: PlayStrikeSpec): void {
    const tt = t - a.t0;
    if (tt >= PLAY_STRIKE_TOTAL) {
      this.finish(t);
      this.place(t, this.baseX, 0, this.baseZ, this.face, 0, 0, 0);
      return;
    }
    const s = playStrike(spec, tt < 0 ? 0 : tt, this.strikePose);
    // The blade arrives at exactly PLAY_CONTACT. Fire on the first frame at or after it —
    // one frame ahead of the shatter, which is what the LOD pin and the destruction want.
    if (!a.fired && tt >= PLAY_CONTACT) {
      a.fired = true;
      this.rig.emit('piece-impact', {
        id: this.rig.id,
        x: this.baseX + a.dirX * a.lunge,
        z: this.baseZ + a.dirZ * a.lunge,
      });
    }
    this.place(
      t,
      this.baseX + a.dirX * s.push,
      0,
      this.baseZ + a.dirZ * s.push,
      s.face, s.pitch, s.roll, s.arm,
    );
  }

  private playReactFrame(t: number, a: React): void {
    const tt = t - a.contactAt;
    if (tt > 0.9) {
      this.finish(t);
      this.place(t, this.baseX, 0, this.baseZ, this.face, 0, 0, 0);
      return;
    }
    if (tt < -PLAY_BRACE) {
      // Warned, but the blade is still on its way in. Stand exactly as before — the piece
      // must not start reacting the moment the attacker sets off, only as it arrives.
      const k = 0.00035;
      this.place(
        t, this.baseX, 0, this.baseZ, this.face,
        Math.sin(t * 0.7 + this.ph[0]) * k, Math.sin(t * 0.53 + this.ph[1]) * k, 0,
      );
      return;
    }
    const r = playReact(tt, this.reactPose);
    // The lean has to go the way the BLOW goes, which has nothing to do with the way this
    // piece happens to be facing — so resolve the world-space blow direction into the
    // piece's own pitch and roll axes.
    const f = this.face;
    const dotF = a.dirX * Math.sin(f) + a.dirZ * Math.cos(f);
    const dotR = a.dirX * Math.cos(f) - a.dirZ * Math.sin(f);
    const tremor = Math.sin(t * 41.0 + this.ph[2]) * r.tremor;
    this.place(
      t,
      this.baseX + a.dirX * r.shove,
      0,
      this.baseZ + a.dirZ * r.shove,
      f,
      r.lean * dotF + tremor,
      -r.lean * dotR + tremor * 0.6,
      0,
    );
  }
}
