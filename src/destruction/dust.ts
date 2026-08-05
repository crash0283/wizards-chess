/**
 * PIECE: destruction — the dust, which IS the event.
 *
 * In the reference frames the cloud, not the debris, is the subject: a dense, opaque,
 * white-grey mass, the brightest thing in the picture, standing well above where the
 * piece stood, with real internal structure — lobes, rolls, a cauliflower head over a
 * spreading skirt. Everything here exists to make it read as a VOLUME.
 *
 * It is built from a few hundred lumpy, individually-shaded puffs drawn back to front:
 *
 *   skirt   thrown out horizontally at the floor, grows huge, stays low
 *   column  the trunk, rising on buoyancy
 *   head    lobes launched up the axis on a delay, each ROLLING outward and over —
 *           that toroidal curl is what makes a cauliflower rather than a balloon
 *   wisps   small, fast, short-lived, breaking up the silhouette so the edge is never
 *           a smooth arc (a smooth arc is the loudest "this is a sprite" tell there is)
 *
 * Shading happens at two scales, and both are needed. Per puff, on the CPU: where it
 * sits in the mass, which way that faces relative to the room's soft overhead light,
 * how deep inside it is, how high it has risen. Per pixel, in the shader: the density
 * here against the density one short step toward the light, which gives every single
 * puff a lit edge and a shadowed core for one extra texture fetch. Together they are
 * what produce lobes and rolls instead of a flat grey blob — and they are why the puffs
 * are sorted and composited with premultiplied alpha rather than added together.
 *
 * Positions are closed-form functions of the puff's age, so the plume is a pure function
 * of world.time — scrub anywhere and get the same frame.
 */
import * as THREE from 'three';
import { makeFbm, type Rng } from '../core/rng';
import type { World } from '../core/world';

interface Puff {
  active: boolean;
  born: number;
  delay: number;
  /** Emission point. */
  ox: number; oy: number; oz: number;
  /** Initial velocity. */
  vx: number; vy: number; vz: number;
  /** Axis of the plume this puff rolls around. */
  ax: number; az: number;
  drag: number;
  buoy: number;
  roll: number;
  s0: number;
  grow: number;
  alpha: number;
  fade: number;
  bright: number;
  rot: number;
  spin: number;
  tex: number;
  wob: number;
  ph1: number; ph2: number; ph3: number;
  /** Cloud metrics this puff belongs to. */
  baseY: number;
  reach: number;
}

export interface Plume {
  object: THREE.Object3D;
  burst(opts: {
    origin: THREE.Vector3;
    /** Horizontal half-size of the piece that just went. */
    radius: number;
    height: number;
    /** Direction the blow travelled. */
    dir: THREE.Vector3;
    force: number;
    rng: Rng;
    t: number;
  }): void;
  update(t: number): void;
  dispose(): void;
}

/**
 * Deep shadow inside the cloud. Cold, because the room is cold — but NOT dark. This is
 * pulverised limestone: the deepest pocket in the reference plume still sits around a
 * third of the crown's value. Drop this toward black and the whole mass turns to soot,
 * which is exactly the failure this module had.
 */
const SHADOW = new THREE.Vector3(0.085, 0.098, 0.128);
/**
 * Full-lit dust — the crown. This must be the brightest thing in the frame, but the film
 * clips essentially no pixels (fracBlown 0.0003), so it sits just under the ceiling
 * rather than over it and lets bloom carry the last stop.
 */
const LIT = new THREE.Vector3(0.415, 0.412, 0.409);
/** Firelight bounced into the underside of the cloud from the kerb flames. A whisper. */
const EMBER = new THREE.Vector3(0.10, 0.05, 0.016);
/** The room's soft overhead fill, as a direction. */
const KEY = new THREE.Vector3(-0.30, 1.0, 0.34).normalize();

