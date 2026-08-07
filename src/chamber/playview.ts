/**
 * PIECE: chamber — the near field, seen from the play camera.
 *
 * Everything else in this module is composed for the film frames, and the near-field
 * piers and the side screens are the extreme case: they stand hard against the board's
 * long kerbs and LEAN IN over it, so that from a low cinematic camera they are cut by the
 * bottom of frame at the foot and by the top of frame where they cross over the ranks.
 * That is deliberate, a critic asked for it, and from `wide-establishing` it is the
 * single thing that makes the room enclose the board rather than stand around it.
 *
 * Interactive play now sits somewhere no film shot does: 30 m up, looking almost straight
 * down (`PLAY_SHOT`). From there the same lean is fatal. A shaft whose head hangs seven
 * metres out over the board is directly between that camera and White's back rank, and it
 * reads as a picket fence of black bars across the bottom third of the picture — the
 * player cannot see, let alone click, their own pieces.
 *
 * The fix is not to delete the architecture. It is to STOP THE LEAN AT THE SIGHT LINE:
 * a second build of the same piers and the same screens, identical from the foot up,
 * whose heads are clamped so they come exactly as close to the board as they can without
 * standing in front of any square. The room still closes over the board — the stone still
 * reaches in and the strip between kerb and frame edge is still stone — but every square
 * and every piece on it is clear.
 *
 * ## The keep-out volume
 *
 * A surface occludes a square if it lies inside the convex hull of the eye and the box
 * that contains the board and everything standing on it. That box is the 8x8 plus a
 * margin, from the floor up to `PROTECT_TOP` (a king is 4.55 m; this clears his crown
 * with room to spare). On each side of the board the hull's boundary is:
 *
 *   - below `PROTECT_TOP`, the face of the box itself;
 *   - above it, the plane through the eye and the box's top edge, which converges on the
 *     eye as it rises — so the higher a shaft goes, the further it is ALLOWED to lean.
 *     That is why the clamped piers still read as a vault springing over the board and
 *     not as a paling fence.
 *
 * The eye sits at z = -5.2, not over the board's centre, so the two sides are not
 * mirrored: the far row (+z) is very nearly unaffected — the camera looks along it and it
 * was never in the way — and the near row (-z) is the one that has to give.
 *
 * ## Why x matters, and matters a lot
 *
 * The first version of this clamped on z alone, and it cost the play view its whole near
 * field: every pier went back far enough to fall out of the bottom of frame, and the room
 * ended at a black strip below White's back rank. That was wrong, because a shaft standing
 * at x = -13 is not in front of anything however far it leans — the sight ray through it
 * has already left the board SIDEWAYS long before it reaches the squares. Only stone
 * within the cone's x-span can occlude, and that span narrows with height exactly as the
 * z-span does.
 *
 * So the clamp is gated on x, and the result is the shape the view actually wants: the
 * piers and screen shafts out at the frame edges keep their full seven-metre lean and fill
 * the corners with stone, and only the two or three clusters that stand directly over a
 * file pull back. The near field reads as a vault coming down around the board and
 * stopping where the board starts.
 *
 * ## What this must never touch
 *
 * Nothing here runs for a film frame. The switch is `PLAY_CAM_MIN_Y`, a pure test on the
 * live camera's height in the same style as the wall culling — the highest of the six
 * judged shots is `wide-establishing` at 10.6 m and the play camera is at 30. No shot the
 * critics render can reach the threshold, so their pixels are the pixels they always were.
 */
import { PLAY_SHOT } from '../core/shots';
import { BOARD_SIZE } from '../core/constants';

/**
 * Camera height above which the chamber swaps to its play build.
 *
 * Deliberately a camera-position test and not `world.capturing`. Two reasons. The frame
 * being drawn is the only thing that matters — a shaft is in the way or it is not, and
 * that is a fact about where the lens is. And it means the play view can be CAPTURED and
 * inspected (`--shot=play`), which is how it gets checked at all; a `capturing` test would
 * make the one render that could prove the fix show the unfixed room.
 *
 * The margin is enormous: 10.6 m is the highest camera in `SHOTS`, and the camera piece's
 * handheld drift is centimetres.
 */
export const PLAY_CAM_MIN_Y = 18.0;

/** Half-extent of the volume that must stay clear, in x and z. Board is 18.8 m across. */
const PROTECT_HALF = BOARD_SIZE / 2 + 1.15;

/** Top of that volume. The tallest piece is a 4.55 m king; this clears him and his plinth. */
const PROTECT_TOP = 6.2;

const EYE_X = PLAY_SHOT.eye[0];
const EYE_Y = PLAY_SHOT.eye[1];
const EYE_Z = PLAY_SHOT.eye[2];

/**
 * How much sideways clearance releases the clamp completely, in metres measured on the
 * protected box's own plane. A band rather than a step: the exact answer has a hard edge
 * at the box's corner, and a hard edge in a swept path is a kink in the stone. Releasing
 * over 2.4 m only ever makes the clamp STRONGER than it needs to be, never weaker.
 */
const RELEASE = 2.4;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How close to the board's axis a surface on side `sign` may come at height `y`,
 * measured as `sign * z`. Anything smaller stands in front of a square — as long as the
 * sight ray through it is still over the board in x, which is what `clearSight` tests.
 */
export function sightLimit(sign: 1 | -1, y: number): number {
  const s = Math.max(0, Math.min(1, (EYE_Y - y) / (EYE_Y - PROTECT_TOP)));
  return sign * EYE_Z + s * (PROTECT_HALF - sign * EYE_Z);
}

/**
 * Push one station of a shaft back out of the sight cone, if it is in it at all.
 *
 * `r` is the shaft's radius there, so it is the SURFACE that clears the line and not the
 * axis — a 1 m foot moulding leaning on the limit would otherwise put its inner flank a
 * metre over it. It also fattens the x test, so a cluster is judged by its inner flank.
 */
export function clearSight(
  sign: 1 | -1, x: number, y: number, z: number, r: number,
): number {
  if (y >= EYE_Y) return z;

  // Where the sight ray through (x, y) crosses the top and the bottom of the protected
  // box. Between those two the ray is inside the box's height band; if it is outside the
  // board in x for the whole of that stretch, no lean at all can put this stone in front
  // of a square.
  const u0 = Math.max(1, (EYE_Y - PROTECT_TOP) / (EYE_Y - y));
  const u1 = Math.max(1, EYE_Y / (EYE_Y - y));
  const a = EYE_X + u0 * (x - EYE_X);
  const b = EYE_X + u1 * (x - EYE_X);
  const lo = Math.min(a, b) - u1 * r;
  const hi = Math.max(a, b) + u1 * r;
  const sideways = lo > PROTECT_HALF ? lo - PROTECT_HALF
    : hi < -PROTECT_HALF ? -PROTECT_HALF - hi
      : 0;
  const w = 1 - smoothstep(0, RELEASE, sideways);
  if (w <= 0) return z;

  const need = sightLimit(sign, y) + r;
  const clamped = sign * z >= need ? z : sign * need;
  return z + (clamped - z) * w;
}
