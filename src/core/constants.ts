/**
 * Shared world constants. FROZEN CORE — every piece reads these, nobody edits them.
 *
 * Units are metres. The scene is built at true film scale: a human standing on this
 * board would come up to a pawn's chest. All scale decisions trace back to here.
 */

/** Edge length of one board square. A piece stands inside one with room to spare. */
export const SQUARE = 2.35;

/** Full board is 8 squares across. */
export const BOARD_SIZE = SQUARE * 8; // 18.8 m

/** Board surface sits flush with the chamber floor at y = 0. */
export const FLOOR_Y = 0;

/** Chamber interior extents. The board is centred at the origin. */
export const CHAMBER = {
  halfWidth: 15.5,
  halfDepth: 19.0,
  wallHeight: 17.0,
  /** Above this, geometry is present but should read as unresolved darkness. */
  darknessBegins: 9.5,
} as const;

/** Standing height of each piece type, in metres, base to crown. */
export const PIECE_HEIGHT = {
  pawn: 2.55,
  knight: 3.35,
  bishop: 3.55,
  rook: 3.05,
  queen: 4.15,
  king: 4.55,
} as const;

export type PieceType = keyof typeof PIECE_HEIGHT;
export type Side = 'white' | 'black';

/**
 * Board coordinates -> world position of a square's centre.
 * file 0..7 = a..h, rank 0..7 = 1..8. White's back rank is rank 0 at -Z.
 */
/**
 * The file axis runs from +x to -x, and that sign is deliberate.
 *
 * Ranks increase with z, so White's back rank sits at -z and the play camera stands
 * behind it looking toward +z. In a right-handed frame, facing +z puts screen-right at
 * -x. Chess convention puts a1 in the player's near-LEFT corner, so the a-file must land
 * at +x.
 *
 * With `x = (file - 3.5) * SQUARE` it landed at -x instead, and the whole board rendered
 * mirrored: a1 in the near-RIGHT corner, the carved kerb inscription reading H G F E D C
 * B A left to right, and every square named off it reversed against the move list. Square
 * COLOURS were right throughout — a1 dark, h1 light — because `isLightSquare` is a pure
 * function of (file + rank) and never saw the world. It was purely handedness, which is
 * why nothing caught it until a critic projected the files and read their x back.
 */
export function squareCentre(file: number, rank: number): { x: number; z: number } {
  return {
    x: (3.5 - file) * SQUARE,
    z: (rank - 3.5) * SQUARE,
  };
}

/** Inverse of squareCentre — nearest square to a world point. */
export function squareAt(x: number, z: number): { file: number; rank: number } {
  return {
    // Must invert squareCentre exactly, including the file axis's sign.
    file: Math.round(3.5 - x / SQUARE),
    rank: Math.round(z / SQUARE + 3.5),
  };
}

/** Light-side squares are those where (file + rank) is odd, matching a1 = dark. */
export function isLightSquare(file: number, rank: number): boolean {
  return (file + rank) % 2 === 1;
}

/** Render target — 2.39:1, the anamorphic ratio the reference shots are framed for. */
export const RENDER = {
  width: 1920,
  height: 804,
  aspect: 1920 / 804,
} as const;

/** Colour anchors for the whole scene. Everything warm/cool derives from these. */
export const PALETTE = {
  /** Brightest firelight. */
  fireCore: 0xffb765,
  /** Mid firelight falling off. */
  fireMid: 0xc8863f,
  /** Deep firelight at the edge of a pool. */
  fireDeep: 0x5a3418,
  /** The cold fill in shadow — never neutral, always slightly blue. */
  shadowFill: 0x2a3340,
  /** Base stone albedo before weathering. */
  stoneLight: 0x8d8478,
  stoneDark: 0x4a453f,
  /** Freshly broken stone — lighter and rawer than any weathered face. */
  stoneFresh: 0xb0a693,
} as const;
