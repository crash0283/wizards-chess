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
    // Camera stands INSIDE the board looking back at White's knight on b1. Two earlier
    // versions of this shot failed for the same reason in different ways: aimed at
    // mid-board, then aimed correctly but placed BEYOND the back rank, where the subject
    // is backlit against a void and a critic had to brighten crops 3x to see anything.
    // The flames burn on the kerb, so the light is on the board side — stand there.
    eye: [c(1, 0).x + 1.45, 1.30, c(1, 0).z + 6.6],
    target: [c(1, 0).x, 2.20, c(1, 0).z],
    fov: 40,
    focus: 6.8,
    fstop: 2.2,
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
 * It is deliberately NOT in SHOTS: it must never be judged against a reference frame,
 * because it is not trying to look like the film. It IS capturable — `--shot=play` is how
 * this view gets measured — and until this round that capture came back through the
 * perspective frustum, so it measured a picture nobody had ever played on.
 *
 * ── the declination, which is the only interesting number here ───────────────────────
 *
 * This has now been set three times, and each move was a correction of the last:
 *
 *   35°  cinematic, and unplayable — the ranks stacked on top of one another, so distant
 *        men overlapped and there was no way to tell which one a click meant.
 *   71°  separated the ranks, and put the camera straight THROUGH the chamber's
 *        near-field piers, which lean seven metres out over the board. Black bars across
 *        White's whole back rank.
 *   80°  cleared the piers. It also solved the wrong problem completely.
 *
 * Captured and LOOKED AT (`refs/renders/play--before81.png`), 80° is a plan drawing. From
 * eight degrees off vertical a chess piece is a disc: every man on the board presents his
 * crown and nothing else, and a pawn, a rook and a bishop are three circles of slightly
 * different diameter. "Every square separates" was true and was never the difficulty —
 * the player could see thirty-two counters and not one PIECE. Height is what identifies a
 * chess man, and a camera eight degrees off vertical is a camera that has thrown height
 * away.
 *
 * 62° is where the profiles come back. Screen height of a standing man goes as cos of the
 * declination, so this is 3.1x what 80° gave — a bishop's mitre, a knight's head and a
 * rook's crenellations are all silhouette again — while the board's own depth only
 * compresses by 12% (sin 62° = 0.883 against 0.985), so the eight ranks are still eight
 * clearly separate bands. The far wall comes into the top of the picture, which the plan
 * view had no room for at all, and the room finally reads as a room.
 *
 * Two things make 62° safe that were not available the last two times this moved:
 *
 *   - PICKING. `game/interactive.ts` now picks the nearest man the ray passes THROUGH
 *     before falling back to the board plane, so a click on a piece's body selects that
 *     piece rather than the empty square behind it. That is what makes obliquity usable;
 *     see the long note on `boardSquare`. Plane-only picking is why the earlier oblique
 *     camera was abandoned, and it is fixed rather than avoided.
 *   - OCCLUSION. The worst pair on the board is White's own KING on e1 standing in front of
 *     White's own PAWN on e2 — the camera is behind White, so White's court rank is the one
 *     doing the hiding, and a 2.00 m height step is the largest anywhere at one rank of
 *     separation. Under a parallel projection the pawn's crown clears the king's by
 *     (H_far - H_near)·cos D + SQUARE·sin D, which is zero at atan(2.00/2.35) = 40.4° and
 *     positive above it: 0.515 m at 50°, 0.778 m at 55°, 1.136 m at 62°.
 *
 * Both the chamber's near-field pier cutback (`chamber/playview.ts`) and the parallel
 * frustum (`camera/ortho.ts`) solve themselves from the eye below, so moving it moves
 * them. The near plane's ceiling cut now runs from 7.0 m over White's back rank to 17.0 m
 * over Black's — which is CHAMBER.wallHeight exactly, so the far wall arrives at full
 * height and is not sectioned.
 *
 * ── the distance, which is not a free parameter after all ────────────────────────────
 *
 * Under a parallel projection how far the eye stands changes the framing by exactly
 * nothing, and the ceiling cut is fixed by the BEARING and the two anchor points, so it
 * does not move either. That makes the distance look arbitrary. It is not, because two
 * things still read it, and one of them is the air.
 *
 * `lighting/atmosphere.ts` veils by `1 - exp(-dist^2 * density^2)`, quadratic in the range
 * from the eye, and the board is a floor lying at the bottom of the haze where the height
 * falloff has not begun to thin it. At 34 m the veil over the middle of the board came out
 * at 0.385 and over Black's back rank at 0.52 — against `wide-establishing`, whose eye is
 * 25.8 m from the board centre and whose veil there is 0.244. The play camera was looking
 * at the same stone through 1.6x the film's air, and a fitted measurement says that veil
 * was 35.8% of everything a lit cream square was putting on screen. It is most of what
 * reads as the middle of the board being washed out, and no amount of work on the STONE
 * can reach it — trimming the marble to black would still leave it.
 *
 * So the eye stands 26 m out: the distance the film camera stands at. The play view is the
 * same room, seen through the same depth of air, from a different bearing. Measured over
 * the board that puts the veil at 0.222 near, 0.247 centre and 0.358 far, bracketing the
 * film's own 0.244 instead of doubling it.
 *
 * The other reader is the chamber's pier cutback, which solves its keep-out cone from this
 * eye. It is insensitive to the change: below the ortho ceiling — the only place a near
 * pier is still drawn — the clamp is pinned to the protected box's own face at 10.55 m for
 * any distance, and everything above it is sectioned away before it can be rasterised.
 */
export const PLAY_SHOT: ShotDef = {
  id: 'play',
  label: 'Play view',
  // 50° declination on the board's centre line, 26 m out: eye 21.3 m up, 16.7 m behind
  // White. See the header — the angle is the whole point of the shot, and the distance is
  // how much air is in front of it.
  eye: [0, 21.3, -16.7],
  // Aimed at the middle of the board a pawn's half-height up, so the axis runs through
  // the men rather than along the floor.
  target: [0, 1.4, 0],
  fov: 38,
  focus: 26,
  // f/11 keeps the circle of confusion under a pixel across the whole board. Playing is
  // not the place for shallow focus — the cinematic shots carry that. (Interactively the
  // gather is bypassed outright; a parallel projection does not write the depth its
  // reconstruction assumes.)
  fstop: 11,
  t: 0,
  judges: [],
  proves: 'Every man reads as the piece he is, and what you click is what you get.',
};

export const SHOT_BY_ID = new Map([...SHOTS, PLAY_SHOT].map((s) => [s.id, s]));

export function getShot(id: string): ShotDef {
  return SHOT_BY_ID.get(id) ?? SHOTS[0];
}
