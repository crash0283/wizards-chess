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
 */
import * as THREE from 'three';
import type { Board } from '../core/api';
import type { World } from '../core/world';
import { isLightSquare, squareCentre } from '../core/constants';
import { createImpactField } from './impact';
import { MAP_EXTENT, TOP_Y } from './layout';
import { buildSlab, createMarble } from './marble';
import { createPlanarReflection } from './reflection';
import { createSurround, type SharedMaps } from './surround';

export function createBoard(world: World): Board {
  const group = new THREE.Group();
  group.name = 'board';

  // --- the surface's memory: baked wear plus everything the game throws at it -----------
  const impact = createImpactField(world);

  // --- the room, mirrored in the polish -------------------------------------------------
  let reflection: ReturnType<typeof createPlanarReflection> | null = null;
  try {
    reflection = createPlanarReflection(world, TOP_Y);
  } catch {
    // Software GL can refuse a half-float target. The marble still lights without it.
    reflection = null;
  }

  const shared: SharedMaps = {
    wear: impact.texture,
    wearExtent: MAP_EXTENT,
    refl: reflection ? reflection.texture : null,
    reflMatrix: reflection ? reflection.textureMatrix : new THREE.Matrix4(),
    reflLod: reflection ? reflection.maxLod : 0,
  };

  // --- the field ------------------------------------------------------------------------
  const light = createMarble(world, 'light', shared);
  const dark = createMarble(world, 'dark', shared);

  const field = new THREE.Group();
  field.name = 'board-field';
  group.add(field);

  const meshes = new Map<string, THREE.Mesh>();
  const geometries: THREE.BufferGeometry[] = [];

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      // Fork per square by a stable key, so adding or reordering anything else in the
      // scene never reshuffles which slab is chipped.
      const rng = world.rng.fork(`board-slab-${f}-${r}`);
      const slab = buildSlab(f, r, rng, world);
      const { x, z } = squareCentre(f, r);
      const mesh = new THREE.Mesh(slab.geometry, isLightSquare(f, r) ? light.material : dark.material);
      mesh.name = `square-${'abcdefgh'[f]}${r + 1}`;
      mesh.position.set(x, 0, z);
      mesh.rotation.set(slab.tiltX, slab.yaw, slab.tiltZ, 'YXZ');
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.file = f;
      mesh.userData.rank = r;
      mesh.userData.light = isLightSquare(f, r);
      mesh.userData.surfaceY = slab.surfaceY;
      field.add(mesh);
      meshes.set(`${f},${r}`, mesh);
      geometries.push(slab.geometry);
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
