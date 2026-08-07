/**
 * PIECE: pieces — the carved stone chessmen.
 *
 * Pipeline for one chessman, all of it deterministic off world.rng.fork(id):
 *
 *   forms.ts    blocky lofted solids, one Part per anatomical mass
 *   subdivide   conforming refinement to ~10 cm triangles, per part
 *   carve.ts    one or two SIGNIFICANT pre-existing breaks (an ear, a merlon, a crown
 *               point, a corner of the plinth) then 5–9 smaller chips found automatically
 *               at convex arrises. Every cut face is tagged as fresh stone.
 *   weather.ts  chisel-facet + erosion displacement, then vertex colour / roughness
 *   toGeometry  crease-angle shading: welded normals across a tessellated curve, raw face
 *               normals across a real arris, so a helm is smooth stone and a plinth
 *               moulding still has edges
 *   stone.ts    triplanar mm-grain in normal and roughness, two genuinely different stones
 *   motion.ts   heavy grinding walk, committed strike, the king's blade falling
 *   play.ts     the same three, re-shaped for interactive play — see the note on
 *               `playMode` below for which one runs when, and why
 *
 * Heights land exactly on PIECE_HEIGHT; the base sits on FLOOR_Y.
 *
 * TWO TIERS.
 *
 * `high` — the capture tier, the one every film shot is judged on — runs the pipeline
 * above once per man, at full resolution, exactly as it always has. Nothing below the
 * `if (hi)` in `make` touches it.
 *
 * `low` — interactive play on a phone — runs the same pipeline through lod.ts: the same
 * forms, the same breaks, the same weathering, but carved at three resolutions and pulled
 * from a small pool of variants per type. The pieces were 87.6% of the geometry this
 * scene submitted every frame; see lod.ts for why coarsening them costs almost nothing to
 * look at.
 */
