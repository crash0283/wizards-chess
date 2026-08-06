/**
 * PIECE: chamber — the stone hall itself.
 *
 * The room has one job and it is not to be a room. It is to ENCLOSE the board, so that
 * the board reads as the floor of a cathedral-scale hall and not as a lit diorama on a
 * table in an empty warehouse. Everything below follows from that:
 *
 *   piers    — `piers.ts`. Five colossal compound piers a side, standing hard outside
 *              the board's kerb and NEARER to camera than the front ranks, cut by the
 *              bottom of frame at the foot and by the top of frame where they lean in
 *              over the board. This is the near field, and it is the coarsest thing in
 *              the room by a factor of three.
 *   screens  — `screen.ts`. Colossal screens of smooth round shafts standing hard
 *              against both long kerbs, leaning inward as they rise so they leave the
 *              top of frame. These stand behind the piers and are the middle depth.
 *   walls    — `wall.ts`. Large ordered ashlar with fine joints, a stepped plinth, a
 *              blind arcade, a moulded string course and the great portal, standing
 *              behind the screens and seen past them.
 *   floor    — `floor.ts`. Flags, laid to broken joints, everywhere the board is not.
 *   scree    — `rubble.ts`. What has come off the walls, banked against the foot of
 *              everything vertical.
 *
 * The room is a long hall, not a box: the end wall stands at `EAST_X`, twenty-three
 * metres past the board's far kerb and forty-six from the establishing camera, and it is
 * cut dark and set to an irregular pier rhythm with nothing on the board's axis. There is
 * no legible far termination and there is not meant to be one — where the room ends is
 * the one thing the reference never tells you.
 *
 * The idiom is carved, not laid. Age shows as staining and soot rather than as crumbling
 * — architecture is the story, erosion is not — so the shafts carry no joints at all and
 * the masonry behind them is cut large and set close.
 *
 * Three structural notes:
 *
 *  - Walls AND screens are hidden when the camera is outside them. `wide-establishing`
 *    sits eight metres beyond the west wall and `king-surrender` sits beyond both the
 *    south wall and the south screen, so a solid room would render the back of one and
 *    nothing else. The test is a plane test against the live camera, run from
 *    `updateMatrixWorld` so it is always exact for the frame being drawn, and it is a
 *    pure function of camera position — no clocks, no state, the same frame every time.
 *  - The screens occlude most of the wall masonry from most cameras, which is why the
 *    room got cheaper to draw when they went in rather than dearer.
 *  - `scene.fog` belongs to the lighting piece. Nothing here touches it.
 */
import * as THREE from 'three';
import type { Chamber } from '../core/api';
import type { World } from '../core/world';
import { CHAMBER, BOARD_SIZE } from '../core/constants';

import { buildStoneAtlas } from './textures';
import {
  makeBlockGeometry, makeBlindArchGeometry, makeChunkGeometry, makeVaultGeometry,
} from './geometry';
import { makeWeather } from './weather';
import { InstanceSink } from './sink';
import { buildWall, BACK_Z, STRING_TOP, type WallSpec } from './wall';
import { buildPortalOrders, buildPortalPassage, portalHalfWidth, type PortalSpec } from './portal';
import { buildFloor, buildFloorSlab } from './floor';
import { buildScree, type ScreeLine } from './rubble';
import {
  buildSideScreen, buildBackRow, makeCarvedTone, SIDE_Z, PORTAL_X,
} from './screen';
import { buildNearPiers, makeNearTone, NEAR_Z } from './piers';
import { makeGrainNormal, type Tone } from './carved';
import { hashString } from '../core/rng';
import type { Weather } from './weather';

/**
 * Where the end wall stands.
 *
 * It used to stand at `CHAMBER.halfWidth`, seven metres past the board, and a screen of
 * round shafts stood in front of it. Together they resolved: from the establishing camera
 * the far end read as a clean symmetric arcade with bright speculars and a heavy shaft on
 * the board's own axis, which put the back of the room at a very readable twenty metres
 * and made the whole hall the size of a large drawing room. It is now twenty-three metres
 * past the far kerb, the shafts are gone, and it is dimmed to two-thirds. Nothing else in
 * the room moved: the long walls still stop at `CHAMBER.halfWidth`, and the corner that
 * leaves is covered by the side screens, which now run past it.
 */
