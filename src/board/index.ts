/**
 * PIECE: board — the playing floor.
 *
 * Sixty-four marble slabs set into a mortar bed, an inlaid geometric border strip and a
 * weathered stone kerb for the fires to burn on. It is a floor: the surface is at the
 * chamber's floor level, the joints are open and deep, rubble lands on it and stays.
 *
 * Judged from `low-across-board` — camera low, looking across the surface, with the
 * bottom of the frame carrying the peak local detail in the image. That is why the
 * marble is evaluated per pixel rather than baked (see glsl.ts), why every slab has its
 * own height, tilt, dish and chipped corners (see marble.ts), and why the room is really
 * mirrored in it (see reflection.ts) instead of being faked with an environment map.
 *
 * Determinism: every random decision comes from a fork of `world.rng` keyed by a stable
 * string; every shader value is a pure function of world position. Nothing reads a clock.
 *
 * COST, and where it went at the low tier. Measured on this box (SwiftShader, 640x268,
 * quality=low, the play camera), timing the app's own render and reading renderer.info,
 * with the board's share taken as the difference against the same frame drawn with
 * `board.group.visible = false`:
 *
 *   the board's share of the frame       1207 ms   (44 % of a 2747 ms frame)
 *     of which the planar reflection      850 ms   — 140 draw calls, 431 000 triangles
 *     of which the 64 slabs               203 ms   — 64 draw calls
 *     of which bed, border and kerb       154 ms
 *
 * And the reason that pinned the resolution scaler at its floor rather than being solved
 * by it: the mirror renders into a target of its own, 512 x 214, whose size does not
 * depend on the canvas at all. At the ladder's bottom rung the canvas is 389 x 243 — so
 * the reflection pass was drawing MORE pixels than the picture it was decorating, and no
 * amount of dropping resolution could touch it. The scaler kept paying the same 850 ms
 * and kept taking the cost out of the only thing it controls, which is the sharpness of
 * everything the player looks at.
 *
 * So at `world.quality === 'low'` the reflection pass is gone and an analytic room stands
 * in for it (REFLECT_GLSL), the field is merged into two meshes, and every generation of
 * detail finer than that device's pixel is compiled out. Same room, same marble, same
 * carved band, same cold firelight — fewer of them. After: the board's share is 267 ms
 * and 5 draw calls. The high tier is untouched, down to the byte.
 */
import * as THREE from 'three';
import type { Board } from '../core/api';
import type { World } from '../core/world';
import { isLightSquare, squareCentre } from '../core/constants';
import { createImpactField } from './impact';
import { MAP_EXTENT, TOP_Y } from './layout';
import { buildSlab, createMarble, mergeSlabs, type SlabPlacement } from './marble';
import { createPlanarReflection } from './reflection';
import { createSurround, type SharedMaps } from './surround';

