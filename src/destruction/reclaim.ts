/**
 * PIECE: destruction — the chamber taking the wreckage back. INTERACTIVE PLAY ONLY.
 *
 * THE PROBLEM. The rest of this module is built on the premise that "the wreckage stays
 * exactly where it stops for the rest of the game, leaning on the pile that earlier
 * captures left". That is right for the film: `king-surrender` is specifically a board
 * strewn with the wreckage of the whole game, and a critic has already failed a round for
 * not having it. It is wrong for playing chess. By move twenty the marble is carpeted in
 * seventy-fragment heaps, the top-down play camera cannot tell an occupied square from a
 * buried one, and every one of those fragments is still a mesh, a geometry and a shadow
 * caster.
 *
 * So in interactive play — and ONLY there — every fragment, every shred of fabric and
 * every puff of dust gets a lifetime.
 *
 * THE ENDING. Not a pop, and not a fade to nothing in mid-air either: the floor takes it.
 * A fragment lies still on the marble for a second and a half, then crumbles inward and
 * settles down THROUGH the stone, leaving a low breath of limestone dust over the square
 * that spreads and is gone. Three cues, all of them cheap:
 *
 *   shrink  the block crumbles in on itself, so it is already small before it goes
 *   sink    it goes down into the marble, which is opaque, so the last of it is simply
 *           swallowed rather than switched off
 *   dust    one soft ground-hugging puff per wreck (see `Plume.settle`), which is what
 *           makes the disappearance read as an event rather than as a missing object
 *
 * They do not all go at once. Each fragment carries its own small wait, so a heap goes
 * over about a second — the near edge first, then the middle, then the last big block.
 *
 * THE PILE GOES TOO. `debris.ts` keeps a height field so a fragment lands ON the rubble
 * rather than through it. That field is a running maximum and it does not know anything
 * ever leaves, so wreckage that dissolves without taking its stamps with it leaves an
 * invisible shelf: by move thirty fresh debris comes to rest a quarter of a metre above
 * the marble on nothing at all. Every body is therefore tagged with its wreck's id, and
 * the last fragment of a wreck to go calls `ground.forget(id)`.
 *
 * Nothing in this file runs under capture. `index.ts` only builds it when
 * `world.capturing` is false, and the film path never gains so much as a branch.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { Body, Ground } from './debris';
import type { Plume } from './dust';

/**
 * Minimum seconds a fragment lies still on the marble before the floor starts taking it.
 * This is the number the player feels. Much shorter and the debris looks like it is being
 * deleted mid-bounce; much longer and two captures' worth are on the board at once, which
 * is the complaint.
 */
const LIE = 1.4;
/**
 * And a ceiling measured from the blast, whatever the physics is still doing. Torn fabric
 * flutters for over three seconds and a shard can be nudged along by the pile under it;
 * without this the last scrap of a wreck would still be going as the next capture lands.
 */
const HOLD_MAX = 2.9;
/** How long one fragment takes to crumble and sink. */
const DISSOLVE = 1.4;
/** Fraction of its size a fragment has crumbled away to by the time it is gone. */
const CRUMBLE = 0.62;

interface Item {
  body: Body;
  mesh: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  /** Scene time this one starts going. -1 until it has come to rest. */
  goAt: number;
  /** Its own small share of the stagger. */
  wait: number;
  /** How far it must travel to be under the marble. */
  sink: number;
  /** Resting height, cached the moment it stops moving. */
  y0: number;
  going: boolean;
}

interface Wreck {
  id: string;
  bornAt: number;
  origin: THREE.Vector3;
  radius: number;
  items: Item[];
  puffed: boolean;
  /**
   * Held back for the settle puff, which is emitted a good three seconds after the
   * victim's rng was forked and spent. Forking it up front keeps the dust deterministic
   * and independent of how many other wrecks happen to be on the board.
   */
  dustRng: Rng;
}

export interface ReclaimEntry {
  body: Body;
  mesh: THREE.Object3D;
  geometry: THREE.BufferGeometry;
}

