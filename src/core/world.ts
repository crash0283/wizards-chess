/**
 * The World object every piece receives. FROZEN CORE — do not edit in a piece build.
 *
 * A piece module never reaches for globals. Everything it needs (scene graph, rng,
 * deterministic time, quality tier, the shared material library) arrives here, so the
 * same module renders identically under the dev server and under the capture harness.
 */
import * as THREE from 'three';
import { makeRng, type Rng } from './rng';

export type Quality = 'low' | 'high';

export interface World {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Root rng. Fork it per subsystem — never consume it directly from a module. */
  rng: Rng;
  seed: number;
  /** Deterministic scene time in seconds. Read this, never performance.now(). */
  time: number;
  /** Seconds since the previous update. Fixed under capture. */
  dt: number;
  /**
   * Real elapsed seconds — UI timing only, never animation.
   *
   * `time` accumulates a CLAMPED dt so a long frame cannot explode the physics. On a slow
   * renderer that makes scene time run far behind the wall clock, which is fine for motion
   * but wrong for anything a person is waiting on: an engine-reply pause specified as 1.9 s
   * of scene time became ~40 s of real time under software GL.
   *
   * Under capture this is exactly equal to `time`, so determinism is unaffected. Use it for
   * "how long has the human been waiting", and `time` for everything that moves.
   */
  realTime: number;
  quality: Quality;
  /** Set true when running under tools/capture.mjs. Disables anything non-deterministic. */
  capturing: boolean;
  /** Per-frame registry of things that want updating. */
  onUpdate(fn: (t: number, dt: number) => void): void;
  /** Emits scene-wide events (used by game flow -> destruction, camera shake, audio). */
  emit(event: string, payload?: unknown): void;
  on(event: string, fn: (payload: any) => void): void;
}

export function createWorld(opts: {
  renderer: THREE.WebGLRenderer;
  seed: number;
  quality: Quality;
  capturing: boolean;
}): World {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1920 / 804, 0.1, 400);
  const updaters: Array<(t: number, dt: number) => void> = [];
  const listeners = new Map<string, Array<(p: any) => void>>();

  const world: World = {
    scene,
    renderer: opts.renderer,
    camera,
    rng: makeRng(opts.seed),
    seed: opts.seed,
    time: 0,
    dt: 0,
    realTime: 0,
    quality: opts.quality,
    capturing: opts.capturing,
    onUpdate(fn) {
      updaters.push(fn);
    },
    emit(event, payload) {
      const l = listeners.get(event);
      if (l) for (const fn of l.slice()) fn(payload);
    },
    on(event, fn) {
      let l = listeners.get(event);
      if (!l) listeners.set(event, (l = []));
      l.push(fn);
    },
  };

  (world as any).__runUpdaters = (t: number, dt: number, realT: number) => {
    world.time = t;
    world.dt = dt;
    world.realTime = realT;
    for (const fn of updaters) fn(t, dt);
  };

  return world;
}

/**
 * `realT` defaults to `t`, which is what capture mode wants: there, scene time IS real
 * time and the two must not diverge or determinism breaks.
 */
export function runUpdaters(world: World, t: number, dt: number, realT: number = t) {
  (world as any).__runUpdaters(t, dt, realT);
}
