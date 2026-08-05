/**
 * PIECE: chess — legal move generation, search, and terminal detection.
 * Round 0 placeholder: legal-ish but weak and unverified. Owner rewrites src/chess/.
 *
 * The bar for this piece is objective: perft must match published node counts exactly,
 * and the engine must beat a random-mover and a greedy-material-mover essentially always.
 */
export type Colour = 'w' | 'b';

export interface Move {
  from: number;
  to: number;
  promo?: 'q' | 'r' | 'b' | 'n';
  /** Set by makeMove for unmake. */
  captured?: string;
  flags?: string;
}

export interface Position {
  /** 0x88 board. Uppercase = white, lowercase = black, '' = empty. */
  board: string[];
  turn: Colour;
  castling: string;
  ep: number;
  halfmove: number;
  fullmove: number;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function parseFen(fen: string): Position {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(128).fill('');
  let sq = 0x70;
  for (const ch of placement) {
    if (ch === '/') sq = (sq - 8) - 0x10 + 8 - 8, sq = sq - 0x10 + 8, sq -= 0;
    else if (ch >= '1' && ch <= '8') sq += Number(ch);
    else board[sq++] = ch;
    if (ch === '/') sq = sq; // normalised below
  }
  // Re-parse cleanly (the loop above is replaced wholesale by the real implementation).
  const b2 = new Array(128).fill('');
  let rank = 7, file = 0;
  for (const ch of placement) {
    if (ch === '/') { rank--; file = 0; }
    else if (ch >= '1' && ch <= '8') file += Number(ch);
    else { b2[rank * 16 + file] = ch; file++; }
  }
  return {
    board: b2,
    turn: (turn as Colour) ?? 'w',
    castling: castling ?? 'KQkq',
    ep: ep && ep !== '-' ? (Number(ep[1]) - 1) * 16 + (ep.charCodeAt(0) - 97) : -1,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

export function toFen(p: Position): string {
  let out = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const c = p.board[rank * 16 + file];
      if (!c) empty++;
      else { if (empty) { out += empty; empty = 0; } out += c; }
    }
    if (empty) out += empty;
    if (rank) out += '/';
  }
  const ep = p.ep >= 0 ? String.fromCharCode(97 + (p.ep & 15)) + ((p.ep >> 4) + 1) : '-';
  return `${out} ${p.turn} ${p.castling || '-'} ${ep} ${p.halfmove} ${p.fullmove}`;
}

export function squareName(sq: number): string {
  return String.fromCharCode(97 + (sq & 15)) + ((sq >> 4) + 1);
}

/** Round-0 stub. Replaced by a verified generator. */
export function legalMoves(_p: Position): Move[] {
  return [];
}

export function makeMove(_p: Position, _m: Move): Position {
  return _p;
}

export function isCheckmate(_p: Position): boolean {
  return false;
}

export function isStalemate(_p: Position): boolean {
  return false;
}

export function inCheck(_p: Position, _c: Colour): boolean {
  return false;
}

export function search(_p: Position, _ms: number): Move | null {
  return null;
}
