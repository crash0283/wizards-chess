/**
 * PIECE: chamber — what has come off the walls and stayed there.
 *
 * Scree gathers where the floor meets the wall and piles up in the corners, thickest
 * under the places the masonry has actually lost blocks. Below that, grit: a fine
 * scatter that softens the line where the plinth lands. This is the only clutter the
 * room gets — no props, no furniture, nothing that was ever carried in.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { InstanceSink } from './sink';
import type { Weather } from './weather';

export interface ScreeLine {
  /** Start and end of the wall base in world xz. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit vector pointing into the room. */
  nx: number;
  nz: number;
  /** Local x of blocks that have fallen out of this wall, in wall parameter space. */
  losses: number[];
  /** Local x of the wall's start, so `losses` can be mapped onto the line. */
  uMin: number;
  uMax: number;
}

export interface HeapSpec {
  /** Ridge line of the heap, in world xz. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Which way the heap spills. Unit vector. */
  nx: number;
  nz: number;
  /** Height at the crest, metres. */
  crest: number;
  /** How far it spills forward from the ridge at the crest. */
  reach: number;
}

/**
 * The heap of destroyed pieces banked behind the far ranks.
 *
 * `buildScree` lays a talus: chunks resting on the floor, a metre high at most, which is
 * right at the foot of a wall and useless here. What the reference has behind the far
 * rank is a MOUND — three and a half metres of piled wreckage with fires burning in it,
 * standing between the board and the end of the room, and it is doing two jobs at once.
 * It is the last thing the eye resolves looking down the board, so it is what stops the
 * far wall from being read as the end of anything; and it is the only large irregular
 * mass in the top third of frame that stands close enough to the kerb fires to actually
 * be lit, which matters because that band of the picture carries a third of the film's
 * edge energy and almost nothing else up there has a light on it.
 *
 * Built as a profile rather than a scatter: density and block size fall off from the
 * crest, pieces sit at every height rather than all on the floor, and the crest line
 * itself wanders, so the silhouette against the wall behind is broken all the way along.
 */
export function buildHeap(
  sink: InstanceSink, rng: Rng, weather: Weather, spec: HeapSpec, hi: boolean,
): void {
  const col = new THREE.Color();
  const dx = spec.bx - spec.ax;
  const dz = spec.bz - spec.az;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  // Density along the ridge. The heap's job is a broken silhouette against the room
  // behind it, and a silhouette is set by the crest wander and by the biggest stones in
  // it, not by how many small ones are packed in underneath where nothing can see them.
  // Cutting 7/m to 4/m across the two banks and the talus takes the far heap from 448
  // chunks to about 250 without moving the crest line, because `wob` and `crest` are pure
  // functions of the sample parameter and are unchanged.
  const n = Math.round(len * (hi ? 21 : 4));
  const m = new THREE.Matrix4();

  for (let i = 0; i < n; i++) {
    const t = rng();
    // Crest height wanders along the ridge — three low sags and a couple of shoulders,
    // so the top line never rules straight across the room.
    const wob = 0.62
      + 0.38 * Math.sin(t * 11.3 + 0.7)
      + 0.24 * Math.sin(t * 4.1 + 2.4)
      + 0.16 * Math.sin(t * 23.7);
    const crest = spec.crest * Math.max(0.28, wob);

    // Where in the section this block sits: h is height fraction, and the heap narrows
    // as it rises, so the profile is a mound and not a wall.
    const h = Math.pow(rng(), 0.62);
    const y = h * crest;
    const spread = spec.reach * (1 - h * 0.82);
    const off = (rng() * 2 - 1) * spread;

    // Big stone at the bottom, smaller and more broken toward the crest.
    const s = (0.34 + Math.pow(rng(), 2.0) * 1.35) * (1 - 0.45 * h);
    const x = spec.ax + ux * (t * len) + spec.nx * off;
    const z = spec.az + uz * (t * len) + spec.nz * off;
    if (Math.abs(x) < 10.4 && Math.abs(z) < 10.4) continue;

    weather.tone(x * 0.7 + 57, 0.5 + y * 0.4, 0.30 + 0.22 * h, col);
    // Cut hard. At the scree's albedo this heap came back a blown white drift standing in
    // the middle of a cold dark room; the reference's is dark brown-grey wreckage that the
    // fires pick out in places and nowhere else. It also has to stay under the far wall in
    // value, or it becomes the new thing that tells you where the room ends.
    col.multiplyScalar(0.38);
    m.compose(
      new THREE.Vector3(x, y + s * rng.float(0.10, 0.34), z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng.float(0, 6.283), rng.float(0, 6.283), rng.float(0, 6.283)),
      ),
      new THREE.Vector3(s, s * rng.float(0.55, 1.0), s * rng.float(0.7, 1.4)),
    );
    sink.add((i * 7) | 0, m, col);
  }
}

