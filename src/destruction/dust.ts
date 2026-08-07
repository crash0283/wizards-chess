/**
 * PIECE: destruction — the dust, which IS the event.
 *
 * In the reference frames the cloud, not the debris, is the subject: a dense mass standing
 * well above where the piece stood, with real internal structure — lobes, rolls, a
 * cauliflower head over a spreading skirt. Everything here exists to make it read as a
 * VOLUME.
 *
 * And a volume is LIT. This is the thing this module kept getting wrong: the dust is not a
 * light source. It is pulverised limestone hanging in a cold dark room, and the room's weak
 * fill and its few small flames are all that is on it. So it has a lit shoulder up where it
 * stands clear, a shadowed core, a trunk that is a good deal darker than its crown because
 * it is standing inside its own shadow, and edges thin enough that the dark board reads
 * straight through them. Measured off the film, the whole mass runs from 0.15 at its base
 * to 0.51 at its crown and never touches white anywhere — see the note on the values below,
 * which are solved rather than chosen.
 *
 * It is built from a couple of hundred large, soft, individually-shaded lobes drawn back to
 * front — LARGE being the operative word, because the same cloud made of three times as
 * many small tight puffs reads as popcorn:
 *
 *   skirt   thrown out horizontally at the floor, grows huge, stays low
 *   column  the trunk, rising on buoyancy
 *   head    lobes launched up the axis on a delay, each ROLLING outward and over —
 *           that toroidal curl is what makes a cauliflower rather than a balloon
 *   wisps   small, fast, short-lived, breaking up the silhouette so the edge is never
 *           a smooth arc (a smooth arc is the loudest "this is a sprite" tell there is)
 *
 * Shading happens at two scales, and both are needed. Per puff, on the CPU: how high it has
 * risen (which dominates), which way it faces relative to the room's soft fill, and how deep
 * inside the mass it sits. Per pixel, in the shader: the density here against the density a
 * step toward the light, which buys every lobe a lit side and a shadowed core for one extra
 * texture fetch. Together they produce lobes and rolls instead of a flat grey blob — and
 * they are why the puffs are sorted and composited with premultiplied alpha rather than
 * added together. Adding them would make the cloud emissive, which is the failure this is
 * built to avoid.
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
  /** Quad aspect: lobes are stretched along the direction they are travelling. */
  aspx: number; aspy: number;
  ph1: number; ph2: number; ph3: number;
  /** Cloud metrics this puff belongs to. */
  baseY: number;
  reach: number;
  /** Height the crown of this plume reaches — the scale the vertical ramp is read on. */
  top: number;
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
  /**
   * The soft ground-hugging breath of dust a wreck gives off as the chamber takes it back.
   * INTERACTIVE ONLY — nothing under capture ever calls this, because under capture
   * nothing is ever taken back.
   */
  settle(opts: {
    origin: THREE.Vector3;
    radius: number;
    rng: Rng;
    t: number;
  }): void;
  update(t: number): void;
  dispose(): void;
}

/**
 * ---------------------------------------------------------------------------------------
 * VALUES. These are not taste; they are solved against the reference frame through the
 * grade this project actually renders through, and they are the whole difference between
 * a lit volume and a light source.
 *
 * Measured off `aftermath-rubble.webp` as a 16x8 grid of mean luminance, the film's plume
 * reads: crown ~0.51, upper body ~0.30, mid body ~0.22, base ~0.15, and its brightest
 * pixel anywhere in the mass is 0.66. It never comes near white — the frame's blown
 * fraction is 0.0003.
 *
 * Running those figures back through `src/lighting/grade.ts` (exposure 0.716, ACES, the
 * 0.885 lift, the cool balance and the highlight expansion) gives the scene-linear values
 * that produce them:
 *
 *     final 0.15  <- linear 0.032      final 0.50  <- linear 0.146
 *     final 0.22  <- linear 0.055      final 0.60  <- linear 0.184
 *     final 0.30  <- linear 0.081      final 0.66  <- linear 0.210
 *
 * The old LIT of 0.415 lands at final 0.879 with its blue channel at 0.967 — i.e. clipped,
 * across the entire body of the cloud, which is precisely the 190x blown-pixel overshoot.
 * Nothing in here may exceed CEIL.
 *
 * Note these are near-neutral in LINEAR. The film's plume is markedly blue on screen, but
 * that blue is put there by the grade's cool balance; tinting the source as well would
 * double it.
 * ---------------------------------------------------------------------------------------
 */
