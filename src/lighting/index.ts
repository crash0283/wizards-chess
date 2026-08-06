/**
 * PIECE: lighting — firelight, atmosphere, tone response, and the whole render path.
 *
 * The reference frames are a COLD room: desaturated blue-slate, soft cool ambient
 * modelling everything across a very deep space, with many small individual flames
 * burning on the board's kerb and among the pieces. Each flame is intensely bright —
 * near the only near-white pixels in frame — but lights only a metre or two around
 * itself. The flames do not warm the room. That relationship is the whole shot.
 *
 * Owns: scene.fog / scene.background / scene.environment (atmosphere is lighting), the
 * light rig, the flame system, and the post chain. `main.ts` calls `render()` every
 * frame instead of `renderer.render`, so the composer below is the only render path.
 *
 * Determinism: every random decision comes from a fork of `world.rng`, every animated
 * value is a function of `world.time`. No clocks.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import type { Board, Chamber, Lighting } from '../core/api';
import type { World } from '../core/world';
import { RENDER } from '../core/constants';
import { AtmosphereShader } from './atmosphere';
import { createEnvironment } from './environment';
import { createFlames } from './flames';
import { GradeShader } from './grade';
import { LowGradeShader } from './grade-low';
import { FIRE } from './palette';

interface FlareSlot {
  light: THREE.PointLight;
  age: number;
  decay: number;
  intensity: number;
  active: boolean;
}

export function createLighting(
  world: World,
  _deps: { chamber: Chamber; board: Board },
): Lighting {
  const high = world.quality === 'high';

  const group = new THREE.Group();
  group.name = 'lighting';

  // --- the cold room ------------------------------------------------------------------
  const env = createEnvironment(world);
  group.add(env.group);
  env.apply(world.scene);

  // --- the flames ---------------------------------------------------------------------
  // The light pool, not the fire count: all forty-six flames still burn at both tiers,
  // with the same layout, the same colours, the same flicker and the same contact pools
  // and reflections in the stone. What scales is how many of them get a real
  // inverse-square light, and `assign()` already spends that pool on whichever fires
  // matter most for the current camera — so the near kerb still uplights the pieces standing
  // on it, and the fires further off keep their glow, their contact pool and their
  // reflection and lose only their two-metre wash.
  //
  // Eight, not the six this round first tried. At six the bottom band of the play frame —
  // the near kerb, the leaning screens either side of it, the stone the nearest fires stand
  // on — measured a fifth darker than it had been, because `assign()` ranks by size/d² and
  // spends a small pool entirely on the fires closest to the lens, leaving the ones out at
  // the frame edges with no light at all. Two more lights bought that band back. Each of
  // them costs every fragment in the scene an iteration of the point-light loop, so this is
  // the one number here that was set by measuring both directions; see environment.ts.
  const flames = createFlames(world, {
    lightCount: high ? 24 : 8,
    bounceCount: high ? 4 : 2,
  });
  group.add(flames.group);

  // --- impact flares ------------------------------------------------------------------
  // Always present, intensity 0 when idle, so the light count — and therefore every
  // compiled shader — stays constant for the whole run.
  //
  // One at 'low'. Two impacts never overlap in interactive play — a capture is a single
  // event resolved before the next move begins — so the second slot only ever exists to be
  // stolen, and it costs a point-light iteration in every fragment shader for the whole
  // session to do it.
  const flareSlots: FlareSlot[] = [];
  for (let i = 0; i < (high ? 3 : 1); i++) {
    const light = new THREE.PointLight(new THREE.Color(FIRE.flare), 0, 26, 2);
    light.castShadow = false;
    group.add(light);
    flareSlots.push({ light, age: 0, decay: 1, intensity: 0, active: false });
  }
  /** 0..1, feeds a brief global exposure lift in the grade. */
  let flashLevel = 0;

  // --- post chain ---------------------------------------------------------------------
  const size = world.renderer.getSize(new THREE.Vector2());
  let width = size.width || RENDER.width;
  let height = size.height || RENDER.height;

  // The atmosphere pass rebuilds world position from depth, so the scene target needs a
  // depth texture. The composer ping-pongs its two buffers, and the pass that samples
  // depth writes into the *other* one — so BOTH buffers need their own depth texture, and
  // each frame the pass is pointed at whichever buffer RenderPass is about to fill. Give
  // buffer 2 a fresh DepthTexture rather than the composer's clone: Texture.clone()
  // shares the underlying Source, which means one GL texture, which means a
  // framebuffer/texture feedback loop and a black frame.
  const makeDepth = (w: number, h: number) => {
    const d = new THREE.DepthTexture(w, h);
    d.format = THREE.DepthFormat;
    d.type = THREE.UnsignedIntType;
    return d;
  };
  // MSAA on the scene buffer. `antialias: true` on the renderer only ever applied to the
  // default framebuffer, which this composer bypasses entirely — so every edge in the
  // room was rendering hard-aliased. That is both an instant "this is a render" tell and
  // a large chunk of the measured high-frequency energy: the reference frame's detail
  // total is 0.020 and stair-stepped plinth and arcade edges alone were pushing ours to
  // twice that. Samples resolve down to the depth texture too, so the atmosphere pass
  // still gets clean depth.
  const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: high ? 4 : 0,
    depthTexture: makeDepth(width, height),
  });
  sceneTarget.texture.name = 'lighting.scene';

  const composer = new EffectComposer(world.renderer, sceneTarget);
  composer.renderTarget2.depthTexture = makeDepth(width, height);
  composer.setSize(width, height);

  const renderPass = new RenderPass(world.scene, world.camera);
  composer.addPass(renderPass);

  /**
   * The atmosphere pass exists as a pass only at 'high'. At 'low' the identical shader
   * body is inlined into the front of the grade (see grade-low.ts), and that single change
   * retires a full-frame RGBA16F buffer AND its depth texture as well as the pass.
   *
   * Why the buffer goes with it. EffectComposer ping-pongs between two targets and swaps
   * only after a pass whose `needsSwap` is true. RenderPass and UnrealBloomPass both
   * declare `needsSwap = false` and both write into `readBuffer`; the only swapping pass in
   * this chain was the atmosphere one. With it gone — and with the grade's own swap turned
   * off below, since nothing follows it — there are zero swaps in the frame, `readBuffer`
   * is `renderTarget2` for the life of the page, and `renderTarget1` is never bound by
   * anything at all. It is held at 1x1 in setSize() rather than allocated as a second
   * full-size HDR buffer with a second full-size depth texture.
   *
   * If a pass is ever added after the grade, this reasoning has to be redone: restore the
   * grade's needsSwap and give renderTarget1 its size and depth texture back.
   */
  let atmoPass: ShaderPass | null = null;
  if (high) {
    atmoPass = new ShaderPass(AtmosphereShader);
    atmoPass.material.depthTest = false;
    atmoPass.material.depthWrite = false;
    composer.addPass(atmoPass);
  }

  // Bloom thresholded well above anything the cold ambient can reach, so it only ever
  // touches flame cores, the specular bloom off the marble and a dust burst.
  //
  // TRIED AND REVERTED, worth recording: dropping this threshold to 0.42 with the radius
  // opened to 0.85, to get a film-print halation across the whole picture. It does soften
  // the board's ink-black veining — the mid and fine detail bands each came down about
  // 0.003 — but a global bright-pass in a room lit by thirty fires is a machine for
  // warming the room. The frame's warm fraction went from 0.146 to 0.233 against the
  // film's 0.139, the median rose 0.05, and two thirds of the shadow population
  // disappeared. Halation is the right idea; a bloom pass is the wrong instrument for it,
  // because it is symmetric and unbounded and the flames dominate it. It now happens in
  // the grade instead, one-sided and at a few texels (see `uHalation`).
  /**
   * The bloom's working resolution, and at 'low' it is PINNED rather than tracking the
   * frame — which is a fix as much as a saving.
   *
   * UnrealBloomPass is not resolution-independent. It builds five mips from half the
   * resolution it is given and blurs each with a fixed 3/5/7/9/11-tap kernel measured in
   * that mip's own texels, so the width of the bloom as a FRACTION OF THE PICTURE goes as
   * 1 / resolution. The adaptive scaler hands this pass whatever buffer it has settled on,
   * so on a phone pinned at its floor the bloom was running off a 256-px mip chain and
   * spreading two and a half times as far across the frame as the same code does on the
   * 1920-px capture the strength was tuned against. That is a large part of why the near
   * pieces came back white: they are the pixels immediately around the near kerb's fires,
   * and they were being handed a flame's worth of additive energy smeared over them.
   *
   * Pinned at 448 px wide the bloom's radius is a constant fraction of the frame whatever
   * the scaler is doing, and its eleven render targets stop being a function of the canvas
   * at all: 1.8 MB, fixed, instead of 2.3 MB at the scaler's floor rising to 14 MB if the
   * scaler ever climbs back to a phone's full 1280. Strength comes down with it, because a
   * kernel that no longer widens with every rung the scaler drops does not need to be
   * defended against.
   *
   * 448 rather than something larger, and the number matters: it has to sit at or below the
   * buffer the scaler is actually delivering, or the bloom costs MORE than it did. Pinned at
   * 768 — measured — the mip chain went from 2.30 MB to 3.66 MB behind a 512-px buffer,
   * which is the exact opposite of the point.
   */
  const BLOOM_PIN_W = 448;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    high ? 0.13 : 0.075,
    0.22,
    1.0,
  );
  if (!high) {
    // Neutralise the pass's own resize before it can ever be called: EffectComposer calls
    // setSize on addPass and on every composer.setSize, and either would put the mip chain
    // back on the canvas.
    (bloom as unknown as { setSize(w: number, h: number): void }).setSize = () => {};
  }
  composer.addPass(bloom);

  const gradePass = new ShaderPass(high ? GradeShader : LowGradeShader);
  gradePass.material.depthTest = false;
  gradePass.material.depthWrite = false;
  gradePass.renderToScreen = true;
  // Nothing follows it, so the swap would only be there to hand the next frame a buffer it
  // does not use. See the note on the atmosphere pass above — this is what keeps
  // renderTarget1 out of the frame entirely.
  if (!high) gradePass.needsSwap = false;
  composer.addPass(gradePass);

  const gu = gradePass.uniforms as Record<string, { value: any }>;
  // At 'low' the veil is part of this pass, so its uniforms are these ones.
  const au = (atmoPass ? atmoPass.uniforms : gradePass.uniforms) as Record<
    string,
    { value: any }
  >;
  gu.uAspect.value = width / Math.max(1, height);
  gu.uTexel.value.set(1 / width, 1 / height);

  /**
   * Aspect-track the pinned bloom, and never let it exceed the frame.
   *
   * The clamp is belt and braces rather than a live case: the scaler's lowest rung behind a
   * 1280-px canvas is 486 px, so on a phone the pin binds and the clamp does not. But the
   * ladder is not this piece's to depend on, and a bloom mip chain wider than the buffer it
   * is blooming is pure waste in the one situation — a very small frame — where waste is
   * least affordable.
   */
  const repinBloom = () => {
    if (high) return;
    const pinW = Math.max(1, Math.min(BLOOM_PIN_W, width));
    const pinH = Math.max(1, Math.round((pinW * height) / Math.max(1, width)));
    UnrealBloomPass.prototype.setSize.call(bloom, pinW, pinH);
  };
  repinBloom();

  // Grain has to move frame to frame or it reads as fixed-pattern noise, but it must
  // still be a pure function of scene time.
  const grainSeed = world.rng.fork('lighting-grain').float(0, 1000);

  world.onUpdate((t, dt) => {
    flames.tick(t);

    let flash = 0;
    for (const s of flareSlots) {
      if (!s.active) continue;
      s.age += dt;
      const k = 1 - s.age / s.decay;
      if (k <= 0) {
        s.active = false;
        s.light.intensity = 0;
        continue;
      }
      const falloff = k * k;
      s.light.intensity = s.intensity * 220 * falloff;
      flash += s.intensity * falloff;
    }
    // The global exposure lift an impact throws. Capped lower at 'low' for the same reason
    // the roll-off in grade-low.ts exists: this multiplies the WHOLE frame's exposure, and
    // PLAY_SHOT's near rank already sits at the top of the curve where wide-establishing's
    // nearest stone is twenty metres from the lens and nowhere near it. At 0.6 a capture
    // turned the two closest pieces into a hole in the picture. The flare LIGHTS are
    // untouched, so an impact still throws real light on real geometry; what comes down is
    // only the global lift laid over the whole frame on top of them.
    flashLevel = Math.min(high ? 0.6 : 0.26, flash * 0.22);
  });

  const api: Lighting & { composer: EffectComposer } = {
    group,
    composer,

    render() {
      env.apply(world.scene);
      // Light assignment happens here, not in onUpdate: main.ts aims the camera after
      // the updaters run, so this is the first point the camera is final for the frame.
      flames.assign(world.camera);

      // RenderPass fills composer.readBuffer, so that is the depth the atmosphere pass
      // must sample this frame. The buffers swap every frame; this does not.
      au.tDepth.value = (composer.readBuffer as THREE.WebGLRenderTarget).depthTexture;

      const cam = world.camera;
      cam.updateMatrixWorld();
      au.uProjInv.value.copy(cam.projectionMatrixInverse);
      au.uViewInv.value.copy(cam.matrixWorld);
      cam.getWorldPosition(au.uCamPos.value);

      gu.uSeed.value = (Math.floor(world.time * 120) % 4096) * 7.13 + grainSeed;
      gu.uFlash.value = flashLevel;
      // Explicit dt: EffectComposer's internal Timer would otherwise read the wall clock.
      composer.render(world.dt);
    },

    setSize(w: number, h: number) {
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      const changed = nw !== width || nh !== height;
      width = nw;
      height = nh;
      world.renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloom.setSize(width, height);
      repinBloom();
      if (changed) {
        // RenderTarget.setSize does not resize an attached depth texture, so swap in
        // fresh ones at the new size and release the old. At 'low' only renderTarget2 is
        // ever rendered into, so only it needs one.
        const live = high
          ? [composer.renderTarget1, composer.renderTarget2]
          : [composer.renderTarget2];
        for (const rt of live) {
          const old = rt.depthTexture;
          rt.depthTexture = makeDepth(width, height);
          old?.dispose();
        }
      }
      if (!high) {
        // The unused half of the ping-pong. composer.setSize() has just put it back to full
        // frame; it never gets bound, so it is held at one pixel and carries no depth.
        const spare = composer.renderTarget1;
        const oldDepth = spare.depthTexture;
        spare.depthTexture = null;
        oldDepth?.dispose();
        spare.setSize(1, 1);
      }
      gu.uAspect.value = width / height;
      gu.uTexel.value.set(1 / width, 1 / height);
    },

    flare(pos: THREE.Vector3, intensity: number, decay: number) {
      if (!(intensity > 0)) return;
      // Steal the slot with the least life left.
      let best = flareSlots[0];
      let bestLife = Infinity;
      for (const s of flareSlots) {
        const life = s.active ? 1 - s.age / s.decay : -1;
        if (life < bestLife) {
          bestLife = life;
          best = s;
        }
      }
      best.light.position.copy(pos);
      best.light.distance = 12 + intensity * 14;
      best.age = 0;
      best.decay = Math.max(0.05, decay);
      best.intensity = intensity;
      best.active = true;
      best.light.intensity = intensity * 220;
    },

    dispose() {
      env.dispose();
      flames.dispose();
      for (const s of flareSlots) s.light.dispose();
      gradePass.dispose();
      atmoPass?.dispose();
      bloom.dispose();
      renderPass.dispose();
      composer.dispose();
    },
  };

  return api;
}