export function createBoard(world: World): Board {
  const group = new THREE.Group();
  group.name = 'board';
  const low = world.quality === 'low';

  // --- the surface's memory: baked wear plus everything the game throws at it -----------
  const impact = createImpactField(world);

  // --- the room, mirrored in the polish -------------------------------------------------
  // High tier only. This is one extra render of the whole scene per frame; see the note
  // at the top of the file for what that costs and what replaces it below.
  let reflection: ReturnType<typeof createPlanarReflection> | null = null;
  if (!low) {
    try {
      reflection = createPlanarReflection(world, TOP_Y);
    } catch {
      // Software GL can refuse a half-float target. The marble still lights without it.
      reflection = null;
    }
  }

  const shared: SharedMaps = {
    wear: impact.texture,
    wearExtent: MAP_EXTENT,
    refl: reflection ? reflection.texture : null,
    reflMatrix: reflection ? reflection.textureMatrix : new THREE.Matrix4(),
    reflLod: reflection ? reflection.maxLod : 0,
    low,
  };

  // --- the field ------------------------------------------------------------------------
  const light = createMarble(world, 'light', shared);
  const dark = createMarble(world, 'dark', shared);

  const field = new THREE.Group();
  field.name = 'board-field';
  group.add(field);

  const meshes = new Map<string, THREE.Object3D>();
  const geometries: THREE.BufferGeometry[] = [];
  /** Slabs waiting to be baked into one buffer, per stone. Low tier only. */
  const batch: Record<'light' | 'dark', SlabPlacement[]> = { light: [], dark: [] };

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      // Fork per square by a stable key, so adding or reordering anything else in the
      // scene never reshuffles which slab is chipped.
      const rng = world.rng.fork(`board-slab-${f}-${r}`);
      const slab = buildSlab(f, r, rng, world);
      const { x, z } = squareCentre(f, r);
      const isLight = isLightSquare(f, r);

      if (low) {
        // The slab still gets its own height, tilt, dish and chipped corners — it simply
        // does not get its own draw call. `node` is what squareMesh() hands out: a real
        // object at the square's centre carrying the same userData, so anything that
        // wants to know where a square is, or how high its surface sits, still can.
        const node = new THREE.Object3D();
        node.name = `square-${'abcdefgh'[f]}${r + 1}`;
        node.position.set(x, 0, z);
        node.rotation.set(slab.tiltX, slab.yaw, slab.tiltZ, 'YXZ');
        node.updateMatrix();
        node.userData.file = f;
        node.userData.rank = r;
        node.userData.light = isLight;
        node.userData.surfaceY = slab.surfaceY;
        meshes.set(`${f},${r}`, node);
        batch[isLight ? 'light' : 'dark'].push({ geometry: slab.geometry, matrix: node.matrix });
        continue;
      }

      const mesh = new THREE.Mesh(slab.geometry, isLight ? light.material : dark.material);
      mesh.name = `square-${'abcdefgh'[f]}${r + 1}`;
      mesh.position.set(x, 0, z);
      mesh.rotation.set(slab.tiltX, slab.yaw, slab.tiltZ, 'YXZ');
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.file = f;
      mesh.userData.rank = r;
      mesh.userData.light = isLight;
      mesh.userData.surfaceY = slab.surfaceY;
      field.add(mesh);
      meshes.set(`${f},${r}`, mesh);
      geometries.push(slab.geometry);
    }
  }

  if (low) {
    // Two meshes for the whole field, one per stone. The per-slab buffers are thrown away
    // as soon as they are baked; only the two merged ones are uploaded.
    for (const kind of ['light', 'dark'] as const) {
      const merged = mergeSlabs(batch[kind]);
      const mesh = new THREE.Mesh(merged, kind === 'light' ? light.material : dark.material);
      mesh.name = `board-field-${kind}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      field.add(mesh);
      geometries.push(merged);
      for (const p of batch[kind]) p.geometry.dispose();
    }
  }

  // --- bed, border, kerb ------------------------------------------------------------------
  const surround = createSurround(world, shared);
  group.add(surround.group);

  if (reflection) {
    // The board does not appear in its own mirror. The kerb stands above the plane and
    // does, so it stays in.
    // Everything at or below the mirror plane is excluded — a mirror does not appear in
    // itself. The kerb stands above the plane and stays in.
    reflection.exclude.push(field);
    for (const m of surround.meshes) {
      if (m.name !== 'board-kerb') reflection.exclude.push(m);
    }
    group.add(reflection.driver);
  }

  return {
    group,

    /**
     * The object standing at a square. A mesh at the high tier; at the low tier the field
     * is two merged buffers, so this is a lightweight node at the same place carrying the
     * same userData (file, rank, light, surfaceY).
     */
    squareMesh(file: number, rank: number): THREE.Object3D | null {
      return meshes.get(`${file},${rank}`) ?? null;
    },

    markImpact(x: number, z: number, radius: number, strength: number) {
      impact.mark(x, z, radius, strength);
    },

    dispose() {
      for (const g of geometries) g.dispose();
      light.dispose();
      dark.dispose();
      surround.dispose();
      impact.dispose();
      reflection?.dispose();
    },
  };
}
