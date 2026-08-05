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
  const frame = (t: number, dt: number) => {
    runUpdaters(world, t, dt);
    game.update(t, dt);
    for (const p of pieces.all()) p.update(t, dt);
    if (req.cam) camera.free(req.cam);
    else camera.applyShot(req.shot || 'wide-establishing', t);
    camera.update(t, dt);
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
    let last = 0;
    let elapsed = 0;
    const loop = (ms: number) => {
      const now = ms / 1000;
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, now - last);
      last = now;
      elapsed += dt;
      frame(elapsed, dt);
      lighting.render();
      const s = game.state();
      hud.textContent =
        `${s.turn} to move   move ${s.moveNumber}   ${s.inCheck ? 'CHECK   ' : ''}` +
        `${s.result !== 'playing' ? s.result.toUpperCase() : ''}` +
        `${s.thinking ? '   thinking…' : ''}`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    addEventListener('resize', () => {
      const w = Math.min(innerWidth, Math.round(innerHeight * RENDER.aspect));
      const h = Math.round(w / RENDER.aspect);
      renderer.setSize(w, h, false);
      lighting.setSize(w, h);
      world.camera.aspect = RENDER.aspect;
      world.camera.updateProjectionMatrix();
    });
    dispatchEvent(new Event('resize'));
  }

  (window as any).__WC__ = { world, chamber, board, lighting, pieces, destruction, camera, game };
}

boot().catch(signalError);