export function buildScree(
  sink: InstanceSink, rng: Rng, weather: Weather, lines: ScreeLine[], hi: boolean,
): void {
  const col = new THREE.Color();
  const perMetre = hi ? 3.1 : 0.9;
  /**
   * Grit does not exist on the low tier, and this is the clearest case in the piece of
   * geometry that cannot resolve.
   *
   * A grit chunk is 3.5 to 16 cm across. The play camera stands 15 m up and 21 m back, so
   * the nearest wall foot is twenty-five metres out and the far heap is forty; behind a
   * 512 px render buffer across the frame's horizontal field, one pixel is about four
   * centimetres at twenty-five metres and seven at forty. Every one of these is between a
   * quarter of a pixel and four pixels, they sit in the darkest band of the floor, and
   * there were roughly seven hundred of them around the room. They are a talus texture for
   * a camera standing in the room, and no camera in interactive play ever does.
   *
   * The talus itself stays — the line where floor meets wall still has stone banked
   * against it, just laid at 0.9 chunks a metre instead of 1.4.
   */
  const gritPerMetre = hi ? 3.4 : 0;

  for (const line of lines) {
    const dx = line.bx - line.ax;
    const dz = line.bz - line.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;

    // extra weight under losses, plus a general talus along the base
    const hotspots = line.losses.map((u) => (u - line.uMin) / (line.uMax - line.uMin));

    const n = Math.round(len * perMetre);
    for (let i = 0; i < n; i++) {
      let t = rng();
      // bias toward the corners and toward places the wall has lost blocks
      if (rng.bool(0.34)) t = rng.bool(0.5) ? t * t * 0.22 : 1 - t * t * 0.22;
      else if (hotspots.length && rng.bool(0.45)) {
        t = Math.max(0, Math.min(1, rng.pick(hotspots) + rng.gauss() * 0.014));
      }
      const off = 0.10 + Math.abs(rng.gauss()) * 0.52;
      const s = 0.10 + Math.pow(rng(), 2.6) * 1.05;
      const x = line.ax + ux * (t * len) + line.nx * off;
      const z = line.az + uz * (t * len) + line.nz * off;
      // Nothing may end up on the board.
      if (Math.abs(x) < 10.2 && Math.abs(z) < 10.2) continue;
      weather.tone(x * 0.7 + 91, 0.5, 0.42, col);
      col.multiplyScalar(0.88);
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(x, s * rng.float(0.20, 0.42), z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng.float(0, 6.283), rng.float(0, 6.283), rng.float(0, 6.283)),
        ),
        new THREE.Vector3(s, s * rng.float(0.5, 0.9), s * rng.float(0.7, 1.3)),
      );
      sink.add((i * 5) | 0, m, col);
    }

    const g = gritPerMetre > 0 ? Math.round(len * gritPerMetre) : 0;
    for (let i = 0; i < g; i++) {
      const t = rng();
      const off = 0.12 + Math.abs(rng.gauss()) * 0.9;
      const s = 0.035 + Math.pow(rng(), 2.0) * 0.13;
      const x = line.ax + ux * (t * len) + line.nx * off;
      const z = line.az + uz * (t * len) + line.nz * off;
      if (Math.abs(x) < 10.2 && Math.abs(z) < 10.2) continue;
      weather.tone(x * 0.7 + 13, 0.4, 0.30, col);
      col.multiplyScalar(0.94);
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(x, s * 0.35, z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng.float(0, 6.283), rng.float(0, 6.283), rng.float(0, 6.283)),
        ),
        new THREE.Vector3(s, s * 0.55, s * rng.float(0.8, 1.4)),
      );
      sink.add((i * 3 + 1) | 0, m, col);
    }
  }
}
