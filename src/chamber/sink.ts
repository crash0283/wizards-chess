/**
 * PIECE: chamber — instance accumulation.
 *
 * Everything repeated in the room (blocks, voussoirs, flagstones, scree) is collected
 * here at build time and baked into one InstancedMesh per geometry variant. That keeps
 * a five-thousand-block hall down to a few dozen draw calls, which is the difference
 * between a capture that finishes and one that does not under software GL.
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class InstanceSink {
  private mats: number[][];
  private cols: number[][];

  constructor(private variants: number) {
    this.mats = Array.from({ length: variants }, () => [] as number[]);
    this.cols = Array.from({ length: variants }, () => [] as number[]);
  }

  get count(): number {
    let n = 0;
    for (const m of this.mats) n += m.length / 16;
    return n;
  }

  add(variant: number, m: THREE.Matrix4, c: THREE.Color) {
    const v = ((variant % this.variants) + this.variants) % this.variants;
    const a = this.mats[v];
    for (let i = 0; i < 16; i++) a.push(m.elements[i]);
    this.cols[v].push(c.r, c.g, c.b);
  }

  /**
   * Place a block: unit geometry is x,y in [-0.5,0.5] and z in [-1,0] with its FRONT
   * face at z = 0, so this is "a `w` x `h` block `d` deep whose face centre sits here".
   */
  block(
    variant: number,
    cx: number, cy: number, faceZ: number,
    w: number, h: number, d: number,
    rx: number, ry: number, rz: number,
    c: THREE.Color,
  ) {
    _e.set(rx, ry, rz, 'ZYX');
    _q.setFromEuler(_e);
    _p.set(cx, cy, faceZ);
    _s.set(w, h, d);
    _m.compose(_p, _q, _s);
    this.add(variant, _m, c);
  }

  bake(
    parent: THREE.Object3D,
    geos: THREE.BufferGeometry[],
    material: THREE.Material,
    name: string,
    opts: { receiveShadow?: boolean; castShadow?: boolean } = {},
  ): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (let v = 0; v < this.variants; v++) {
      const n = this.mats[v].length / 16;
      if (n === 0) continue;
      const im = new THREE.InstancedMesh(geos[v % geos.length], material, n);
      im.name = `${name}-${v}`;
      im.instanceMatrix.set(this.mats[v]);
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cols[v]), 3);
      im.instanceColor.needsUpdate = true;
      im.receiveShadow = opts.receiveShadow ?? true;
      im.castShadow = opts.castShadow ?? false;
      im.computeBoundingSphere();
      parent.add(im);
      out.push(im);
    }
    return out;
  }
}
