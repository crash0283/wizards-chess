/**
 * Entry point. FROZEN CORE — do not edit in a piece build.
 *
 * Two modes:
 *   interactive — requestAnimationFrame, real input, the actual game
 *   capture     — fixed timestep march to ?t=, render one frame, signal ready
 */
import * as THREE from 'three';
import { readCaptureRequest, signalError, signalReady } from './core/capture';
import { createWorld, runUpdaters } from './core/world';
import { getShot } from './core/shots';
import { RENDER } from './core/constants';

import { createChamber } from './chamber';
import { createBoard } from './board';
import { createLighting } from './lighting';
import { createPieceFactory } from './pieces';
import { createDestruction } from './destruction';
import { createCameraRig } from './camera';
import { createGame } from './game';

async function boot() {
  const req = readCaptureRequest();

  const canvas = document.createElement('canvas');
  const stage = document.getElementById('stage')!;
  stage.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    alpha: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(req.width, req.height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const world = createWorld({
    renderer,
    seed: req.seed,
    quality: req.quality,
    capturing: req.capturing,
  });
  world.camera.aspect = req.width / req.height;
  world.camera.updateProjectionMatrix();

  // --- assemble, in dependency order -------------------------------------------------
  const chamber = createChamber(world);
  world.scene.add(chamber.group);

  const board = createBoard(world);
  world.scene.add(board.group);

  const pieces = createPieceFactory(world);

  const destruction = createDestruction(world, { pieces });
  world.scene.add(destruction.group);

  const lighting = createLighting(world, { chamber, board });
  world.scene.add(lighting.group);
  lighting.setSize(req.width, req.height);

  const camera = createCameraRig(world);

  const game = createGame(world, { board, pieces, destruction, lighting, camera });
  game.start();
  if (req.fen) game.setPosition(req.fen);
  else game.stage(req.shot || 'wide-establishing');

  const hud = document.getElementById('hud')!;
  if (!req.showHud) hud.classList.add('hidden');

  // --- the frame ---------------------------------------------------------------------
  /**
   * Widen the vertical FOV when the viewport is narrower than the reference frame.
   *
   * MUST run after camera.update(): the camera rig sets fov from the shot definition on
   * every frame, so anything applied earlier is simply overwritten. In capture the aspect
   * is always exactly RENDER.aspect, so this is a no-op and determinism is unaffected.
   */
  const fitFov = () => {
    const aspect = world.camera.aspect;
    if (aspect >= RENDER.aspect) return;
    const halfW = Math.tan((world.camera.fov * Math.PI) / 360) * RENDER.aspect;
    world.camera.fov = (Math.atan(halfW / aspect) * 360) / Math.PI;
    world.camera.updateProjectionMatrix();
  };

  const frame = (t: number, dt: number, realT: number = t) => {
    runUpdaters(world, t, dt, realT);
    game.update(t, dt);
    for (const p of pieces.all()) p.update(t, dt);
    if (req.cam) camera.free(req.cam);
    // Interactive play uses the play camera, not a film shot — see PLAY_SHOT for why.
    else camera.applyShot(req.shot || (req.capturing ? 'wide-establishing' : 'play'), t);
    camera.update(t, dt);
    fitFov();
  };

  if (req.capturing) {
    // March deterministically. Every subsystem sees the same dt sequence every run.
    const shot = getShot(req.shot);
    const target = req.t || shot.t;
    const step = req.step;
    const steps = Math.max(1, Math.round(target / step));
    for (let i = 1; i <= steps; i++) frame(i * step, step);
    lighting.render();
    // Two extra identical renders flush any lazily-compiled shader / TAA-style history.
    lighting.render();
    signalReady();
  } else {
    /**
     * Compile every program in the scene BEFORE the first frame, not during the first move.
     *
     * The capture branch below has always flushed lazily compiled shaders with two throwaway
     * renders before it grabs a frame; the interactive branch had no equivalent, so a
     * program's first compile and link landed on whatever frame first drew the thing that
     * needed it. In practice that is the frame a blade lands — the torn fabric of a
     * shattered man and the dust plume are both drawn for the first time there — on top of
     * a Voronoi fracture and sixty-odd fresh geometries entering the scene.
     *
     * three walks the graph and compiles what it finds, so anything already resident is
     * paid for here, during load, where a hundred milliseconds costs nothing and nobody is
     * watching an animation. It cannot cover a material that does not exist yet, which is
     * why dust.ts now builds its mesh in its constructor rather than on first burst.
     */
    renderer.compile(world.scene, world.camera);

    let last = 0;
    let elapsed = 0;
    let startMs = 0;
    const loop = (ms: number) => {
      const now = ms / 1000;
      // dt is clamped so one long frame cannot explode the physics; `elapsed` therefore
      // runs behind the wall clock on a slow renderer. Anything a person is waiting on
      // must use realT instead — see World.realTime.
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, now - last);
      last = now;
      if (startMs === 0) startMs = ms;
      elapsed += dt;
      frame(elapsed, dt, (ms - startMs) / 1000);
      lighting.render();
      const s = game.state();
      hud.textContent =
        `${s.turn} to move   move ${s.moveNumber}   ${s.inCheck ? 'CHECK   ' : ''}` +
        `${s.result !== 'playing' ? s.result.toUpperCase() : ''}` +
        `${s.thinking ? '   thinking…' : ''}`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    /**
     * Fit the frame to whatever screen this is.
     *
     * Capture is always 1920x804 at 2.39:1 — that is the frame the shots are composed for
     * and it must never change, or renders stop being comparable. Interactive play is a
     * different problem: on a phone a letterboxed 2.39:1 strip is unusably small, so the
     * canvas fills the viewport and the camera compensates.
     *
     * The compensation matters. FOV in three.js is VERTICAL, so simply handing the camera
     * a taller aspect keeps the vertical extent and crops the sides — on a phone that
     * throws away most of the board. Instead the horizontal extent is held constant and
     * the vertical FOV is derived from it, so a narrower screen shows MORE height rather
     * than less width, and the board stays in frame.
     *
     * Device pixel ratio is capped: a modern phone reports 3, which on this scene means
     * rendering nine times the pixels and, on mobile Safari, a very good chance of the tab
     * being killed for memory.
     */
    const fit = () => {
      const w = Math.max(1, innerWidth);
      const h = Math.max(1, innerHeight);
      const dpr = Math.min(devicePixelRatio || 1, w * h > 1_200_000 ? 1.25 : 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      lighting.setSize(w, h);

      // The FOV compensation itself lives in fitFov(), applied per frame after the camera
      // rig has set fov from the shot — see the note there.
      world.camera.aspect = w / h;
      world.camera.updateProjectionMatrix();
    };
    addEventListener('resize', fit);
    addEventListener('orientationchange', () => setTimeout(fit, 120));
    fit();
  }

  // Debug handle. tools/play-test.mjs drives the interactive path through this, so THREE
  // is included for projecting board squares to screen coordinates.
  (window as any).__WC__ = { world, chamber, board, lighting, pieces, destruction, camera, game, THREE };
}

boot().catch(signalError);