export interface Reclaim {
  /** Register a fresh wreck. `rng` is forked per victim, so the stagger is stable. */
  add(opts: {
    id: string;
    t: number;
    origin: THREE.Vector3;
    radius: number;
    rng: Rng;
    entries: ReclaimEntry[];
  }): void;
  /**
   * Advance every wreck. `drop` is called once per body as it leaves, so the caller can
   * take it out of the simulation list.
   */
  update(t: number, drop: (b: Body) => void): void;
  /** How many meshes this is still holding in the scene. */
  count(): number;
  dispose(): void;
}

export function createReclaim(deps: {
  ground: Ground;
  plume: Plume;
  /** Top of the marble — what the fragments have to disappear beneath. */
  boardTop: number;
}): Reclaim {
  const wrecks: Wreck[] = [];

  function add(opts: Parameters<Reclaim['add']>[0]) {
    const jitter = opts.rng.fork('reclaim');
    const items: Item[] = [];
    for (const e of opts.entries) {
      const r = Math.max(0.04, e.body.radius);
      items.push({
        body: e.body,
        mesh: e.mesh,
        geometry: e.geometry,
        goAt: -1,
        // Small chips are already halfway to dust and go first; the big architectural
        // blocks are the last thing left on the square. Plus a little noise, so the
        // stagger is not a readable sweep.
        wait: Math.min(0.85, r * 1.05) + jitter.float(0, 0.30),
        sink: 0,
        y0: 0,
        going: false,
      });
    }
    wrecks.push({
      id: opts.id,
      bornAt: opts.t,
      origin: opts.origin.clone(),
      radius: opts.radius,
      items,
      puffed: false,
      dustRng: opts.rng.fork('settle-dust'),
    });
  }

  function update(t: number, drop: (b: Body) => void) {
    for (let w = wrecks.length - 1; w >= 0; w--) {
      const wreck = wrecks[w];
      for (let i = wreck.items.length - 1; i >= 0; i--) {
        const it = wreck.items[i];

        if (!it.going) {
          if (it.goAt < 0) {
            // Nothing starts dissolving while it is still in the air or still rolling.
            if (!it.body.sleeping) continue;
            it.y0 = it.body.pos.y;
            const r = Math.max(0.04, it.body.radius);
            // Far enough down that the top of the crumbled block is under the marble.
            it.sink = Math.max(0.25, it.y0 - deps.boardTop + r * 0.5 + 0.12);
            it.goAt = Math.max(t, Math.min(t + LIE, wreck.bornAt + HOLD_MAX)) + it.wait;
            continue;
          }
          if (t < it.goAt) continue;
          it.going = true;
          // A sinking block must not keep throwing a shadow across the square it is
          // leaving — that is the one way this could read as an object being deleted.
          it.mesh.castShadow = false;
          if (!wreck.puffed) {
            wreck.puffed = true;
            deps.plume.settle({
              origin: new THREE.Vector3(wreck.origin.x, deps.boardTop, wreck.origin.z),
              radius: wreck.radius,
              rng: wreck.dustRng,
              t,
            });
          }
        }

        const k = Math.min(1, Math.max(0, (t - it.goAt) / DISSOLVE));
        if (k >= 1) {
          it.mesh.removeFromParent();
          it.geometry.dispose();
          drop(it.body);
          wreck.items.splice(i, 1);
          continue;
        }
        // Sink on an ease-IN: it hangs for a moment and then goes, which reads as the
        // stone giving way under it rather than as a lift descending.
        it.mesh.position.y = it.y0 - it.sink * k * k;
        // ...and crumbles inward the whole way, so what finally passes under the marble
        // is a third of what landed there.
        it.mesh.scale.setScalar(1 - CRUMBLE * Math.pow(k, 1.35));
      }

      if (wreck.items.length === 0) {
        // The heap is gone, so the shelf it was holding up goes with it.
        deps.ground.forget(wreck.id);
        wrecks.splice(w, 1);
      }
    }
  }

  return {
    add,
    update,
    count() {
      let n = 0;
      for (const w of wrecks) n += w.items.length;
      return n;
    },
    dispose() {
      for (const w of wrecks) {
        for (const it of w.items) {
          it.mesh.removeFromParent();
          it.geometry.dispose();
        }
      }
      wrecks.length = 0;
    },
  };
}