const VERT = /* glsl */ `
attribute vec3 iCentre;
attribute vec2 iSize;
attribute float iRot;
attribute vec3 iColor;
attribute float iAlpha;
attribute float iTex;
uniform vec3 uLight;
varying vec2 vUv;
varying vec2 vCell;
varying vec2 vLight;
varying vec3 vCol;
varying float vAlpha;
void main(){
  float s = sin(iRot), c = cos(iRot);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize;
  vec4 mv = modelViewMatrix * vec4(iCentre, 1.0);
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  vCell = vec2(mod(iTex, 2.0), floor(iTex * 0.5)) * 0.5;
  vUv = (uv + vec2(mod(iTex, 2.0), floor(iTex * 0.5))) * 0.5;
  // The key direction, brought into the puff's own texture frame: view space first,
  // then back out of the quad's rotation.
  vec2 lv = normalize((viewMatrix * vec4(uLight, 0.0)).xy + 1e-6);
  vLight = vec2(lv.x * c + lv.y * s, -lv.x * s + lv.y * c);
  vCol = iColor;
  vAlpha = iAlpha;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
varying vec2 vUv;
varying vec2 vCell;
varying vec2 vLight;
varying vec3 vCol;
varying float vAlpha;
void main(){
  vec2 t = texture2D(uMap, vUv).rg;
  float a = t.r * vAlpha;
  if (a < 0.004) discard;
  // Self-shading, the cheap and correct way: compare the density here with the density
  // a short step TOWARD the light. Less dust that way means we are near the lit edge of
  // this lobe; more means we are looking into it. One texture fetch buys every puff a
  // lit side and a shadowed side, which is what makes a heap of billboards read as a
  // solid rolling mass rather than as a flat grey stain.
  // Clamped to this puff's own cell of the 2x2 atlas. Stepping toward the light can walk
  // the sample across a cell boundary and pick up a completely different puff shape,
  // which shows up as hard straight-edged seams cutting through the cloud.
  vec2 su = clamp(vUv + vLight * 0.052, vCell + 0.003, vCell + 0.497);
  float ahead = texture2D(uMap, su).r;
  float lit = clamp(0.5 + (t.r - ahead) * 1.7, 0.0, 1.0);
  // The green channel is coarser density: structure at a second scale.
  vec3 col = vCol * (0.50 + 0.78 * lit) * (0.90 + 0.18 * t.g);
  gl_FragColor = vec4(col * a, a);
}
`;

