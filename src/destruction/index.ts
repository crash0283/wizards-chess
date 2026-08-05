/**
 * PIECE: destruction — a piece breaking apart.
 *
 * "The same weight and dust when one piece destroys another." Both reference frames say
 * the same three things, and this module is organised around them:
 *
 *   1. THE DUST IS THE EVENT. A dense opaque white-grey cloud, the brightest thing in
 *      frame, standing well above where the piece stood, with lobes and rolls and a
 *      cauliflower head. It is a volume, not a few sprites.               -> dust.ts
 *   2. THE FRAGMENTS ARE THE FIGURE. Dark angular shapes fly out THROUGH the cloud,
 *      silhouetted against it — and they are recognisably parts of the statue, because
 *      they are literally cut out of its own mesh, keeping its weathered rust-stained
 *      skin on the outside and showing raw pale stone on every break.     -> fracture.ts
 *   3. IT HAS WEIGHT. A violent burst, then a hard settle: full gravity at true scale,
 *      almost no bounce, and the wreckage stays exactly where it stops for the rest of
 *      the game, leaning on the pile that earlier captures left.          -> debris.ts
 *
 * Two arrival paths, one code path. A capture landing during the shot bursts live. A
 * capture the game has already fast-forwarded through (`stage()` replays the earlier
 * plies before t=0) has its rubble simulated to rest immediately and baked into one
 * static mesh — same fracture, same physics, no dust, no draw-call cost.
 *
 * Determinism: every fragment, every puff and every impulse comes from
 * `world.rng.fork(<victim id>)` and `world.time`. No clocks, no Math.random. Two
 * captures of the same shot produce the same wreckage down to the byte.
 */
import * as THREE from 'three';
import type { Destruction, PieceFactory, PieceInstance } from '../core/api';
import type { World } from '../core/world';
import { apply, createGround, makeBody, stepBody, type Body } from './debris';
import { createPlume } from './dust';
import { fracture, type Fragment } from './fracture';
import { buildShred, createFabricMaterials } from './fabric';
import { appendGeometry, emptySoup, soupBounds, triCount } from './soup';

/** Top of the marble. Debris rests on the board, not on the chamber floor. */
const BOARD_TOP = 0.018;
/** Fixed step used to fast-forward staged wreckage to its resting position. */
const BAKE_STEP = 1 / 60;
/** How long that fast-forward runs — past the point everything has gone to sleep. */
const BAKE_TIME = 3.6;
/**
 * The blade is already inside the stone when the frame the contact lands on is drawn,
 * so the burst starts fractionally before `shatter` is called. Without this the
 * mid-strike frame catches the explosion at exactly zero age and shows nothing.
 */
const PRE_ROLL = 0.075;