const EAST_X = 22.6;

/** Uniformly darken a wall's per-block colour. Used to sink the end wall into the air. */
function dimWeather(w: Weather, k: number): Weather {
  return {
    tone: (u, v, occ, out) => w.tone(u, v, occ, out).multiplyScalar(k),
    decay: w.decay,
  };
}

const VARIANTS = 12;
const CHUNK_VARIANTS = 5;

/** Root that decides, at draw time, which walls the camera is inside of. */
class ChamberRoot extends THREE.Group {
  cull: (() => void) | null = null;
  updateMatrixWorld(force?: boolean) {
    if (this.cull) this.cull();
    super.updateMatrixWorld(force);
  }
}

interface Panel {
  /** Everything that belongs to this wall, including the scree heaped against it. */
  groups: THREE.Object3D[];
  /** Inward normal, in the xz plane. */
  nx: number;
  nz: number;
  /** nx*x + nz*z + d > 0 means the camera is inside this wall. */
  d: number;
}

export function createChamber(world: World): Chamber {
  const hi = world.quality === 'high';
  const group = new ChamberRoot();
  group.name = 'chamber';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const surfaces: THREE.Object3D[] = [];

  // --- surface -------------------------------------------------------------------------
  const atlas = buildStoneAtlas(world);

  const stone = new THREE.MeshStandardMaterial({
    color: 0xa79489,
    map: atlas.map,
    normalMap: atlas.normalMap,
    roughnessMap: atlas.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(0.70, 0.70),
  });
  materials.push(stone);

  const voidStone = new THREE.MeshStandardMaterial({
    color: 0x0b0c11,
    roughness: 1.0,
    metalness: 0.0,
  });
  materials.push(voidStone);

  // Carved stone: the shaft screens. Smooth and ordered, so it takes none of the pitting
  // and chipped-arris atlas the rubble masonry wants — just one tiling grain map, so it
  // is stone and not plaster, and per-vertex tone for the staining and the fall into
  // dark. One fetch over the largest surfaces in frame instead of three.
  const grain = makeGrainNormal(hashString('chamber-carved-grain') ^ world.seed, hi ? 256 : 128);
  const carvedStone = new THREE.MeshStandardMaterial({
    // A shade warm in the raw albedo. The room's fill does the cooling; stone that is
    // neutral to start with lands violet once the cold ambient has had it.
    color: 0x635646,
    roughness: 0.88,
    metalness: 0.0,
    vertexColors: true,
    normalMap: grain,
    normalScale: new THREE.Vector2(0.30, 0.30),
  });
  materials.push(carvedStone);

  // The near piers get their own stone, and it is not a stylistic choice.
  //
  // Measured: doubling their per-vertex tone moved the left third of the frame by 0.004
  // on 0.05. Almost none of what is on screen there is the surface — it is the veil and
  // the print black under it — because nothing in the rig lights that corner of the room:
  // every source is aimed either at the board or at the long walls at |z| = 19, and these
  // stand at 12.7 with their modelled faces leaning up into empty air. Light is the
  // lighting piece's to place and I am not going to reach into it.
  //
  // What IS mine is how much of the room these surfaces return. Twice the albedo and
  // four times the environment response: the environment gradient carries its energy
  // overhead, and a pier that leans out over the board is the one thing in this room
  // whose modelled face is turned up into it. That is the whole reason these read at all.
  // Its own grain, tiled three times finer than the screens'. At twenty metres the
  // screens' 2.3 m tile is 134 px across and carries nothing at the scale the detail
  // metric measures; on the nearest stone in the room that is a bare cylinder.
  const nearGrain = makeGrainNormal(hashString('chamber-near-grain') ^ world.seed, hi ? 256 : 128);
  nearGrain.repeat.set(3.4, 3.4);
  const nearStone = new THREE.MeshStandardMaterial({
    color: 0xbfb4a6,
    roughness: 0.80,
    metalness: 0.0,
    vertexColors: true,
    normalMap: nearGrain,
    normalScale: new THREE.Vector2(0.85, 0.85),
    envMapIntensity: 9.0,
  });
  materials.push(nearStone);

  // --- unit geometries -------------------------------------------------------------------
  const blockRng = world.rng.fork('chamber-blocks');
  const blockGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < VARIANTS; i++) {
    const g = makeBlockGeometry(blockRng, atlas.cell(i, i * 5), hi ? 2 : 1, 0.7 + (i % 4) * 0.28);
    blockGeos.push(g);
    geometries.push(g);
  }
  const blindGeo = makeBlindArchGeometry(atlas.cell(3, 2), hi ? 9 : 5);
  geometries.push(blindGeo);

  const chunkRng = world.rng.fork('chamber-chunks');
  const chunkGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < CHUNK_VARIANTS; i++) {
    const g = makeChunkGeometry(chunkRng, atlas.cell(i + 5, i));
    chunkGeos.push(g);
    geometries.push(g);
  }

  // --- the walls ---------------------------------------------------------------------------
  const HW = CHAMBER.halfWidth;   // the two long walls stand at +/- this in x
  const HD = CHAMBER.halfDepth;   // the two end walls stand at +/- this in z
  const H = CHAMBER.wallHeight;

  const longPiers = [-19, -11.4, -3.8, 3.8, 11.4, 19];
  const endPiers = [-15.5, -7.75, 0, 7.75, 15.5];
  /**
   * The end wall's own rhythm, and the one list in this file that is not regular.
   *
   * Its local u is world z, so the establishing camera's axis falls at u = -0.2. The
   * long-wall spacing put a pier at u = -3.8 and another at u = 3.8, which framed a
   * recessed arch dead on that axis and centred the whole far end on it. Irregular
   * spacing, no pier within a metre and a half of the axis, and the bay that straddles it
   * is one of the narrow ones, so what sits at the vanishing point is a small dark recess
   * and not a symmetry.
   */
  const farPiers = [-19, -15.1, -10.4, -7.0, -2.9, 1.4, 6.9, 10.2, 15.5, 19];
  // The portal sits off-centre on the north wall, in the bay of the shaft screen — see
  // the note on BAY_X0.
  const portalPiers = [-15.5, -3.2, 5.4, 15.5];

  const portal: PortalSpec = {
    centre: PORTAL_X,
    half: 2.90,
    spring: 4.30,
    bayU0: -15.5 + 0.95,
    bayU1: -3.2 - 0.95,
    wallTop: H,
  };

  type Spec = WallSpec & {
    place: (g: THREE.Group) => void;
    panel: Omit<Panel, 'groups'>;
    /** Multiplier on this wall's per-block colour. */
    dim?: number;
    /** Where the scree banked at its foot runs. */
    foot: (uMin: number, uMax: number, lossU: number[]) => ScreeLine;
  };
  const specs: Spec[] = [
    {
      // The end wall. Taller than the others because it stands past the vault's
      // springing and has to close the top of the room on its own, and dimmed because
      // it is the one surface in the room that must not resolve.
      // No blind arcade on it, and cut to a fifth. Everything that reads as a FEATURE at
      // the end of a room — a band of small arches, a lit recess, a capital catching the
      // wash — is a statement about where the room stops. This wall may state nothing.
      id: 'east', length: HD * 2, height: H + 8, pierAt: farPiers, pierWidth: 1.9,
      blindArcade: false, plain: true, ruin: 0.06, dim: 0.20,
      place: (g) => { g.position.set(EAST_X, 0, 0); g.rotation.y = -Math.PI / 2; },
      panel: { nx: -1, nz: 0, d: EAST_X - 0.9 },
      foot: (uMin, uMax, losses) => ({
        ax: EAST_X - 0.98, az: uMin, bx: EAST_X - 0.98, bz: uMax, nx: -1, nz: 0, losses, uMin, uMax,
      }),
    },
    {
      id: 'west', length: HD * 2, height: H, pierAt: longPiers, pierWidth: 1.9,
      blindArcade: true, ruin: 0.06,
      place: (g) => { g.position.set(-HW, 0, 0); g.rotation.y = Math.PI / 2; },
      panel: { nx: 1, nz: 0, d: HW - 0.9 },
      foot: (uMin, uMax, losses) => ({
        ax: -HW + 0.98, az: -uMin, bx: -HW + 0.98, bz: -uMax, nx: 1, nz: 0, losses, uMin, uMax,
      }),
    },
    {
      id: 'north', length: HW * 2, height: H, pierAt: portalPiers, pierWidth: 1.9,
      blindArcade: true, ruin: 0.04, portalBay: 0,
      opening: { centre: PORTAL_X, halfWidthAt: (v: number) => portalHalfWidth(portal, v) },
      place: (g) => { g.position.set(0, 0, -HD); },
      panel: { nx: 0, nz: 1, d: HD - 0.9 },
      foot: (uMin, uMax, losses) => ({
        ax: uMin, az: -HD + 0.98, bx: uMax, bz: -HD + 0.98, nx: 0, nz: 1, losses, uMin, uMax,
      }),
    },
    {
      id: 'south', length: HW * 2, height: H, pierAt: endPiers, pierWidth: 1.9,
      blindArcade: true, ruin: 0.05,
      place: (g) => { g.position.set(0, 0, HD); g.rotation.y = Math.PI; },
      panel: { nx: 0, nz: -1, d: HD - 0.9 },
      foot: (uMin, uMax, losses) => ({
        ax: -uMin, az: HD - 0.98, bx: -uMax, bz: HD - 0.98, nx: 0, nz: -1, losses, uMin, uMax,
      }),
    },
  ];

  const panels: Panel[] = [];
  const screeLines: { line: ScreeLine; panel: Panel }[] = [];

  for (const spec of specs) {
    const wallGroup = new THREE.Group();
    wallGroup.name = `chamber-wall-${spec.id}`;
    spec.place(wallGroup);

    const rng = world.rng.fork(`chamber-wall-${spec.id}`);
    const raw = makeWeather(`chamber-weather-${spec.id}`, world.seed, STRING_TOP);
    const weather = spec.dim === undefined ? raw : dimWeather(raw, spec.dim);
    const parts = buildWall(spec, rng, weather, VARIANTS, world.quality);

    if (spec.portalBay !== undefined) {
      buildPortalOrders(parts.sink, rng, weather, portal, hi);
      const pas = buildPortalPassage(portal, stone, hi);
      wallGroup.add(pas.object);
      geometries.push(...pas.geometries);
      materials.push(...pas.materials);
    }

    // backing: what a lost block, a deep recess or an open joint actually shows
    const shape = new THREE.Shape();
    shape.moveTo(-spec.length / 2, -0.4);
    shape.lineTo(spec.length / 2, -0.4);
    shape.lineTo(spec.length / 2, spec.height + 6);
    shape.lineTo(-spec.length / 2, spec.height + 6);
    shape.closePath();
    if (spec.opening) {
      const hole = new THREE.Path();
      const c = spec.opening.centre;
      const r = spec.opening.halfWidthAt(0);
      hole.moveTo(c - r, -0.4);
      hole.lineTo(c - r, portal.spring);
      const segs = 16;
      for (let i = 0; i <= segs; i++) {
        const t = Math.PI - (i / segs) * Math.PI;
        hole.lineTo(c + Math.cos(t) * r, portal.spring + Math.sin(t) * r);
      }
      hole.lineTo(c + r, -0.4);
      hole.closePath();
      shape.holes.push(hole);
    }
    const backGeo = new THREE.ShapeGeometry(shape);
    geometries.push(backGeo);
    const back = new THREE.Mesh(backGeo, voidStone);
    back.position.z = BACK_Z;
    back.receiveShadow = false;
    wallGroup.add(back);

    const meshes = parts.sink.bake(wallGroup, blockGeos, stone, `chamber-${spec.id}`, {
      receiveShadow: true,
      castShadow: false,
    });
    surfaces.push(...meshes);

    if (parts.blind.length) {
      const im = new THREE.InstancedMesh(blindGeo, stone, parts.blind.length);
      im.name = `chamber-blind-${spec.id}`;
      for (let i = 0; i < parts.blind.length; i++) {
        im.setMatrixAt(i, parts.blind[i]);
        im.setColorAt(i, parts.blindColor[i]);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.receiveShadow = true;
      im.castShadow = false;
      wallGroup.add(im);
    }

    group.add(wallGroup);
    const panel: Panel = { groups: [wallGroup], ...spec.panel };
    panels.push(panel);

    // Where this wall has shed blocks, scree gathers under them.
    const lossU = parts.losses.filter((l) => l.v < 6.5).map((l) => l.u);
    screeLines.push({ line: spec.foot(-spec.length / 2, spec.length / 2, lossU), panel });
  }

  // --- floor ---------------------------------------------------------------------------------
  // Both extents now reach past the end wall at EAST_X rather than past CHAMBER.halfWidth.
  const slab = buildFloorSlab(EAST_X + 3, HD);
  geometries.push(slab.geometry);
  materials.push(slab.material);
  group.add(slab.mesh);
  surfaces.push(slab.mesh);

  const floorSink = new InstanceSink(VARIANTS);
  buildFloor(
    floorSink,
    world.rng.fork('chamber-floor'),
    makeWeather('chamber-weather-floor', world.seed, 1.2),
    { halfWidth: EAST_X - 3.0, halfDepth: HD, boardHalf: BOARD_SIZE / 2 + 0.85, hi },
  );
  surfaces.push(...floorSink.bake(group, blockGeos, stone, 'chamber-floor', {
    receiveShadow: true,
    castShadow: false,
  }));

  // --- scree -----------------------------------------------------------------------------------
  // Kept with its wall: when the camera steps outside a wall the wall goes, and so must
  // the rubble heaped against it, or it is left hanging in mid-air.
  const screeWeather = makeWeather('chamber-weather-scree', world.seed, 1.0);
  for (let i = 0; i < screeLines.length; i++) {
    const { line, panel } = screeLines[i];
    const sink = new InstanceSink(CHUNK_VARIANTS);
    buildScree(sink, world.rng.fork(`chamber-scree-${i}`), screeWeather, [line], hi);
    const sg = new THREE.Group();
    sg.name = `chamber-scree-${i}`;
    sink.bake(sg, chunkGeos, stone, `chamber-scree-${i}`, { receiveShadow: true, castShadow: false });
    group.add(sg);
    panel.groups.push(sg);
  }

  // --- the shaft screens -------------------------------------------------------------------
  // The room has to enclose the board, not contain it at a distance. These stand hard
  // against both long kerbs, lean in over the ranks and leave frame top and bottom, and
  // they are what makes the outer thirds stone instead of empty floor.
  //
  // Each side screen is culled by the same plane test the walls use, and for the same
  // reason: `king-surrender` sits eight metres beyond the south screen and would
  // otherwise be looking at the back of it. The threshold is set well inside the screen
  // so no amount of handheld drift can pop it.
  const carvedTone = makeCarvedTone('chamber-carved', world.seed);
  const screenPanels: { sign: 1 | -1; bay: boolean }[] = [
    { sign: -1, bay: true },   // the portal is on this wall: leave its bay clear
    { sign: 1, bay: false },
  ];
  let screenTris = 0;
  for (const s of screenPanels) {
    const sg = new THREE.Group();
    sg.name = `chamber-screen-${s.sign < 0 ? 'north' : 'south'}`;

    const front = buildSideScreen(s.sign, hi, carvedTone, s.bay);
    geometries.push(front.geometry);
    const fm = new THREE.Mesh(front.geometry, carvedStone);
    fm.name = `${sg.name}-shafts`;
    fm.receiveShadow = true;
    fm.castShadow = false;
    sg.add(fm);
    surfaces.push(fm);

    const back = buildBackRow(s.sign, hi, carvedTone, s.bay);
    geometries.push(back.geometry);
    const bm = new THREE.Mesh(back.geometry, carvedStone);
    bm.name = `${sg.name}-back`;
    bm.receiveShadow = true;
    bm.castShadow = false;
    sg.add(bm);

    // Scree banked against the foot of the screen. It closes the strip of bare floor
    // between the board's kerb and the shafts — the last place the eye could find an
    // edge to the room — and it is coarse structure, which is the band the render is
    // short of against the reference.
    const screeSink = new InstanceSink(CHUNK_VARIANTS);
    buildScree(
      screeSink,
      world.rng.fork(`chamber-screen-scree-${s.sign}`),
      screeWeather,
      [{
        ax: -17.0, az: s.sign * (SIDE_Z - 0.75),
        bx: 21.6, bz: s.sign * (SIDE_Z - 0.75),
        nx: 0, nz: -s.sign, losses: [], uMin: -17.0, uMax: 21.6,
      }],
      hi,
    );
    screeSink.bake(sg, chunkGeos, stone, `chamber-screen-scree-${s.sign}`, {
      receiveShadow: true, castShadow: false,
    });

    screenTris += front.triangles + back.triangles;
    group.add(sg);
    panels.push({ groups: [sg], nx: 0, nz: -s.sign, d: SIDE_Z - 1.6 });
  }

  // The heap that has accumulated behind the far ranks. It stays where it was — hard
  // against the board's far kerb, which is where the reference has it, with fires
  // burning in it — even though the wall it used to bank against has gone twenty-three
  // metres up the room. It is the last thing the eye can resolve looking down the board,
  // and everything past it is air.
  const fg = new THREE.Group();
  fg.name = 'chamber-far-heap';
  const farScreeSink = new InstanceSink(CHUNK_VARIANTS);
  buildScree(
    farScreeSink,
    world.rng.fork('chamber-far-scree'),
    screeWeather,
    [{
      ax: 12.35, az: -14.6, bx: 12.35, bz: 14.6,
      nx: -1, nz: 0, losses: [], uMin: -14.6, uMax: 14.6,
    }],
    hi,
  );
  farScreeSink.bake(fg, chunkGeos, stone, 'chamber-far-scree', {
    receiveShadow: true, castShadow: false,
  });

  group.add(fg);
  panels.push({ groups: [fg], nx: -1, nz: 0, d: 11.2 });

  // --- the near-field piers ----------------------------------------------------------------
  // The one thing the room had none of. Everything above stands BEHIND the ranks; these
  // stand in front of them, hard outside the kerb, and they are cut by the top and the
  // bottom of frame at once. See `piers.ts` for why that matters more than any of it.
  const nearTone = makeNearTone('chamber-near', world.seed);
  for (const sign of [-1, 1] as const) {
    const pg = new THREE.Group();
    pg.name = `chamber-piers-${sign < 0 ? 'north' : 'south'}`;
    const built = buildNearPiers(sign, hi, nearTone);
    geometries.push(built.geometry);
    const pm = new THREE.Mesh(built.geometry, nearStone);
    pm.name = `${pg.name}-shafts`;
    pm.receiveShadow = true;
    pm.castShadow = false;
    pg.add(pm);
    surfaces.push(pm);
    group.add(pg);
    screenTris += built.triangles;
    // `knight-looking-up` sits five centimetres off the south row's axis, so this cull
    // is not a nicety — without it that shot is inside a pier.
    panels.push({ groups: [pg], nx: 0, nz: -sign, d: NEAR_Z - 1.0 });
  }
  void screenTris;

  // --- vault ---------------------------------------------------------------------------------
  const vaultGeo = makeVaultGeometry(HW, HD + 1.0, H, 5.5, hi ? 26 : 14, hi ? 10 : 5);
  geometries.push(vaultGeo);
  const vault = new THREE.Mesh(vaultGeo, voidStone);
  vault.name = 'chamber-vault';
  vault.receiveShadow = false;
  vault.castShadow = false;
  group.add(vault);

  // --- which walls is the camera inside of? -----------------------------------------------------
  const cam = world.camera;
  const camPos = new THREE.Vector3();
  group.cull = () => {
    cam.getWorldPosition(camPos);
    for (const p of panels) {
      const inside = p.nx * camPos.x + p.nz * camPos.z + p.d > 0;
      for (const g of p.groups) g.visible = inside;
    }
  };

  return {
    group,
    surfaces,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      nearGrain.dispose();
    grain.dispose();
    atlas.dispose();
      group.cull = null;
    },
  };
}