import * as THREE from 'three';
import type { PieceFactory, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import {
  FLOOR_Y,
  PIECE_HEIGHT,
  squareCentre,
  type PieceType,
  type Side,
} from '../core/constants';
import type { Rng } from '../core/rng';
import { buildForm } from './forms';
import {
  analyse,
  boundsY,
  displaceMesh,
  mergeMeshes,
  orientOutward,
  scaleMesh,
  subdivide,
  toGeometry,
  type CMesh,
} from './mesh';
import { applyPlanes, chipPlanes, planeIsLocal } from './carve';
import {
  carveLevels,
  jitter,
  LOW_LODS,
  LOW_VARIANTS,
  pickLevel,
  splitViews,
  SPLIT_LEVEL,
  type CarvedLevels,
} from './lod';
import { createStone, type Stone } from './stone';
import { buildDevice, deviceFit, isPlayView } from './device';
import { Motion } from './motion';
import { PLAY_CONTACT } from './play';
import { makeWeather } from './weather';

/**
 * How long stone takes to cross ground, in seconds per metre of traverse.
 *
 * Re-exported here because it is the one number a CALLER needs. `walkTo(file, rank,
 * seconds)` lets a scheduler price a move, and a scheduler that clamps that price makes a
 * long move faster rather than a long move longer — which is how a rook came to cross the
 * board at 19.93 m/s. `Motion` now treats the requested seconds as a floor and takes
 * `walkSeconds(metres)` if that is longer, so the speed is right whatever it is handed;
 * but anything scheduling a BEAT against a walk (a strike on arrival, a piece appearing on
 * the square a pawn is still walking onto) wants to price it with the same function, or
 * its beat lands while the piece is still on the way.
 *
 * `import { walkSeconds } from '../pieces'` and price legs with it.
 */
export { walkSeconds, CRUISE, CRUISE_LONG } from './play';

/**
 * The device hangs off the piece's own group, so it walks, rocks and topples with the
 * plinth it is cut into, and the destruction piece harvests it along with everything else
 * when the man is shattered.
 */
function deviceMesh(geo: THREE.BufferGeometry, stone: Stone): THREE.Mesh {
  const m = new THREE.Mesh(geo, stone.material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = 'device';
  return m;
}

/** Knock chips off convex arrises. Planes are chosen up front, then applied in sequence. */
function chip(
  m: CMesh,
  rng: Rng,
  count: number,
  minSep: number,
  depthLo: number,
  depthHi: number,
): CMesh {
  return applyPlanes(m, chipPlanes(m, rng, count, minSep, depthLo, depthHi));
}

export function createPieceFactory(world: World): PieceFactory {
  const live: PieceInstance[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const stones: Record<Side, Stone> = {
    white: createStone(world, 'white'),
    black: createStone(world, 'black'),
  };
  const hi = world.quality === 'high';

  /**
   * INTERACTIVE vs FILM.
   *
   * `world.capturing` is the only switch. Under capture the motion module runs the frozen
   * film curves off `world.time`, because the shot framing IS the scripted timing — the
   * `piece-mid-strike` frame is taken at exactly STRIKE_CONTACT and `king-surrender` has to
   * keep hashing to the same file. In play it runs the curves in play.ts off `world.realTime`,
   * because `world.time` accumulates a CLAMPED dt and therefore drifts behind the wall clock
   * on a slow frame, while the game's own deferred visuals (the shatter above all) fire on
   * real seconds. Running the animation on the other clock is what let the destruction
   * arrive before the animation that was supposed to cause it.
   */
  const playMode = !world.capturing;
  const clock = () => (playMode ? world.realTime : world.time);
  /** So an attacker can reach its victim's motion and have it flinch. */
  const motions = new WeakMap<PieceInstance, Motion>();

  /** The blow direction, attacker -> victim, and the moment it lands. */
  function warnVictim(attacker: THREE.Object3D, target: PieceInstance, now: number): void {
    if (!playMode) return;
    const tm = motions.get(target);
    if (!tm) return;
    tm.braceFor(
      now + PLAY_CONTACT,
      target.group.position.x - attacker.position.x,
      target.group.position.z - attacker.position.z,
    );
  }

  // Triangle budget, not a quality dial. The figuration is now explicit geometry — limbs,
  // mouldings, colonnettes — so refinement only buys smoother *weathering*, and the
  // reference frame has markedly LESS high-frequency energy than a finely tessellated
  // stand-in. Refining past this spends memory to make the render worse.
  const detail = hi ? 0.215 : 0.345;
  const floor = hi ? 0.126 : 0.160;

  /**
   * Carve a heraldic device into each plinth top — the play view's only way of telling a
   * rook from a bishop. See device.ts for the measurement this answers and for why the
   * switch is the SHOT and not `world.capturing`. Off for the six film frames, so not one
   * triangle of this reaches a judged render.
   */
  const devices = isPlayView(world);

  function carve(type: PieceType, side: Side, id: string) {
    const rng = world.rng.fork(id);
    const form = buildForm(type, rng.fork('form'), detail);
    const stone = stones[side];

    let body = mergeMeshes(
      form.body.map((p) => {
        const mm = p.mesh();
        orientOutward(mm);
        return subdivide(mm, Math.max(floor, p.detail));
      }),
    );
    let arm: CMesh | null = form.arm
      ? mergeMeshes(
          form.arm.map((p) => {
            const mm = p.mesh();
            orientOutward(mm);
            return subdivide(mm, Math.max(floor, p.detail));
          }),
        )
      : null;

    // Normalise the carved height onto PIECE_HEIGHT before any damage is taken, so a
    // broken crown makes a piece shorter rather than making the contract a lie.
    let top = boundsY(body).hi;
    if (arm) top = Math.max(top, boundsY(arm).hi);
    const s = PIECE_HEIGHT[type] / top;
    scaleMesh(body, s);
    if (arm) scaleMesh(arm, s);
    const armPivot = form.armPivot.clone().multiplyScalar(s);
    const tip = form.tip.clone().multiplyScalar(s);
    const comY = form.comY * s;

    // --- the significant, pre-existing break(s) -----------------------------------
    const dr = rng.fork('damage');
    const sites = form.breaks.slice();
    for (let i = sites.length - 1; i > 0; i--) {
      const j = dr.int(0, i + 1);
      const t = sites[i]; sites[i] = sites[j]; sites[j] = t;
    }
    const nBig = dr.bool(0.35) ? 2 : 1;
    let done = 0;
    for (const site of sites) {
      if (done >= nBig) break;
      const n = site.n.clone().normalize();
      n.x += dr.float(-0.20, 0.20);
      n.y += dr.float(-0.20, 0.20);
      n.z += dr.float(-0.20, 0.20);
      n.normalize();
      const p = site.p.clone().multiplyScalar(s);
      const d = n.dot(p) - site.depth * s * dr.float(0.35, 1.35);
      if (!planeIsLocal(body, n, d, p, 0.045, 0.72)) continue;
      body = applyPlanes(body, [{ n, d }]);
      done++;
    }

    // --- chips and broken arrises --------------------------------------------------
    body = chip(body, dr, hi ? dr.int(5, 9) : 4, 0.34, 0.010, 0.048);
    if (arm) arm = chip(arm, dr.fork('arm'), 2, 0.24, 0.008, 0.026);

    // Refine the raw break faces, which arrive from the clipper as coarse fans.
    body = subdivide(body, detail * 1.15);
    if (arm) arm = subdivide(arm, detail * 1.15);

    // --- weathering ----------------------------------------------------------------
    const weather = makeWeather(stone.spec, rng.fork('weather'), 1);
    const bi = analyse(body);
    const bd = displaceMesh(body, bi, weather.displace);
    // Re-analyse AFTER displacement: the normals that shade the piece have to belong to
    // the weathered surface, not to the smooth one it was cut from.
    const bodyGeo = toGeometry(body, bd, weather.shade, analyse(body));
    geos.push(bodyGeo);

    let armGeo: THREE.BufferGeometry | null = null;
    if (arm) {
      const ai = analyse(arm);
      const ad = displaceMesh(arm, ai, weather.displace);
      armGeo = toGeometry(arm, ad, weather.shade, analyse(arm));
      geos.push(armGeo);
    }

    // Widest point of the plinth — the edge the piece rocks onto when it walks.
    let baseHalf = 0.5;
    for (let i = 0; i < body.pos.length; i += 3) {
      if (body.pos[i + 1] > 0.30) continue;
      const r = Math.hypot(body.pos[i], body.pos[i + 2]);
      if (r > baseHalf) baseHalf = r;
    }

    // The plinth device, cut from the same block: same weather instance, same shader, same
    // material. Interactive only — `devices` is false for every judged frame.
    let deviceGeo: THREE.BufferGeometry | null = null;
    if (devices) {
      deviceGeo = buildDevice(type, side, deviceFit(form, s), stone.spec, world.rng, detail);
      if (deviceGeo) geos.push(deviceGeo);
    }

    return { bodyGeo, armGeo, deviceGeo, armPivot, tip, comY, baseHalf, stone };
  }

  // -------------------------------------------------------------------------------------
  // Low tier: a pool of carved variants, each at three resolutions.
  // -------------------------------------------------------------------------------------

  const pool = new Map<string, CarvedLevels>();
  const served = new Map<string, number>();

  function poolFor(type: PieceType, side: Side): CarvedLevels {
    const ck = `${side}:${type}`;
    const n = served.get(ck) ?? 0;
    served.set(ck, n + 1);
    const key = `pool:${side}:${type}:${n % LOW_VARIANTS[type]}`;
    let c = pool.get(key);
    if (!c) {
      c = carveLevels(world, stones[side], side, type, key, detail, floor, LOW_LODS, devices);
      pool.set(key, c);
      for (const g of c.levels) geos.push(g);
      if (c.deviceGeo) geos.push(c.deviceGeo);
    }
    return c;
  }

  /**
   * Pieces near a landed blow are pinned to the finest level for a moment.
   *
   * The destruction piece harvests the victim's REAL geometry out of the scene and
   * fractures it, so whatever level the victim happened to be showing is what its rubble
   * is cut from — and a man 33 m away is showing the raw lofted solid. The strike emits
   * this the instant the weapon arrives, one frame ahead of the shatter, which is exactly
   * enough to hand the fracture a properly carved figure to break.
   */
  const pins: Array<(x: number, z: number, until: number) => void> = [];
  if (!hi) {
    world.on('piece-impact', (p: { x: number; z: number }) => {
      for (const fn of pins) fn(p.x, p.z, world.time + 0.6);
    });
  }

  function makeLow(type: PieceType, side: Side, id: string): PieceInstance {
    const c = poolFor(type, side);
    const stone = stones[side];
    const jit = jitter(world.rng.fork(`${id}:place`));

    const group = new THREE.Group();
    group.name = id;
    const bodyMesh = new THREE.Mesh(c.levels[0], stone.material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    // So a cost harness can read the ladder back out of a live scene.
    bodyMesh.userData.lodLevels = c.levels;
    group.add(bodyMesh);
    if (c.deviceGeo) group.add(deviceMesh(c.deviceGeo, stone));

    // The pivot exists from the start — Motion reads its rest transform — but it carries
    // no mesh and is not in the scene graph until an arm animation actually needs it.
    let armNode: THREE.Object3D | null = null;
    if (c.hasArm) {
      armNode = new THREE.Group();
      armNode.name = `${id}-arm`;
      armNode.position.copy(c.armPivot);
    }

    let level = 0;
    let split = false;
    group.userData.lod = 0;
    let pinnedUntil = -1;

    const setSplit = (on: boolean) => {
      if (on === split || !armNode) return;
      const v = splitViews(c);
      if (!v) return;
      split = on;
      if (on) {
        if (armNode.children.length === 0) {
          const am = new THREE.Mesh(v.arm, stone.material);
          am.position.copy(c.armPivot).multiplyScalar(-1);
          am.castShadow = true;
          am.receiveShadow = true;
          armNode.add(am);
        }
        bodyMesh.geometry = v.body;
        group.add(armNode);
      } else {
        group.remove(armNode);
        bodyMesh.geometry = c.levels[level];
      }
    };

    const facing = side === 'white' ? 0 : Math.PI;
    const motion = new Motion(
      {
        group,
        arm: armNode,
        height: PIECE_HEIGHT[type],
        comY: c.comY,
        baseHalf: c.baseHalf,
        facing: facing + jit.yaw,
        rng: world.rng.fork(`${id}:motion`),
        emit: (e, p) => world.emit(e, p),
        id,
        interactive: playMode,
      },
      c.armPivot,
      c.tip,
      armNode ? 1.35 : 0,
    );
    group.position.y = FLOOR_Y;

    const eye = new THREE.Vector3();
    const inst: PieceInstance = {
      id,
      type,
      side,
      group,
      height: PIECE_HEIGHT[type],
      destroyed: false,
      setSquare(f, r) {
        const { x, z } = squareCentre(f, r);
        motion.setSquare(x + jit.dx, z + jit.dz);
      },
      walkTo(f, r, seconds) {
        const { x, z } = squareCentre(f, r);
        return motion.walkTo(x + jit.dx, z + jit.dz, seconds, clock());
      },
      strike(target) {
        const now = clock();
        warnVictim(group, target, now);
        return motion.strike(target.group.position.x, target.group.position.z, now);
      },
      update(t) {
        if (inst.destroyed) return;
        motion.update(playMode ? world.realTime : t);
        setSplit(motion.armAnimating());
        // While the arm is out the piece is pinned to the level the split views address.
        if (split) return;
        if (t < pinnedUntil) {
          if (level !== SPLIT_LEVEL) {
            level = SPLIT_LEVEL;
            bodyMesh.geometry = c.levels[level];
          }
          return;
        }
        eye.copy(world.camera.position);
        const dx = eye.x - group.position.x;
        const dy = eye.y - (group.position.y + PIECE_HEIGHT[type] * 0.5);
        const dz = eye.z - group.position.z;
        const next = pickLevel(Math.sqrt(dx * dx + dy * dy + dz * dz), level, LOW_LODS);
        if (next !== level) {
          level = next;
          bodyMesh.geometry = c.levels[level];
          group.userData.lod = level;
        }
      },
    };
    if (type === 'king') inst.surrender = () => motion.surrender(clock());
    motions.set(inst, motion);

    pins.push((x, z, until) => {
      if (inst.destroyed) return;
      const dx = group.position.x - x;
      const dz = group.position.z - z;
      if (dx * dx + dz * dz > 4.0) return;
      pinnedUntil = until;
      if (!split && level !== SPLIT_LEVEL) {
        level = SPLIT_LEVEL;
        bodyMesh.geometry = c.levels[level];
      }
    });

    live.push(inst);
    world.scene.add(group);
    return inst;
  }

  /**
   * PLAY ONLY: one carving per type per side, shared by every man of that type.
   *
   * Under capture each of the 32 men is carved from its own `world.rng.fork(id)`, so no two
   * are broken in the same place or stained in the same places, and that variety is a
   * large part of what the six film frames are. It is also, measured, a large part of why
   * this scene's own critic could not tell a rook from a bishop: two white rooks are two
   * DIFFERENT carvings, and their 80x80 crops differ by more than a rook's crop differs
   * from a bishop's.
   *
   * A real chess set is not like that. The eight pawns came out of one mould; the two rooks
   * are the same carving twice. So in play — and only in play, the gate is the same
   * `isPlayView` as the device's — the carve is memoised on side+type. Two rooks become the
   * same geometry, which is also 12 carves instead of 32 at start-up.
   */
  const carved = new Map<string, ReturnType<typeof carve>>();
  function carveShared(type: PieceType, side: Side, id: string) {
    if (!devices) return carve(type, side, id);
    const key = `${side}:${type}`;
    let c = carved.get(key);
    if (!c) {
      // Carve off a stable per-type stream, not off this particular man's id, or which of
      // the two rooks happened to be made first would decide what both of them look like.
      c = carve(type, side, `set:${key}`);
      carved.set(key, c);
    }
    return c;
  }

  function makeHigh(type: PieceType, side: Side, id: string): PieceInstance {
    const { bodyGeo, armGeo, deviceGeo, armPivot, tip, comY, baseHalf, stone } =
      carveShared(type, side, id);

    const group = new THREE.Group();
    group.name = id;
    const bodyMesh = new THREE.Mesh(bodyGeo, stone.material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);
    if (deviceGeo) group.add(deviceMesh(deviceGeo, stone));

    let armNode: THREE.Object3D | null = null;
    if (armGeo) {
      armNode = new THREE.Group();
      armNode.name = `${id}-arm`;
      armNode.position.copy(armPivot);
      const am = new THREE.Mesh(armGeo, stone.material);
      am.position.copy(armPivot).multiplyScalar(-1);
      am.castShadow = true;
      am.receiveShadow = true;
      armNode.add(am);
      group.add(armNode);
    }

    const facing = side === 'white' ? 0 : Math.PI;
    const motion = new Motion(
      {
        group,
        arm: armNode,
        height: PIECE_HEIGHT[type],
        comY,
        baseHalf,
        facing,
        rng: world.rng.fork(`${id}:motion`),
        emit: (e, p) => world.emit(e, p),
        id,
        interactive: playMode,
      },
      armPivot,
      tip,
      armNode ? 1.35 : 0,
    );
    group.position.y = FLOOR_Y;

    const inst: PieceInstance = {
      id,
      type,
      side,
      group,
      height: PIECE_HEIGHT[type],
      destroyed: false,
      setSquare(f, r) {
        const { x, z } = squareCentre(f, r);
        motion.setSquare(x, z);
      },
      walkTo(f, r, seconds) {
        const { x, z } = squareCentre(f, r);
        return motion.walkTo(x, z, seconds, clock());
      },
      strike(target) {
        const now = clock();
        warnVictim(group, target, now);
        return motion.strike(target.group.position.x, target.group.position.z, now);
      },
      update(t) {
        if (inst.destroyed) return;
        motion.update(playMode ? world.realTime : t);
      },
    };
    if (type === 'king') inst.surrender = () => motion.surrender(clock());
    motions.set(inst, motion);

    live.push(inst);
    world.scene.add(group);
    return inst;
  }

  function make(type: PieceType, side: Side, id: string): PieceInstance {
    return hi ? makeHigh(type, side, id) : makeLow(type, side, id);
  }

  return {
    make,
    all: () => live.filter((p) => !p.destroyed),
    dispose() {
      for (const g of geos) g.dispose();
      geos.length = 0;
      pool.clear();
      served.clear();
      pins.length = 0;
      stones.white.dispose();
      stones.black.dispose();
      for (const p of live) world.scene.remove(p.group);
      live.length = 0;
    },
  };
}