/** The shadowed core, and the base of the trunk. Dust, not soot: final ~0.13. */
const SHADOW = new THREE.Vector3(0.0245, 0.0250, 0.0292);
/** The lit shoulder of the crown, standing in the room's fill. Final ~0.53. */
const LIT = new THREE.Vector3(0.1630, 0.1585, 0.1700);
/** Firelight bounced into the underside from the kerb flames. A whisper, and no more. */
const EMBER = new THREE.Vector3(0.017, 0.0075, 0.0012);
/**
 * Hard ceiling on any pixel this module can emit — final 0.63, just under the brightest
 * pixel in the film's plume and a long way under the clip.
 */
const CEIL = 0.205;
/** The room's soft overhead fill, as a direction. */
const KEY = new THREE.Vector3(-0.30, 1.0, 0.34).normalize();

/** GLSL's smoothstep, on the CPU. */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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
uniform float uCeil;
varying vec2 vUv;
varying vec2 vCell;
varying vec2 vLight;
varying vec3 vCol;
varying float vAlpha;
void main(){
  vec2 t = texture2D(uMap, vUv).rg;
  float a = t.r * vAlpha;
  if (a < 0.003) discard;
  // Self-shading: compare the density here with the density a step TOWARD the light.
  // Less dust that way means we are near the lit edge of this lobe; more means we are
  // looking into it. One texture fetch buys every puff a lit side and a shadowed core.
  //
  // The STEP LENGTH is what decides whether this reads as a lobe or as popcorn. At the
  // old 0.052 the difference was taken across a twentieth of the puff, so it tracked the
  // small warps in the outline and drew a bright crinkled rim around every single quad —
  // thousands of tiny cotton-wool puffs, exactly the note. At 0.13 it is a fifth of the
  // puff and returns one broad gradient across the whole lobe, which is what a metre of
  // dust lit from one side actually does. The gain came down with it, hard, for the same
  // reason: this is a shading term, not an edge detector.
  //
  // Clamped to this puff's own cell of the 2x2 atlas — stepping across a cell boundary
  // picks up a different puff shape and cuts hard straight seams through the cloud.
  vec2 su = clamp(vUv + vLight * 0.105, vCell + 0.004, vCell + 0.496);
  float ahead = texture2D(uMap, su).r;
  float lit = clamp(0.5 + (t.r - ahead) * 1.15, 0.0, 1.0);
  // The green channel is coarser density: a second, larger scale of structure.
  vec3 col = vCol * (0.58 + 0.66 * lit) * (0.95 + 0.09 * t.g);
  // Nothing this module draws may reach the clip. See the note on CEIL.
  gl_FragColor = vec4(min(col, vec3(uCeil)) * a, a);
}
`;

/**
 * Four soft density lobes in a 2x2 atlas.
 *
 * The brief here changed. This used to build a hard cauliflower-edged blob with a sharp
 * shoulder, because the outline was doing the work of describing structure. Thousands of
 * those overlapping is the "tiny cotton-wool puffs" failure: every quad announces its own
 * silhouette and the mass turns to stipple.
 *
 * What replaces it is a LOBE — a broad, gently warped density field that falls off over
 * most of the quad instead of over its last fifth. Two consequences, both wanted:
 * the interior is smooth so a handful of large puffs read as one coherent form, and the
 * long tail means the outside of the cloud is a thin veil that the dark board reads
 * straight through rather than an opaque edge.
 */
function buildAtlas(seed: number): THREE.DataTexture {
  const CELL = 192;
  const SIZE = CELL * 2;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let cell = 0; cell < 4; cell++) {
    const warp = makeFbm(seed + cell * 7919, 3, 2.07, 0.48);
    const fine = makeFbm(seed + cell * 104729 + 13, 3, 2.11, 0.55);
    const ox = (cell % 2) * CELL;
    const oy = Math.floor(cell / 2) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const u = (x + 0.5) / CELL * 2 - 1;
        const v = (y + 0.5) / CELL * 2 - 1;
        const r = Math.hypot(u, v);
        // Warp the outline, but at ONE low frequency and half the old amplitude: enough
        // that no two lobes share a silhouette, not so much that the edge frills.
        const w = warp(u * 1.15 + cell * 4.3, v * 1.15 - cell * 2.7, cell * 1.7);
        const d = r + w * 0.42;
        // A PLATEAU and then a long fall. The plateau is what makes a lobe read as a lobe
        // — a cone-shaped puff has no interior, so a heap of them averages out to fog, and
        // fog is what this looked like when the falloff started at the centre. The long
        // fall is the translucent veil at the edge of the cloud, where the dark board has
        // to read through.
        let dens = 1 - Math.min(1, Math.max(0, (d - 0.30) / 0.62));
        dens = dens * dens * (3 - 2 * dens);
        dens = Math.pow(dens, 1.12);
        // The warped falloff alone does not reach zero by the edge of the quad, and a
        // puff clipped by its own quad reads as a grey rectangle. Mask it out.
        dens *= Math.min(1, Math.max(0, (0.99 - r) / 0.26));
        // Keep the INSIDE of a puff smooth. Structure lives in the outline and in the
        // value difference between neighbouring lobes; high-frequency noise across the
        // face of every quad is television static, and it is measurable — it is most of
        // why our fine detail band ran high while the coarse band ran low.
        const f = fine(u * 1.7, v * 1.7, cell * 3.1) * 0.5 + 0.5;
        dens *= 0.88 + 0.16 * f;
        const detail = Math.min(1, Math.max(0, 0.5 + 0.60 * fine(u * 0.9 + 9.0, v * 0.9, cell)));
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
  /**
   * HOW LONG THE CLOUD STANDS.
   *
   * Under capture the plume is the subject of two judged frames and its tail is part of
   * the look: it holds its shape for four seconds and takes three more to leave. Those
   * two numbers are the ones the shots were graded against and they do not move.
   *
   * In interactive play the same tail is a nuisance. The play camera looks straight down
   * at the board and a cloud that hangs for seven seconds sits over the squares you are
   * trying to read — and, with a capture every couple of moves, three of them overlap.
   * So the burst still detonates at full strength and reads exactly the same for the
   * first second, and then the room simply takes it: gone by about three seconds.
   *
   * `ephemeral` is `!world.capturing`, and it is the only switch in this module.
   */
  const ephemeral = !world.capturing;
  /** Age at which the room starts clearing the cloud. */
  const CLEAR_FROM = ephemeral ? 1.15 : 4.2;
  /** Seconds it takes from there to nothing. */
  const CLEAR_OVER = ephemeral ? 1.75 : 3.0;
  /**
   * Age past which a puff can never contribute another pixel, so its slot can be reused.
   * Only consulted when `ephemeral`: under capture the puff list is left exactly as it
   * was, because `burst` trims it from the FRONT and dropping a dead puff early would
   * change which live one falls off the end.
   */
  const REAP_AT = CLEAR_FROM + CLEAR_OVER;
  /**
   * A FEW LARGE LOBES. This was 320, and 320 quads a third of a metre across is what
   * "thousands of tiny cotton-wool puffs" looks like from the outside — every one of them
   * showing its own silhouette and its own value, which is stipple, not volume. Halved,
   * with each puff roughly 1.7x wider (so 2.9x the area) and carrying well under half the
   * opacity: the same optical depth through the mass, built out of a dozen big soft forms
   * instead of a hundred small hard ones.
   */
  const PER_BURST = high ? 190 : 68;
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
  const pax = new Float32Array(MAX);
  const pay = new Float32Array(MAX);
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
      uniforms: {
        uMap: { value: atlas },
        uLight: { value: KEY.clone() },
        uCeil: { value: CEIL },
      },
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
        // Quads this large cannot be spun freely — a half-metre lobe rotating in screen
        // space reads as turning wallpaper, and it throws away the vertical grain that a
        // rising column has. Small jitter about upright, small drift.
        rot: rng.gauss() * 0.42,
        spin: rng.gauss() * 0.11,
        tex: rng.int(0, 4),
        wob: 0.16,
        aspx: 1, aspy: 1,
        ph1: rng.float(0, 6.283), ph2: rng.float(0, 6.283), ph3: rng.float(0, 6.283),
        baseY: origin.y,
        reach: 0.90 * scale,
        // How high the crown of this plume gets. The vertical value ramp is read against
        // it, so it has to be the real height rather than a constant.
        top: Math.max(1.7, opts.height * 0.86),
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
        p.s0 = rng.float(0.32, 0.64) * scale;
        p.grow = rng.float(0.55, 1.00);
        p.alpha = rng.float(0.62, 0.86);
        p.fade = rng.float(0.08, 0.18);
        p.bright = rng.float(0.66, 1.00);
        // The skirt is thrown sideways, so it flattens.
        p.aspx = 1.16; p.aspy = 0.88;
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
        p.s0 = rng.float(0.28, 0.56) * scale;
        p.grow = rng.float(0.40, 0.80);
        p.alpha = rng.float(0.78, 0.96);
        p.fade = rng.float(0.05, 0.13);
        p.bright = rng.float(0.70, 1.08);
        // The trunk is being drawn upward, so it stretches upward. This is the frame's
        // directional structure — a rising column reads as vertical grain, and an image
        // made of round blobs measures as isotropic mush.
        p.aspx = 0.90; p.aspy = 1.18;
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
        p.s0 = rng.float(0.34, 0.70) * scale;
        p.grow = rng.float(0.35, 0.70);
        p.alpha = rng.float(0.80, 0.98);
        p.fade = rng.float(0.04, 0.10);
        p.bright = rng.float(0.74, 1.18);
        p.aspx = 1.06; p.aspy = 1.00;
      } else {
        // Wisps: fast, short-lived, and the only place any small scale survives. They
        // break the outline so the silhouette is never a smooth arc — but they are a
        // veil, not a spray of white dots, so they are thin.
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
        p.s0 = rng.float(0.16, 0.34) * scale;
        p.grow = rng.float(0.9, 1.8);
        p.alpha = rng.float(0.30, 0.50);
        p.fade = rng.float(0.20, 0.42);
        p.bright = rng.float(0.78, 1.06);
        p.wob = 0.26;
        p.aspx = 1.16; p.aspy = 0.90;
      }
      puffs.push(p);
    }
    // Never let more than two bursts' worth live at once.
    while (puffs.length > MAX) puffs.shift();
  }

  /**
   * A wreck going back into the floor. Low, wide, slow and thin — the opposite of a
   * burst: no column, no head, nothing above knee height. It is the visual reason the
   * rubble is allowed to vanish, so it wants to be soft and brief, not a second event.
   */
  function settle(opts: Parameters<Plume['settle']>[0]) {
    ensureMesh();
    const { rng, origin } = opts;
    const scale = Math.min(1.3, Math.max(0.6, opts.radius / 0.7));
    const n = high ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const th = rng.float(0, Math.PI * 2);
      const sp = rng.float(0.35, 1.05) * scale;
      puffs.push({
        active: true,
        born: opts.t,
        delay: rng.float(0, 0.55),
        ox: origin.x + Math.cos(th) * rng.float(0, 0.35) * scale,
        oy: origin.y + rng.float(0.02, 0.16),
        oz: origin.z + Math.sin(th) * rng.float(0, 0.35) * scale,
        vx: Math.cos(th) * sp,
        vy: rng.float(0.10, 0.42),
        vz: Math.sin(th) * sp,
        ax: origin.x, az: origin.z,
        drag: rng.float(2.4, 4.0),
        // Barely any lift: this dust spreads across the marble, it does not rise off it.
        buoy: rng.float(0.06, 0.20),
        roll: rng.float(0.02, 0.18),
        s0: rng.float(0.22, 0.46) * scale,
        grow: rng.float(0.55, 1.15),
        // Thin. Twenty-six of these at a fifth of a burst's opacity is a breath of dust
        // over the square, not a cloud — you should notice the rubble has gone, not the
        // dust that took it.
        alpha: rng.float(0.13, 0.24),
        fade: rng.float(0.55, 1.05),
        // Ground dust shades as buried core and would come out nearly black; it is lifted
        // here so it reads as the pale limestone powder it is.
        bright: rng.float(1.30, 1.75),
        rot: rng.gauss() * 0.5,
        spin: rng.gauss() * 0.08,
        tex: rng.int(0, 4),
        wob: 0.11,
        aspx: 1.22, aspy: 0.82,
        ph1: rng.float(0, 6.283), ph2: rng.float(0, 6.283), ph3: rng.float(0, 6.283),
        baseY: origin.y,
        reach: 0.75 * scale,
        // Read the vertical ramp against a low ceiling — a puff 25 cm up is the top of
        // THIS cloud, and should be lit like a crown rather than like the foot of a
        // four-metre column.
        top: 0.42,
      });
    }
    while (puffs.length > MAX) puffs.shift();
  }

  function update(t: number) {
    if (!mesh || !geo) return;
    world.camera.getWorldPosition(camPos);

    // Interactive only: drop puffs that can never draw again, so a long game does not
    // walk a growing dead list every frame. Under capture the list is left alone — see
    // REAP_AT.
    if (ephemeral) {
      let w = 0;
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i];
        if (t - p.born - p.delay >= REAP_AT) continue;
        puffs[w++] = p;
      }
      puffs.length = w;
    }

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

      // The room clearing the cloud. Under capture this is the linear ramp it has always
      // been, from 4.2 s over 3.0 s; interactively it is the same shape, earlier and
      // smoothed at both ends so the cloud thins away rather than being switched off.
      const clear = ephemeral
        ? 1 - smooth(CLEAR_FROM, CLEAR_FROM + CLEAR_OVER, a)
        : 1 - Math.min(1, Math.max(0, (a - CLEAR_FROM) / CLEAR_OVER));
      const alpha = p.alpha * (1 - Math.exp(-a * 16)) * Math.exp(-a * p.fade) * clear;
      if (alpha < 0.012) continue;

      const idx = live++;
      px[idx] = x; py[idx] = y; pz[idx] = z;
      // Inflation. Kept under a square root: at the old 0.62 a late puff had swollen to
      // most of the width of the whole plume, and one lobe the size of the cloud is not a
      // lobe — it is the smooth arc that gives a billboard away.
      ps[idx] = p.s0 * Math.pow(1 + p.grow * a, 0.55);
      pa[idx] = alpha;
      pr[idx] = p.rot + p.spin * a;
      pax[idx] = p.aspx;
      pay[idx] = p.aspy;

      // --- shading -------------------------------------------------------------------
      // The dust is NOT a light source. It is grey material standing in a dark room that
      // a few small flames and a weak cool fill happen to illuminate, and three things
      // decide how much of that light any part of it gets.
      const dxl = x - p.ax, dzl = z - p.az;
      const rise = y - p.baseY;
      const horiz = Math.hypot(dxl, dzl);
      const risen = Math.min(1, Math.max(0, rise / p.top));

      // 1. HEIGHT, and it dominates. This is the single biggest thing the old version got
      //    wrong: it shaded the plume almost uniformly, so the trunk came out as bright as
      //    the crown. In the film they are nothing like each other — sampled as a grid,
      //    the crown reads 0.51 and the base of the same column reads 0.15. Of course it
      //    does: the crown is up in the open with the whole room's fill on it, and the
      //    bottom two metres are standing inside their own shadow with wreckage and a dark
      //    board around them. This ramp is what turns a glowing blob into a lit column.
      const ramp = smooth(0.22, 0.92, risen);

      // 2. WHICH WAY IT FACES. A puff is a lump on the outside of a rising mass, so its
      //    shading normal points out from the plume's axis at its own height, tipping
      //    upward as it nears the crown. This gives the mass a lit shoulder and a shadow
      //    side — the modelling that makes it read as a volume rather than as a stain.
      const upBias = 0.28 + 0.52 * risen;
      const len = Math.hypot(dxl, upBias, dzl) || 1;
      const lam = 0.5 + 0.5 * ((dxl * KEY.x + upBias * KEY.y + dzl * KEY.z) / len);

      // 3. HOW DEEP INSIDE IT IS. Near the axis and low down is the core of the cloud,
      //    with a metre of its own dust between it and any light. It reads deeper, not
      //    black — self-shadowed dust is still dust.
      //    Gated on age: for the first fraction of a second every puff is still sitting on
      //    the axis, so without the gate the whole fresh burst would shade as buried core
      //    and `piece-mid-strike` would catch a dark cloud instead of the detonation.
      const opened = Math.min(1, a / 0.35);
      const buried = Math.max(0, 1 - horiz / (p.reach * 1.05))
        * Math.max(0, 1 - risen * 1.15) * opened;

      // The vertical ramp is a property of a SETTLED column. A burst half a second old has
      // not sorted itself into crown and trunk yet — it is one violent pale mass, the
      // brightest thing in that frame — so the ramp fades in over the first second and
      // before that everything shades at a single bright-but-unclipped level.
      const settled = Math.min(1, a / 0.95);
      const vert = (0.05 + 0.95 * ramp) * settled + 0.86 * (1 - settled);
      let b = vert * (0.58 + 0.42 * lam) * (1 - 0.44 * buried);
      b *= p.bright;
      pb[idx] = Math.min(1.0, Math.max(0, b));
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
      // Lobe size, and the aspect it was thrown at. Large: the film's plume is a handful
      // of soft density lobes, and the failure this replaces was hundreds of small tight
      // ones. Density now comes from a few deep overlaps at low opacity rather than from
      // a great many opaque quads.
      sz[n * 2] = ps[i] * 1.42 * pax[i];
      sz[n * 2 + 1] = ps[i] * 1.42 * pay[i];
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
    settle,
    update,
    dispose() {
      geo?.dispose();
      material?.dispose();
      atlas?.dispose();
      puffs.length = 0;
    },
  };
}
