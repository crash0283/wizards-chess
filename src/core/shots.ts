/**
 * Shot definitions. FROZEN CORE — do not edit in a piece build.
 *
 * These ids are the contract between builders and critics: a critic renders
 * `?shot=<id>&t=<t>` and compares the result against refs/frames/<id>.jpg (or, while
 * the reference frames are unavailable, against that shot's brief in
 * refs/SHOT_BRIEFS.md). The nominal camera below is the STARTING framing — the camera
 * piece is free to add lens character, handheld motion, focus and shake on top, but
 * must not re-aim the shot, or renders stop being comparable across rounds.
 */
import { PIECE_HEIGHT, SQUARE, squareCentre } from './constants';

export interface ShotDef {
  id: string;
  /** Human name used in progress.html. */
  label: string;
  /** Eye position, metres. */
  eye: [number, number, number];
  /** Look-at target, metres. */
  target: [number, number, number];
  /** Vertical FOV in degrees (matched to a 2.39:1 frame). */
  fov: number;
  /** Distance to the focal plane, metres. 0 = auto (focus on target). */
  focus: number;
  /** f-number. Lower = shallower. */
  fstop: number;
  /** Scene time this shot is normally captured at. */
  t: number;
  /** Which piece this shot primarily judges. */
  judges: string[];
  /** One-line statement of what this shot has to prove. */
  proves: string;
}

const c = (f: number, r: number) => squareCentre(f, r);

export const SHOTS: ShotDef[] = [
  {
    id: 'wide-establishing',
    label: 'Wide establishing',
    eye: [2.5, 12.0, 24.5],
    target: [0, 2.2, -1.5],
    fov: 34,
    focus: 26,
    fstop: 4.0,
    t: 3.0,
    judges: ['chamber', 'lighting', 'board', 'camera'],
    proves: 'The room is enormous, firelit in separated pools, and the board is floor, not furniture.',
  },
  {
    id: 'low-across-board',
    label: 'Low across the board',
    eye: [c(2, 0).x - 0.6, 0.82, c(2, 0).z + SQUARE * 0.9],
    target: [c(4, 5).x, 2.4, c(4, 5).z],
    fov: 46,
    focus: 15.5,
    fstop: 2.0,
    t: 3.0,
    judges: ['board', 'pieces', 'lighting', 'camera'],
    proves: 'Floor-level scale: pieces tower, the stone floor holds the finest detail in frame.',
  },
  {
    id: 'knight-looking-up',
    label: 'Knight, looking up',
    eye: [c(1, 0).x + 1.35, 0.5, c(1, 0).z + 2.5],
    target: [c(1, 0).x - 0.15, PIECE_HEIGHT.knight * 0.86, c(1, 0).z - 0.3],
    fov: 52,
    focus: 3.4,
    fstop: 2.2,
    t: 3.0,
    judges: ['pieces', 'lighting', 'camera'],
    proves: 'The piece is carved stone — chisel facets, chipped edges, rim light, dust in the air.',
  },
  {
    id: 'piece-mid-strike',
    label: 'Piece mid-strike',
    eye: [c(3, 3).x + 5.6, 1.62, c(3, 3).z + 5.0],
    target: [c(3, 4).x - 0.4, 2.5, c(3, 4).z - 0.2],
    fov: 40,
    focus: 7.4,
    fstop: 2.8,
    t: 0.62,
    judges: ['destruction', 'pieces', 'camera', 'game'],
    proves: 'Committed weight, arc-shaped motion blur on the weapon only, air already disturbed.',
  },
  {
    id: 'aftermath-rubble',
    label: 'Aftermath, rubble',
    eye: [c(3, 4).x + 4.2, 3.05, c(3, 4).z + 3.6],
    target: [c(3, 4).x, 0.75, c(3, 4).z],
    fov: 42,
    focus: 5.6,
    fstop: 3.2,
    t: 2.35,
    judges: ['destruction', 'lighting', 'board'],
    proves: 'Stone broke: angular chunks, bright fresh interior faces, settled rest, dust lit through.',
  },
  {
    id: 'king-surrender',
    label: "King's surrender",
    eye: [c(4, 7).x + 7.0, 2.85, c(4, 7).z + 11.5],
    target: [c(4, 7).x - 1.0, 2.6, c(4, 7).z],
    fov: 38,
    focus: 12.5,
    fstop: 3.5,
    t: 2.8,
    judges: ['game', 'chess', 'lighting', 'camera'],
    proves: 'A real checkmate on the board, the blade falls dead to stone, everything stops.',
  },
];

export const SHOT_BY_ID = new Map(SHOTS.map((s) => [s.id, s]));

export function getShot(id: string): ShotDef {
  return SHOT_BY_ID.get(id) ?? SHOTS[0];
}
