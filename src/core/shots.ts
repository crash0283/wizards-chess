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
    // Reference: camera is off the SIDE of the board looking across it, elevated. The two
    // armies therefore rank up on frame left and frame right, and the empty middle of the
    // board recedes to a vanishing point through the centre of frame.
    id: 'wide-establishing',
    label: 'Wide establishing',
    eye: [-23.5, 10.6, 0.4],
    target: [1.0, 1.1, 0],
    fov: 38,
    focus: 24,
    fstop: 4.0,
    t: 3.0,
    judges: ['chamber', 'lighting', 'board', 'camera'],
    proves: 'Cold room, many small flames, polished veined marble receding — the board is floor.',
  },
  {
    id: 'low-across-board',
    label: 'Low across the board',
    eye: [-15.5, 2.15, 9.4],
    target: [-1.0, 2.3, -0.6],
    fov: 44,
    focus: 15.0,
    fstop: 2.4,
    t: 3.0,
    judges: ['board', 'pieces', 'lighting', 'camera'],
    proves: 'Floor-level scale: pieces tower, flames sit low as small warm points in a cold room.',
  },
  {
    /**
     * Reference: in among the pieces, low and close, looking UP at a mounted knight.
     *
     * This was previously aimed at mid-board with the eye below plinth-cap height, so the
     * near pieces were cropped headless and the shot's stated subject — the mounted knight
     * — was not in frame at all. It now sits on the black knight's square b8 = (1,7), one
     * plinth-height up, close enough that the piece fills the frame.
     */
    id: 'knight-looking-up',
    label: 'Knight, looking up',
    eye: [c(1, 7).x + 0.35, 1.15, c(1, 7).z + 4.0],
    target: [c(1, 7).x, 2.65, c(1, 7).z],
    fov: 42,
    focus: 4.3,
    fstop: 2.0,
    t: 3.0,
    judges: ['pieces', 'lighting', 'camera'],
    proves: 'Figurative armoured combatants on moulded plinths, rust-stained pale stone, soft background.',
  },
  {
    /**
     * Reference: a long-lens MEDIUM. The lunging attacker and the detonating target fill
     * the frame on one shallow plane of critical focus.
     *
     * These coordinates are not arbitrary: the demo game's final capture is Qxc8#, so the
     * victim stands on c8 = (2,7) and the attacker comes along the rank from b8 = (1,7).
     * An earlier version of this shot was aimed at d5, which is empty — the camera was
     * pointing at bare board while the destruction happened off-frame, which is why the
     * strike read as "a small cluster of debris in the middle distance". If the demo line
     * ever changes, these must follow the new capture square.
     */
    id: 'piece-mid-strike',
    label: 'Piece mid-strike',
    eye: [c(2, 7).x - 0.9, 2.45, c(2, 7).z + 4.1],
    target: [c(2, 7).x - 1.0, 2.20, c(2, 7).z],
    fov: 26,
    focus: 4.2,
    fstop: 2.0,
    t: 0.62,
    judges: ['destruction', 'pieces', 'camera', 'game'],
    proves: 'Committed thrust, opaque white burst, dark angular fragments flying through it.',
  },
  {
    // Same capture as piece-mid-strike (Qxc8#, victim on c8), a beat later and higher, so
    // the plume still stands above the debris field it left. See the note on that shot.
    id: 'aftermath-rubble',
    label: 'Aftermath, rubble',
    eye: [c(2, 7).x + 1.6, 3.70, c(2, 7).z + 5.0],
    target: [c(2, 7).x - 0.4, 1.35, c(2, 7).z],
    fov: 34,
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

/**
 * The PLAY camera. Not a film shot — the one you actually sit behind.
 *
 * The cinematic shots are composed to look like the film, which means low angles, long
 * lenses and shallow focus. All three are actively hostile to playing chess: from
 * `wide-establishing` you cannot tell which square is which, the near pieces are enormous,
 * and the bokeh softens exactly the things you are trying to click on.
 *
 * So interactive play gets its own camera: elevated behind White, looking down at about
 * 35 degrees so ranks and files separate cleanly, the whole board inside the frame with
 * margin, and — critically — a DEEP stop. f/11 puts the circle of confusion below a pixel
 * across the entire board, so nothing you are trying to tap is blurred.
 *
 * It is deliberately NOT in SHOTS: it must never be captured or judged, because it is not
 * trying to look like the film.
 */
export const PLAY_SHOT: ShotDef = {
  id: 'play',
  label: 'Play view',
  eye: [0, 15.0, -21.0],
  target: [0, 0.6, 0.5],
  fov: 30,
  focus: 26,
  fstop: 11,
  t: 0,
  judges: [],
  proves: 'You can see which square is which, and what you tap is sharp.',
};

export const SHOT_BY_ID = new Map([...SHOTS, PLAY_SHOT].map((s) => [s.id, s]));

export function getShot(id: string): ShotDef {
  return SHOT_BY_ID.get(id) ?? SHOTS[0];
}