/** Four lumpy puff shapes in a 2x2 atlas. Warped circles: never a soft round dot. */
function buildAtlas(seed: number): THREE.DataTexture {
  const CELL = 192;
  const SIZE = CELL * 2;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let cell = 0; cell < 4; cell++) {
    const warp = makeFbm(seed + cell * 7919, 4, 2.07, 0.52);
    const fine = makeFbm(seed + cell * 104729 + 13, 3, 2.11, 0.55);
    const ox = (cell % 2) * CELL;
    const oy = Math.floor(cell / 2) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const u = (x + 0.5) / CELL * 2 - 1;
        const v = (y + 0.5) / CELL * 2 - 1;
        const r = Math.hypot(u, v);
        const w = warp(u * 2.1 + cell * 4.3, v * 2.1 - cell * 2.7, cell * 1.7);
        // Warp the outline hard: the silhouette of a real puff is a cauliflower edge.
        const d = r + w * 0.58;
        let dens = 1 - Math.min(1, Math.max(0, (d - 0.28) / 0.62));
        dens = dens * dens * (3 - 2 * dens);
        // The warped falloff alone does not reach zero by the edge of the quad, and a
        // puff clipped by its own quad reads as a grey rectangle. Mask it out.
        dens *= Math.min(1, Math.max(0, (0.97 - r) / 0.20));
        // Keep the INSIDE of a puff smooth. The cauliflower has to live in the outline
        // and in the value difference between neighbouring lobes; high-frequency noise
        // across the face of every quad just turns the mass into television static.
        const f = fine(u * 2.4, v * 2.4, cell * 3.1) * 0.5 + 0.5;
        dens *= 0.78 + 0.30 * f;
        const detail = Math.min(1, Math.max(0, 0.5 + 0.75 * fine(u * 1.5 + 9.0, v * 1.5, cell)));
        const i = ((oy + y) * SIZE + (ox + x)) * 4;
        data[i] = Math.round(Math.min(1, dens) * 255);
        data[i + 1] = Math.round(detail * 255);
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createPlume(world: World): Plume {
  const high = world.quality === 'high';
  const PER_BURST = high ? 320 : 104;
  const MAX = PER_BURST * 2;

  const object = new THREE.Group();
  object.name = 'destruction-dust';

  const puffs: Puff[] = [];
  let mesh: THREE.Mesh | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let atlas: THREE.DataTexture | null = null;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let iCentre!: THREE.InstancedBufferAttribute;
  let iSize!: THREE.InstancedBufferAttribute;
  let iRot!: THREE.InstancedBufferAttribute;
  let iColor!: THREE.InstancedBufferAttribute;
  let iAlpha!: THREE.InstancedBufferAttribute;
  let iTex!: THREE.InstancedBufferAttribute;

  // Scratch, reused every frame.
  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const pz = new Float32Array(MAX);
  const ps = new Float32Array(MAX);
  const pa = new Float32Array(MAX);
  const pr = new Float32Array(MAX);
  const pb = new Float32Array(MAX);
  const depth = new Float32Array(MAX);
  const lowness = new Float32Array(MAX);
  const which = new Float32Array(MAX);
  const order: number[] = [];
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function ensureMesh() {
    if (mesh) return;
    atlas = buildAtlas((world.seed ^ 0x5eed17) >>> 0);
    geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    );
    geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    iCentre = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    iSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    iRot = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    iColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    iTex = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    for (const a of [iCentre, iSize, iRot, iColor, iAlpha, iTex]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iCentre', iCentre);
    geo.setAttribute('iSize', iSize);
    geo.setAttribute('iRot', iRot);
    geo.setAttribute('iColor', iColor);
    geo.setAttribute('iAlpha', iAlpha);
    geo.setAttribute('iTex', iTex);
    geo.instanceCount = 0;

    material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlas }, uLight: { value: KEY.clone() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });
    material.name = 'dust';

    mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.name = 'dust-puffs';
    object.add(mesh);
  }

  function burst(opts: Parameters<Plume['burst']>[0]) {
    ensureMesh();
    const { rng, origin, force } = opts;
    // The cloud is roughly two metres across and four tall — it stands over the piece,
    // it does not swallow the room. Everything below is sized off this.
    const scale = Math.min(1.05, Math.max(0.55, opts.radius / 0.78));
    // Everything the burst spends is set here; nothing reads a clock afterwards.
    const n = PER_BURST;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      let layer: 0 | 1 | 2 | 3;
      if (u < 0.26) layer = 0;          // skirt
      else if (u < 0.58) layer = 1;     // column
      else if (u < 0.88) layer = 2;     // head
      else layer = 3;                   // wisps

      const th = rng.float(0, Math.PI * 2);
      // Biased along the blow: the cloud leans away from the sword.
      const lean = 0.34 + 0.66 * Math.max(0, Math.cos(th - Math.atan2(opts.dir.z, opts.dir.x)));
      const p: Puff = {
        active: true,
        born: opts.t,
        delay: 0,
        ox: origin.x, oy: origin.y, oz: origin.z,
        vx: 0, vy: 0, vz: 0,
        ax: origin.x, az: origin.z,
        drag: 1.5, buoy: 1.0, roll: 0,
        s0: 0.5, grow: 0.5, alpha: 1, fade: 0.1, bright: 1,
        rot: rng.float(0, Math.PI * 2),
        spin: rng.gauss() * 0.30,
        tex: rng.int(0, 4),
        wob: 0.16,
        ph1: rng.float(0, 6.283), ph2: rng.float(0, 6.283), ph3: rng.float(0, 6.283),
        baseY: origin.y,
        reach: 0.90 * scale,
      };

      if (layer === 0) {
        // Skirt: hurled outward at floor level, then it just spreads and sits.
        const sp = rng.float(2.2, 4.2) * force * lean * scale;
        p.delay = rng.float(0, 0.05);
        p.ox += Math.cos(th) * 0.10 * scale;
        p.oz += Math.sin(th) * 0.10 * scale;
        p.oy = origin.y + rng.float(0.02, 0.40) * scale;
        p.vx = Math.cos(th) * sp;
        p.vz = Math.sin(th) * sp;
        p.vy = rng.float(0.25, 1.0);
        p.drag = rng.float(6.5, 9.5);
        p.buoy = rng.float(0.10, 0.36);
        p.roll = rng.float(0.05, 0.40);
        p.s0 = rng.float(0.23, 0.48) * scale;
        p.grow = rng.float(0.55, 1.00);
        p.alpha = rng.float(0.88, 1.0);
        p.fade = rng.float(0.08, 0.18);
        p.bright = rng.float(0.60, 0.96);
      } else if (layer === 1) {
        // Column: the trunk, close to the axis, carried up on buoyancy.
        const sp = rng.float(1.0, 2.5) * force * scale;
        p.delay = rng.float(0, 0.14);
        p.ox += Math.cos(th) * rng.float(0.03, 0.26) * scale;
        p.oz += Math.sin(th) * rng.float(0.03, 0.26) * scale;
        p.oy = origin.y + rng.float(0.15, 1.0) * opts.height * 0.42;
        p.vx = Math.cos(th) * sp;
        p.vz = Math.sin(th) * sp;
        p.vy = rng.float(0.7, 1.6);
        p.drag = rng.float(3.6, 5.4);
        p.buoy = rng.float(0.24, 0.50);
        p.roll = rng.float(0.25, 0.80);
        p.s0 = rng.float(0.20, 0.41) * scale;
        p.grow = rng.float(0.40, 0.80);
        p.alpha = rng.float(0.94, 1.0);
        p.fade = rng.float(0.05, 0.13);
        p.bright = rng.float(0.70, 1.06);
      } else if (layer === 2) {
        // Head: lobes launched up the axis on a delay, rolling outward as they go.
        const lobe = rng.int(0, 7);
        const lth = (lobe / 7) * Math.PI * 2 + rng.float(-0.28, 0.28);
        // Wide enough to be a cauliflower rather than a mast: the head has to end up
        // about as broad as the column is tall, or the mass reads as a smoke trail.
        const sp = rng.float(0.45, 1.15) * scale;
        p.delay = rng.float(0.04, 0.30) + lobe * 0.012;
        p.ox += Math.cos(lth) * rng.float(0.0, 0.25) * scale;
        p.oz += Math.sin(lth) * rng.float(0.0, 0.25) * scale;
        p.oy = origin.y + rng.float(0.35, 0.85) * opts.height * 0.42;
        p.vx = Math.cos(lth) * sp;
        p.vz = Math.sin(lth) * sp;
        p.vy = rng.float(1.15, 1.85);
        p.drag = rng.float(1.70, 2.50);
        p.buoy = rng.float(0.17, 0.35);
        p.roll = rng.float(0.70, 1.45);
        p.s0 = rng.float(0.20, 0.43) * scale;
        p.grow = rng.float(0.35, 0.70);
        p.alpha = rng.float(0.96, 1.0);
        p.fade = rng.float(0.04, 0.10);
        p.bright = rng.float(0.78, 1.16);
      } else {
        // Wisps: fast, small, short-lived. They break the outline up.
        const sp = rng.float(3.5, 6.5) * force * lean * scale;
        const up = rng.float(-0.25, 1.15);
        p.delay = rng.float(0, 0.09);
        p.oy = origin.y + rng.float(0.1, 1.0) * opts.height * 0.5;
        p.vx = Math.cos(th) * sp;
        p.vz = Math.sin(th) * sp;
        p.vy = sp * up * 0.5;
        p.drag = rng.float(7.0, 11.0);
        p.buoy = rng.float(0.25, 0.9);
        p.roll = rng.float(0.1, 0.7);
        p.s0 = rng.float(0.08, 0.20) * scale;
        p.grow = rng.float(0.9, 1.8);
        p.alpha = rng.float(0.50, 0.88);
        p.fade = rng.float(0.30, 0.62);
        p.bright = rng.float(0.90, 1.16);
        p.wob = 0.26;
      }
      puffs.push(p);
    }
    // Never let more than two bursts' worth live at once.
    while (puffs.length > MAX) puffs.shift();
  }

  function update(t: number) {
    if (!mesh || !geo) return;
    world.camera.getWorldPosition(camPos);

    let live = 0;
    order.length = 0;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const a = t - p.born - p.delay;
      if (a <= 0) continue;

      // Drag-limited ballistic travel with buoyant lift, in closed form.
      const k = p.drag;
      const f = (1 - Math.exp(-k * a)) / k;
      let x = p.ox + p.vx * f;
      let y = p.oy + p.vy * f + p.buoy * (a - f);
      let z = p.oz + p.vz * f;

      // Toroidal roll: the outer edge of the cloud curls up and over itself. This is
      // what turns a rising ball into a cauliflower.
      const rx = x - p.ax, rz = z - p.az;
      const L = Math.hypot(rx, rz);
      if (L > 1e-4) {
        const ang = p.roll * f;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        x = p.ax + rx * cs;
        z = p.az + rz * cs;
        y += L * sn;
      }

      // Turbulent wander, settling as the puff slows.
      const wobAmp = p.wob * (1 - Math.exp(-a * 1.4)) * (1 + a * 0.35);
      x += Math.sin(a * 1.7 + p.ph1) * wobAmp;
      y += Math.sin(a * 1.31 + p.ph2) * wobAmp * 0.62;
      z += Math.cos(a * 1.53 + p.ph3) * wobAmp;

      if (y < p.baseY + 0.05) y = p.baseY + 0.05 + (p.baseY + 0.05 - y) * 0.25;

      const alpha = p.alpha * (1 - Math.exp(-a * 16)) * Math.exp(-a * p.fade)
        * (1 - Math.min(1, Math.max(0, (a - 4.2) / 3.0)));
      if (alpha < 0.012) continue;

      const idx = live++;
      px[idx] = x; py[idx] = y; pz[idx] = z;
      ps[idx] = p.s0 * Math.pow(1 + p.grow * a, 0.62);
      pa[idx] = alpha;
      pr[idx] = p.rot + p.spin * a;

      // --- shading: where is this puff in the mass, and where is the light -----------
      // A puff is a lump on the outside of a rising column, so its shading normal points
      // out from the plume's AXIS at the puff's own height, tipping upward as it nears
      // the crown. The old version measured from a single point 1.05 m up the axis, so
      // every puff below that height got a downward normal, `lam` collapsed to nearly
      // zero, and pow(lam, 1.85) finished the job: the entire cloud shaded at about 5 %
      // of full and rendered as a black smudge with an ember tint. That single line is
      // why there appeared to be no dust at all.
      const dxl = x - p.ax, dzl = z - p.az;
      const rise = y - p.baseY;
      const horiz = Math.hypot(dxl, dzl);
      // Keep the up component modest: if the normal points mostly at the overhead fill
      // then every puff is lit the same and the mass goes flat white with no lobes.
      // The horizontal part is what gives one side of a roll a light face and the other
      // a dark one, and the lobes ARE the reason this reads as a volume.
      const upBias = 0.25 + 0.55 * Math.min(1, rise / 2.6);
      const len = Math.hypot(dxl, upBias, dzl) || 1;
      const lam = 0.5 + 0.5 * ((dxl * KEY.x + upBias * KEY.y + dzl * KEY.z) / len);
      // Buried: near the axis and low down is the inside of the cloud. It reads deeper,
      // not black — self-shadowed dust is still dust.
      // ...but only once there IS an inside. For the first fraction of a second every
      // puff is still sitting on the axis, so the depth term would shade the whole burst
      // as buried core and `piece-mid-strike` — which is captured within a frame or two
      // of the blade landing — would catch a dark cloud instead of the white detonation
      // the reference shows.
      const opened = Math.min(1, a / 0.35);
      const buried = Math.max(0, 1 - horiz / (p.reach * 0.95))
        * Math.max(0, 1 - rise / 4.0) * opened;
      const risen = Math.min(1, Math.max(0, rise / 3.0));
      let b = (0.20 + 0.80 * Math.pow(lam, 2.0)) * (1 - 0.60 * buried)
        * (0.80 + 0.24 * risen + 0.30 * (1 - opened));
      b *= p.bright * (1 + 0.35 * Math.exp(-a * 3.2));
      pb[idx] = Math.min(1.0, b);
      order.push(idx);
      which[idx] = p.tex;
      depth[idx] = camPos.distanceToSquared(tmp.set(x, y, z));
      // Ember bounce into the underside: it is the near-floor dust that catches the fires.
      lowness[idx] = Math.max(0, 1 - (y - p.baseY) / 1.5);
    }

    // Back to front, so the internal shading composites the way a real cloud does.
    order.sort((a, b) => depth[b] - depth[a]);

    const ce = iCentre.array as Float32Array;
    const sz = iSize.array as Float32Array;
    const ro = iRot.array as Float32Array;
    const co = iColor.array as Float32Array;
    const al = iAlpha.array as Float32Array;
    const tx = iTex.array as Float32Array;
    for (let n = 0; n < order.length; n++) {
      const i = order[n];
      ce[n * 3] = px[i]; ce[n * 3 + 1] = py[i]; ce[n * 3 + 2] = pz[i];
      // Lobe size. Big soft quads make a smooth stain; the reference mass is built out of
      // many tighter rolls, so this stays modest and density comes from overlap instead.
      sz[n * 2] = ps[i] * 1.38;
      sz[n * 2 + 1] = ps[i] * 1.38;
      ro[n] = pr[i];
      const b = pb[i];
      const e = lowness[i] * 0.35;
      co[n * 3] = SHADOW.x + (LIT.x - SHADOW.x) * b + EMBER.x * e;
      co[n * 3 + 1] = SHADOW.y + (LIT.y - SHADOW.y) * b + EMBER.y * e;
      co[n * 3 + 2] = SHADOW.z + (LIT.z - SHADOW.z) * b + EMBER.z * e;
      al[n] = pa[i];
      tx[n] = which[i];
    }
    geo.instanceCount = order.length;
    iCentre.needsUpdate = true;
    iSize.needsUpdate = true;
    iRot.needsUpdate = true;
    iColor.needsUpdate = true;
    iAlpha.needsUpdate = true;
    iTex.needsUpdate = true;
  }

  return {
    object,
    burst,
    update,
    dispose() {
      geo?.dispose();
      material?.dispose();
      atlas?.dispose();
      puffs.length = 0;
    },
  };
}