export function createDestruction(world: World, _deps: { pieces: PieceFactory }): Destruction {
  const group = new THREE.Group();
  group.name = 'destruction';

  const high = world.quality === 'high';
  const ground = createGround(BOARD_TOP);
  const plume = createPlume(world);
  group.add(plume.object);
  const fabric = createFabricMaterials();

  const bodies: Body[] = [];
  const owned: THREE.BufferGeometry[] = [];

  world.onUpdate((t, dt) => {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.sleeping) continue;
      stepBody(b, dt, ground);
      apply(b);
    }
    plume.update(t + PRE_ROLL);
  });

  /** Read the victim's real geometry out of the scene, in world space. */
  function harvest(target: PieceInstance) {
    const soup = emptySoup();
    let material: THREE.Material | null = null;
    target.group.updateMatrixWorld(true);
    target.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      appendGeometry(soup, m.geometry, m.matrixWorld);
      if (!material) material = (Array.isArray(m.material) ? m.material[0] : m.material) ?? null;
    });
    return { soup, material: material as THREE.Material | null };
  }

  function shatter(target: PieceInstance, impact: THREE.Vector3, force: number) {
    if (target.destroyed) return;
    target.destroyed = true;

    const { soup, material } = harvest(target);
    target.group.visible = false;
    if (triCount(soup) < 8 || !material) return;

    // A capture the game fast-forwarded through before the shot began: it happened
    // earlier in the fight, so its rubble is already lying on the marble.
    const staged = world.time <= 1e-6;
    const rng = world.rng.fork(`destruction:${target.id}`);

    const dir = new THREE.Vector3(impact.x, 0, impact.z);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.normalize();

    const base = target.group.position.clone();
    const bounds = soupBounds(soup);
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.3, Math.max(size.x, size.z) * 0.5);

    const frags = fracture(soup, {
      rng: rng.fork('cells'),
      cells: staged ? (high ? 20 : 10) : high ? 58 : 24,
      chips: staged ? (high ? 5 : 2) : high ? 20 : 8,
      impact: dir,
      base,
      height: target.height,
    });
    if (!frags.length) return;

    // Centre of the explosion: inside the figure, at the height the blade went in.
    const centre = new THREE.Vector3(
      base.x - dir.x * radius * 0.25,
      base.y + target.height * 0.46,
      base.z - dir.z * radius * 0.25,
    );

    const fresh: Body[] = [];
    const vrng = rng.fork('launch');
    for (const f of frags) {
      const object = staged ? new THREE.Object3D() : makeMesh(f, material);
      const away = f.centre.clone().sub(centre);
      const dist = Math.max(0.08, away.length());
      away.multiplyScalar(1 / dist);

      // Small shards leave fast, blocks barely move: the same energy over more mass.
      // The ceiling matters — stone thrown at ten metres a second lands three squares
      // away and is still in the air a second and a half later, and the reference has
      // the wreckage down and still, in a heap, around the piece that was struck.
      const light = Math.min(1.8, 0.42 / (0.14 + f.radius));
      const speed = force * vrng.float(1.2, 2.8) * light;
      const vel = new THREE.Vector3(
        away.x * speed + dir.x * speed * 0.45 + vrng.gauss() * 0.32,
        Math.abs(away.y) * speed * 0.40 + vrng.float(0.8, 2.6) * Math.min(1.4, light),
        away.z * speed + dir.z * speed * 0.45 + vrng.gauss() * 0.32,
      );
      const spin = Math.min(17, 5.5 * light + 2.5);
      const body = makeBody({
        kind: 'stone',
        object,
        pos: f.centre,
        quat: new THREE.Quaternion(),
        vel,
        omega: new THREE.Vector3(vrng.gauss() * spin, vrng.gauss() * spin, vrng.gauss() * spin),
        support: f.support,
        radius: f.radius,
        volume: f.volume,
        phase: vrng.float(0, 6.283),
      });
      fresh.push(body);
      if (!staged) {
        group.add(object);
        owned.push(f.geometry);
      }
    }

    // --- torn fabric ----------------------------------------------------------------
    const frng = rng.fork('fabric');
    const shreds = staged ? (high ? 2 : 1) : high ? 5 : 3;
    const scale = Math.min(1.5, target.height / 3.0);
    for (let i = 0; i < shreds; i++) {
      const shred = buildShred(frng, scale);
      const object = staged ? new THREE.Object3D() : makeCloth(shred.geometry, frng, fabric.materials);
      const th = frng.float(0, Math.PI * 2);
      const pos = new THREE.Vector3(
        centre.x + Math.cos(th) * radius * 0.6,
        base.y + target.height * frng.float(0.30, 0.85),
        centre.z + Math.sin(th) * radius * 0.6,
      );
      const sp = force * frng.float(1.8, 4.4);
      fresh.push(makeBody({
        kind: 'fabric',
        object,
        pos,
        quat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(frng.float(-1.4, 1.4), frng.float(0, 6.283), frng.float(-1.4, 1.4)),
        ),
        vel: new THREE.Vector3(
          Math.cos(th) * sp + dir.x * sp * 0.8,
          frng.float(2.2, 5.4),
          Math.sin(th) * sp + dir.z * sp * 0.8,
        ),
        omega: new THREE.Vector3(frng.gauss() * 3.5, frng.gauss() * 3.5, frng.gauss() * 3.5),
        support: shred.support,
        radius: shred.radius,
        volume: shred.volume,
        phase: frng.float(0, 6.283),
      }));
      if (!staged) {
        group.add(object);
        owned.push(shred.geometry);
      } else {
        stagedGeo.push({ geometry: shred.geometry, body: fresh[fresh.length - 1], cloth: true });
      }
    }

    if (staged) {
      // Everything that happened earlier in the fight is settled before the camera rolls.
      for (let i = 0; i < frags.length; i++) {
        stagedGeo.push({ geometry: frags[i].geometry, body: fresh[i], cloth: false });
      }
      const steps = Math.round(BAKE_TIME / BAKE_STEP);
      for (let s = 0; s < steps; s++) {
        let awake = false;
        for (const b of fresh) {
          if (b.sleeping) continue;
          stepBody(b, BAKE_STEP, ground);
          awake = true;
        }
        if (!awake) break;
      }
      for (const b of fresh) apply(b);
      bake(target.id, material);
      return;
    }

    // The blade is already through the stone by the time this frame is drawn, so the
    // burst is advanced to where it would be — otherwise a frame captured on the exact
    // contact time catches an explosion that has not started yet.
    const preSteps = Math.round(PRE_ROLL / BAKE_STEP);
    for (const b of fresh) {
      for (let s = 0; s < preSteps; s++) stepBody(b, BAKE_STEP, ground);
      apply(b);
      bodies.push(b);
    }
    plume.burst({
      origin: new THREE.Vector3(base.x, base.y + BOARD_TOP, base.z),
      radius,
      height: target.height,
      dir,
      force,
      rng: rng.fork('dust'),
      t: world.time,
    });
    // The frame's updaters have already run, so push the new puffs into the buffers now.
    plume.update(world.time + PRE_ROLL);
  }

  /** Fragment geometry waiting to be merged into a static wreck. */
  const stagedGeo: Array<{ geometry: THREE.BufferGeometry; body: Body; cloth: boolean }> = [];

  /**
   * Freeze a settled wreck into one mesh per material. It never moves again, so it costs
   * a single draw call instead of thirty and holds no simulation state at all.
   */
  function bake(id: string, stone: THREE.Material) {
    const groups: Array<{ cloth: boolean; items: typeof stagedGeo }> = [
      { cloth: false, items: stagedGeo.filter((g) => !g.cloth) },
      { cloth: true, items: stagedGeo.filter((g) => g.cloth) },
    ];
    const m = new THREE.Matrix4();
    for (const g of groups) {
      if (!g.items.length) continue;
      const names = ['position', 'normal', 'color', 'aRough', 'aThin', 'aMail'] as const;
      const sizes: Record<string, number> = { position: 3, normal: 3, color: 3, aRough: 1, aThin: 1, aMail: 1 };
      const acc: Record<string, number[]> = {};
      for (const n of names) acc[n] = [];
      const nm = new THREE.Matrix3();
      const v = new THREE.Vector3();

      for (const item of g.items) {
        m.compose(item.body.pos, item.body.quat, new THREE.Vector3(1, 1, 1));
        nm.getNormalMatrix(m);
        const geo = item.geometry;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          acc.position.push(v.x, v.y, v.z);
        }
        const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
        for (let i = 0; i < pos.count; i++) {
          if (nrm) v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
          else v.set(0, 1, 0);
          acc.normal.push(v.x, v.y, v.z);
        }
        for (const n of ['color', 'aRough', 'aThin', 'aMail'] as const) {
          const a = geo.getAttribute(n) as THREE.BufferAttribute | undefined;
          const w = sizes[n];
          for (let i = 0; i < pos.count; i++) {
            if (a) {
              acc[n].push(a.getX(i));
              if (w > 1) acc[n].push(a.getY(i), a.getZ(i));
            } else if (w > 1) acc[n].push(0.45, 0.43, 0.40);
            else acc[n].push(n === 'aRough' ? 0.88 : 0);
          }
        }
        geo.dispose();
      }

      const merged = new THREE.BufferGeometry();
      for (const n of names) {
        merged.setAttribute(n, new THREE.BufferAttribute(new Float32Array(acc[n]), sizes[n]));
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, g.cloth ? fabric.materials[0] : stone);
      mesh.name = `wreck-${id}${g.cloth ? '-cloth' : ''}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      owned.push(merged);
    }
    stagedGeo.length = 0;
  }

  function makeMesh(f: Fragment, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(f.geometry, material);
    mesh.castShadow = f.radius > 0.06;
    mesh.receiveShadow = true;
    return mesh;
  }

  function makeCloth(
    geometry: THREE.BufferGeometry,
    rng: ReturnType<World['rng']['fork']>,
    materials: THREE.MeshStandardMaterial[],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, rng.pick(materials));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  return {
    group,
    shatter,
    settled: () => bodies.every((b) => b.sleeping),
    dispose() {
      for (const g of owned) g.dispose();
      owned.length = 0;
      bodies.length = 0;
      fabric.dispose();
      plume.dispose();
    },
  };
}
