/**
 * PIECE: chess — public types.
 *
 * These are the interchange types the rest of the app sees. The engine's hot path uses a
 * packed integer representation internally (see board.ts); these structs exist so the game
 * layer and the HUD have something readable to hold on to.
 *
 * Square numbers are 0x88: `sq = rank * 16 + file`, file 0..7 = a..h, rank 0..7 = 1..8.
 * That matches `squareCentre(file, rank)` in src/core/constants.ts once you split it:
 *   file = sq & 15,  rank = sq >> 4.
 */
import type { PieceType, Side } from '../core/constants';

export type Colour = 'w' | 'b';

/** chess.js-compatible flag letters, concatenated. */
export const FLAG_LETTERS = {
  NORMAL: 'n',
  CAPTURE: 'c',
  BIG_PAWN: 'b',
  EP_CAPTURE: 'e',
  PROMOTION: 'p',
  KSIDE_CASTLE: 'k',
  QSIDE_CASTLE: 'q',
} as const;

export interface Move {
  /** 0x88 origin square. */
  from: number;
  /** 0x88 destination square. */
  to: number;
  /** Promotion piece, if any. */
  promo?: 'q' | 'r' | 'b' | 'n';
  /** FEN letter of the captured piece, with case (so 'p' is a black pawn). */
  captured?: string;
  /** Concatenated flag letters — see FLAG_LETTERS. */
  flags?: string;
  /** FEN letter of the moving piece, with case. */
  piece?: string;
  /** Standard algebraic notation, including '+'/'#'. Populated by legalMoves()/Engine. */
  san?: string;
  /** Long algebraic ("e2e4", "e7e8q"). */
  uci?: string;
  /**
   * Square the captured piece actually stood on. Same as `to` except for en passant,
   * where the captured pawn is one rank behind `to`.
   */
  capturedOn?: number;
}

export interface Position {
  /** 0x88 board, 128 entries. Uppercase = white, lowercase = black, '' = empty. */
  board: string[];
  turn: Colour;
  /** Castling rights as FEN letters, e.g. "KQkq", or "" for none. */
  castling: string;
  /** 0x88 en-passant target square, or -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
}

export interface SearchOptions {
  /** Hard node budget. The search is bounded by this, never by the wall clock. */
  maxNodes?: number;
  /** Ceiling on iterative-deepening depth. */
  maxDepth?: number;
  /**
   * Zobrist keys of positions already seen in the game (oldest first), used so the search
   * understands repetition. Engine.search() fills this in for you.
   */
  history?: Int32Array | number[];
}

export interface SearchResult extends Move {
  /** The chosen move, also spread onto this object so `makeMove(pos, search(pos))` works. */
  move: Move;
  /** Centipawns, from the side to move's point of view. */
  score: number;
  /** Plies to mate, signed (+ = side to move mates). null when the score is not a mate. */
  mate: number | null;
  /** Deepest fully completed iteration. */
  depth: number;
  /** Nodes visited, including quiescence. */
  nodes: number;
  /** Principal variation. */
  pv: Move[];
  /** Principal variation in SAN. */
  sanPv: string[];
}

/** One ply of a scripted demo game, in terms the scene can consume directly. */
export interface DemoMove {
  ply: number;
  /** 1-based move number as printed in a score sheet. */
  moveNumber: number;
  san: string;
  uci: string;
  from: number;
  to: number;
  fromName: string;
  toName: string;
  /** Board coordinates for squareCentre(file, rank). */
  fromFile: number;
  fromRank: number;
  toFile: number;
  toRank: number;
  side: Side;
  piece: PieceType;
  /** Set when this move takes a piece off the board. */
  capture: {
    piece: PieceType;
    side: Side;
    /** Square the victim stood on — differs from the mover's destination on en passant. */
    file: number;
    rank: number;
    enPassant: boolean;
  } | null;
  /** Rook's journey when this move is a castle. */
  castle: {
    side: 'king' | 'queen';
    rookFromFile: number;
    rookFromRank: number;
    rookToFile: number;
    rookToRank: number;
  } | null;
  promotion: PieceType | null;
  check: boolean;
  mate: boolean;
  fenAfter: string;
}

export interface DemoSquare {
  file: number;
  rank: number;
  name: string;
}

export interface DemoChecker extends DemoSquare {
  piece: PieceType;
  side: Side;
}

export interface DemoEscape extends DemoSquare {
  /** Why the king cannot go there. */
  reason: 'attacked' | 'occupied';
}

export interface DemoGame {
  name: string;
  startFen: string;
  moves: DemoMove[];
  finalFen: string;
  /** The side that has been checkmated — the king that drops its blade. */
  matedSide: Side;
  matingSide: Side;
  /** Where the mated king stands. */
  king: DemoSquare;
  /** Pieces delivering the mate. Frame these and the mate is legible. */
  checkers: DemoChecker[];
  /** Every square adjacent to the king, and why it is not an escape. */
  blockedEscapes: DemoEscape[];
  /** True only if every move was verified legal and the final position is a real mate. */
  verified: boolean;
}
