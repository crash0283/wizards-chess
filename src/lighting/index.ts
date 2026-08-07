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
import { PlayGradeShader } from './grade-play';
import { FIRE } from './palette';
import { isPlayView } from './view';

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
  /**
   * Is this run being lit for PLAY_SHOT rather than for one of the six film shots? See
   * view.ts — it is decided by which shot main.ts is about to aim, so the six judged
   * frames are excluded by construction and not by luck.
   */
  const play = isPlayView(world);

  const group = new THREE.Group();
  group.name = 'lighting';

  // --- the cold room ------------------------------------------------------------------
  /**
   * The rig itself is NOT re-hung for the play camera, and that is a measured decision
   * rather than a reluctance to touch it.
   *
   * The obvious theory was that a top-down camera mirrors the environment's bright zenith
   * (COLD.envTop, at environmentIntensity 0.72) off the polished marble over the board's
   * whole area at once, where `wide-establishing`'s 24-degree view mirrors the dark
   * horizon band instead — "lit as a self-luminous plane". It is a good theory and it is
   * wrong. Halving the top stop of the prefiltered environment for this camera and
   * re-capturing the play frame moved the board not at all: sampling every square of the
   * four empty ranks, the navy squares came back at rgb 24,33,53 with a median of 32 and a
   * 95th percentile of 46 BOTH TIMES, to the byte, and the cream squares likewise. The
   * marble's `envMapIntensity` is 0.20 against a rough surface, so the IBL is worth under
   * two counts on the board; what it does change is the chroma of everything else in the
   * room, which is not what was asked for. The measurement is recorded here so the next
   * round does not spend a capture on it again.
   *
   * The board's brightness comes from the aisle strip and the sheen — diffuse and grazing
   * specular from real lights — and those are shared with the film shots and are where
   * five rounds of matching the reference frames actually live. So the play camera's
   * problem is fixed downstream, in the tone response, where it can be fixed without
   * touching a single watt the film shots depend on. See grade-play.ts.
   */
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

  /**
   * The ceiling on that lift, and it is the one number that decides whether a board full
   * of captures stays readable.
   *
   * `uFlash` multiplies the WHOLE frame's exposure. At 0.6 — the film shots' value, set so
   * a capture reads as a real event from 23 m out at a grazing angle — the play camera's
   * board goes up by two thirds of a stop across its entire surface, and the play camera
   * is already looking straight down the specular axis of that board. That is a white
   * plane. The flare LIGHTS are untouched, so an impact still throws real light on real
   * geometry and the dust burst still blows; what comes down is only the global lift laid
   * over everything else in the picture on top of them.
   */
  const flashCeiling = play ? 0.16 : high ? 0.6 : 0.26;

  /**
   * Real seconds elapsed, tracked here rather than taken from `dt`, because a flare's
   * decay is the one duration in this piece that a PERSON waits out.
   *
   * `world.time` accumulates a dt clamped at 0.05 s, so on a slow frame it runs far behind
   * the wall clock and a 0.55-second flare sits on the room for the best part of a minute.
   * Capture after capture that is a permanent white bloom over the middle of the board —
   * the exact complaint. game/interactive.ts already scales the decay it ASKS for to
   * compensate, but this piece must not depend on a caller doing that: a flare that
   * outlives its welcome is a lighting bug wherever the number came from.
   *
   * Under capture `world.realTime` is exactly `world.time` and nothing here is used —
   * `ageDt` is literally `dt`, the same variable the loop always added, so the film path's
   * arithmetic is unchanged to the bit.
   *
   * MEASURED, driving the real interactive page and firing ten impacts 1.5 REAL seconds
   * apart — the tempo of a fast game — while reading the flare lights' intensity back out
   * of the scene graph. On this box scene time ran at 3.6% of the wall clock (33.9 s of
   * real time bought 1.0 s of scene time), which is the pathological ratio the whole
   * problem depends on: aged in scene seconds a 0.55 s flare needs FIFTEEN real seconds to
   * expire, so the next capture always lands first and the light never goes out. Aged in
   * real seconds it read 253 at the strike, 2.1 one second after the last impact, and 0.0
   * one second after that — and it was still 0.0 fifteen seconds later. The sum across all
   * slots never once exceeded one flare's worth.
   */
  let lastRealTime = 0;

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

  // The film grade, the play grade, or the low tier's. `GradeShader` is what the six
  // reference critics judge and it is reached by exactly the same expression it always
  // was for every one of them; `play` can only be true for PLAY_SHOT. See grade-play.ts.
  const gradePass = new ShaderPass(
    high ? (play ? PlayGradeShader : GradeShader) : LowGradeShader,
  );
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

    // How much a flare ages this frame. Under capture: `dt`, the same value the loop has
    // always added — not a recomputed one, because `realTime - lastRealTime` is only
    // ALGEBRAICALLY equal to dt and differs from it in the last bits of a float, which is
    // enough to move a pixel. Interactive: real seconds, clamped so a stalled tab or a
    // shader compile cannot expire a flare in a single frame.
    const realDt = Math.min(0.25, Math.max(0, world.realTime - lastRealTime));
    lastRealTime = world.realTime;
    const ageDt = world.capturing ? dt : realDt;

    let flash = 0;
    for (const s of flareSlots) {
      if (!s.active) continue;
      s.age += ageDt;
      const k = 1 - s.age / s.decay;
      if (k <= 0) {
        s.active = false;
        s.age = 0;
        s.intensity = 0;
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
    flashLevel = Math.min(flashCeiling, flash * 0.22);
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
      /**
       * The lifetime, and interactively it is CLAMPED however long a caller asks for.
       *
       * The slots are aged in real seconds now (see the updater), so this number is a
       * duration a person actually experiences. 0.9 s is about as long as a stone bursting
       * can keep throwing light before it stops reading as an event and starts reading as
       * a lamp someone left on over the board. Under capture the requested value is passed
       * through exactly as it always was — `Math.max(0.05, decay)`, character for
       * character — because the film shots' flares are part of frames that have to come
       * back bit-identical.
       */
      best.decay = world.capturing
        ? Math.max(0.05, decay)
        : Math.min(0.9, Math.max(0.05, decay));
      best.intensity = intensity;
      best.active = true;
      best.light.intensity = intensity * 220;

      /**
       * And interactively, exactly ONE flare burns at a time.
       *
       * The three slots exist so a film shot can overlap several impacts inside one
       * capture. In play they are an accumulator: each is a 250-intensity point light
       * hanging over the middle of the board, and captures arrive minutes apart in scene
       * time but seconds apart in a player's, so slot two lights before slot one has
       * finished and slot three before slot two — three times the light on the one surface
       * the player is trying to read, which is what "the board centre becomes a permanent
       * white bloom" is made of. Clearing the others here makes the pile-up impossible by
       * construction rather than by hoping the decay outruns the next capture.
       */
      if (!world.capturing) {
        for (const s of flareSlots) {
          if (s === best) continue;
          s.active = false;
          s.age = 0;
          s.intensity = 0;
          s.light.intensity = 0;
        }
      }
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
