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
 * Everything is a pure function of world.time. Nothing reads a clock.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';

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
}

interface Walk {
  kind: 'walk';
  fx: number; fz: number; tx: number; tz: number;
  t0: number; dur: number; settle: number; shoves: number;
}
interface Strike {
  kind: 'strike';
  t0: number;
  yawDelta: number;
  windup: number; swing: number; hold: number; recover: number;
  lean: number; lunge: number;
  dirX: number; dirZ: number;
  fired: boolean;
}
interface Surrender {
  kind: 'surrender';
  t0: number;
}

type Anim = Walk | Strike | Surrender;

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

  constructor(rig: MotionRig, hilt: THREE.Vector3, tip: THREE.Vector3, armSwing: number) {
    this.rig = rig;
    this.ph = [rig.rng.float(0, 6.28), rig.rng.float(0, 6.28), rig.rng.float(0, 6.28)];
    this.hiltLocal.copy(hilt);
    this.tipLocal.copy(tip);
    this.armSwing = armSwing;
    if (rig.arm) {
      this.armRestPos.copy(rig.arm.position);
      this.armRest.copy(rig.arm.quaternion);
    }
  }

  /**
   * True while an animation is driving the arm off its rest pose — the strike, and the
   * mated king's surrender. The low tier bakes arm into body for a single draw call and
   * reads this to know when it has to come apart again.
   */
  armAnimating(): boolean {
    const a = this.anim;
    return a !== null && (a.kind === 'strike' || a.kind === 'surrender');
  }

  setSquare(x: number, z: number): void {
    this.baseX = x;
    this.baseZ = z;
    this.anim = null;
    this.pending.length = 0;
    this.apply(0, 0, 0, 0, 0, 0);
    if (this.rig.arm) {
      this.rig.arm.position.copy(this.armRestPos);
      this.rig.arm.quaternion.copy(this.armRest);
    }
  }

  walkTo(x: number, z: number, seconds: number, now: number): Promise<void> {
    const dist = Math.hypot(x - this.baseX, z - this.baseZ);
    const shoves = Math.max(2, Math.round(dist / 0.62));
    const settle = 0.55;
    this.anim = {
      kind: 'walk',
      fx: this.baseX, fz: this.baseZ, tx: x, tz: z,
      t0: now, dur: Math.max(0.35, seconds), settle, shoves,
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
    let dy = want - this.rig.facing;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    // A thrust, not a swing: the reference shows the attacker driving the blade straight
    // through with the arm fully out and the whole body committed behind it.
    const windup = 0.58, swing = 0.24, hold = 0.20, recover = 1.00;
    const len = Math.hypot(dx, dz) || 1;
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
    };
    return new Promise<void>((res) => {
      this.pending.push({ at: now + windup + swing, fn: res });
    });
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
      this.apply(0, 0, 0, Math.sin(t * 0.7 + this.ph[0]) * k, 0, Math.sin(t * 0.53 + this.ph[1]) * k);
      return;
    }

    if (a.kind === 'walk') {
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

    if (a.kind === 'strike') {
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
}
