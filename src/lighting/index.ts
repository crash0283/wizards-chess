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
  const flames = createFlames(world, { lightCount: high ? 24 : 10 });
  group.add(flames.group);

  // --- impact flares ------------------------------------------------------------------
  // Always present, intensity 0 when idle, so the light count — and therefore every
  // compiled shader — stays constant for the whole run.
  const flareSlots: FlareSlot[] = [];
  for (let i = 0; i < (high ? 3 : 2); i++) {
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

  const atmoPass = new ShaderPass(AtmosphereShader);
  atmoPass.material.depthTest = false;
  atmoPass.material.depthWrite = false;
  const au = atmoPass.uniforms as Record<string, { value: any }>;
  composer.addPass(atmoPass);

  // Bloom thresholded well above anything the cold ambient can reach, so it only ever
  // touches flame cores, the specular bloom off the marble and a dust burst.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    high ? 0.13 : 0.11,
    0.22,
    1.0,
  );
  composer.addPass(bloom);

  const gradePass = new ShaderPass(GradeShader);
  gradePass.material.depthTest = false;
  gradePass.material.depthWrite = false;
  gradePass.renderToScreen = true;
  composer.addPass(gradePass);

  const gu = gradePass.uniforms as Record<string, { value: any }>;
  gu.uAspect.value = width / Math.max(1, height);
  gu.uTexel.value.set(1 / width, 1 / height);

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
    flashLevel = Math.min(0.6, flash * 0.22);
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
      if (changed) {
        // RenderTarget.setSize does not resize an attached depth texture, so swap in
        // fresh ones at the new size and release the old.
        for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
          const old = rt.depthTexture;
          rt.depthTexture = makeDepth(width, height);
          old?.dispose();
        }
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
      atmoPass.dispose();
      bloom.dispose();
      renderPass.dispose();
      composer.dispose();
    },
  };

  return api;
}
