/**
 * PIECE: chess — legal move generation, search, terminal detection, notation.
 *
 * This is the whole public surface. Everything below is deterministic: no Math.random,
 * no Date.now, no performance.now, nowhere in src/chess/**. The search is bounded by an
 * explicit NODE budget rather than by elapsed time, so `search(pos, { maxNodes })` returns
 * the same move on a fast machine and a slow one — which is what lets the capture harness
 * re-render a game and get identical pixels.
 *
 * Squares are 0x88 numbers: `sq = rank * 16 + file`, file 0..7 = a..h, rank 0..7 = 1..8.
 * Split them for the scene with `file = sq & 15`, `rank = sq >> 4`, which is exactly what
 * `squareCentre(file, rank)` in src/core/constants.ts wants.
 *
 * ── conventions worth knowing ────────────────────────────────────────────────────────
 * `GameState.result` values are named for the side that was CHECKMATED:
 *   'checkmate-white'  = White's king is mated, Black won.
 *   'checkmate-black'  = Black's king is mated, White won.
 * `Engine.matedSide()` and `Engine.winner()` say the same thing without the ambiguity —
 * prefer those.
 *
 * Verified by tools/perft.mjs against the published perft values for the five standard
 * positions, plus a self-play match against a random mover and a greedy material mover.
 */
import type { PieceType, Side } from '../core/constants';
import {
  BLACK, Board, F_CAPTURE, F_CASTLE, F_DOUBLE, F_EP, F_PROMO, PIECE_CHAR, TYPE_CHAR,
  WHITE, colourOf, fileOf, mvCaptured, mvFlags, mvFrom, mvPromo, mvTo, rankOf, squareName,
  typeOf,
} from './board';
import { MATE, MATE_IN_MAX, sharedSearcher } from './search';
import { lineToSan, moveToSan, moveToUci, sanToMove } from './san';
import { perft as perftCount, perftDivide } from './perft';
import { materialBalance } from './eval';
import type {
  Colour, DemoChecker, DemoEscape, DemoGame, DemoMove, Move, Position, SearchOptions,
  SearchResult,
} from './types';

export type {
  Colour, DemoChecker, DemoEscape, DemoGame, DemoMove, DemoSquare, Move, Position,
  SearchOptions, SearchResult,
} from './types';
export { FLAG_LETTERS } from './types';
export { Board, squareName, squareFromName } from './board';
export { MATE, MATE_IN_MAX } from './search';
export { PERFT_SUITE } from './perft';
export { evaluate, materialBalance } from './eval';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Default node budget. Roughly a tenth of a second of thinking on a modern machine. */
export const DEFAULT_NODES = 120_000;
export const DEFAULT_DEPTH = 64;

const TYPE_NAME: PieceType[] = [
  'pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king',
];

// --- Position <-> Board ---------------------------------------------------------------

export function parseFen(fen: string): Position {
  return boardToPosition(new Board(fen));
}

export function toFen(p: Position): string {
  return positionToBoard(p).fen();
}

export function boardToPosition(b: Board): Position {
  const board: string[] = new Array(128).fill('');
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const code = b.sq[s];
    if (code) board[s] = PIECE_CHAR[code];
  }
  let castling = '';
  if (b.castling & 1) castling += 'K';
  if (b.castling & 2) castling += 'Q';
  if (b.castling & 4) castling += 'k';
  if (b.castling & 8) castling += 'q';
  return {
    board,
    turn: b.turn === WHITE ? 'w' : 'b',
    castling,
    ep: b.ep,
    halfmove: b.halfmove,
    fullmove: b.fullmove,
  };
}

export function positionToBoard(p: Position): Board {
  const raw = p as unknown;
  if (typeof raw === 'string') return new Board(raw);
  let placement = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const ch = p.board[(rank << 4) | file] ?? '';
      if (!ch) { empty++; continue; }
      if (empty) { placement += empty; empty = 0; }
      placement += ch;
    }
    if (empty) placement += empty;
    if (rank) placement += '/';
  }
  const ep = p.ep >= 0 && (p.ep & 0x88) === 0
    ? String.fromCharCode(97 + fileOf(p.ep)) + (rankOf(p.ep) + 1)
    : '-';
  const fen = `${placement} ${p.turn ?? 'w'} ${p.castling || '-'} ${ep} ${p.halfmove ?? 0} ${p.fullmove ?? 1}`;
  return new Board(fen);
}

/** Accepts a FEN string, a Position, or a Board and always hands back a Board. */
function toBoard(src: Position | Board | string): Board {
  if (typeof src === 'string') return new Board(src);
  if (src instanceof Board) return src;
  return positionToBoard(src);
}

// --- packed move <-> public Move --------------------------------------------------------

/** Decorate a packed move with everything the scene and the HUD want to read. */
export function decodeMove(b: Board, m: number, legal?: number[]): Move {
  const from = mvFrom(m);
  const to = mvTo(m);
  const flags = mvFlags(m);
  const promo = mvPromo(m);
  const captured = mvCaptured(m);
  const piece = b.sq[from];

  let letters = '';
  if (flags & F_EP) letters += 'e';
  if (flags & F_CAPTURE) letters += 'c';
  if (flags & F_PROMO) letters += 'p';
  if (flags & F_DOUBLE) letters += 'b';
  if (flags & F_CASTLE) letters += to > from ? 'k' : 'q';
  if (!letters) letters = 'n';

  const move: Move = {
    from,
    to,
    flags: letters,
    piece: PIECE_CHAR[piece],
    uci: moveToUci(m),
    san: moveToSan(b, m, legal),
  };
  if (promo) move.promo = TYPE_CHAR[promo] as 'q' | 'r' | 'b' | 'n';
  if (captured) {
    move.captured = PIECE_CHAR[captured];
    move.capturedOn = (flags & F_EP)
      ? (colourOf(piece) === WHITE ? to - 16 : to + 16)
      : to;
  }
  return move;
}

/** Find the packed move in `b` matching a public Move, a SAN string, or a UCI string. */
export function encodePublicMove(b: Board, m: Move | string): number {
  if (typeof m === 'string') return sanToMove(b, m);
  const legal = b.legalMoveList();
  const promoType = m.promo ? TYPE_CHAR.indexOf(m.promo) : 0;
  for (let i = 0; i < legal.length; i++) {
    const c = legal[i];
    if (mvFrom(c) !== m.from || mvTo(c) !== m.to) continue;
    const p = mvPromo(c);
    if (promoType) { if (p !== promoType) continue; }
    else if (p && p !== 5) continue; // a bare promotion means queen
    return c;
  }
  return 0;
}

// --- the struct-shaped API ---------------------------------------------------------------

/** Every legal move, each carrying its own SAN and UCI text. */
export function legalMoves(p: Position | Board | string): Move[] {
  const b = toBoard(p);
  const packed = b.legalMoveList();
  const out: Move[] = [];
  for (let i = 0; i < packed.length; i++) out.push(decodeMove(b, packed[i], packed));
  return out;
}

/** Legal moves as SAN strings only. */
export function legalMovesSan(p: Position | Board | string): string[] {
  const b = toBoard(p);
  const packed = b.legalMoveList();
  const out: string[] = [];
  for (let i = 0; i < packed.length; i++) out.push(moveToSan(b, packed[i], packed));
  return out;
}

export function moveIsLegal(p: Position | Board | string, m: Move | string): boolean {
  return encodePublicMove(toBoard(p), m) !== 0;
}

/**
 * Apply a move and return the NEW position. The input is never mutated.
 * An illegal move leaves the position unchanged (check first with `moveIsLegal`).
 */
export function makeMove(p: Position, m: Move | string): Position {
  const b = positionToBoard(p);
  const packed = encodePublicMove(b, m);
  if (!packed) return boardToPosition(b);
  b.make(packed);
  return boardToPosition(b);
}

export function inCheck(p: Position | Board | string, c?: Colour): boolean {
  const b = toBoard(p);
  if (c === undefined) return b.inCheck();
  return b.inCheck(c === 'w' ? WHITE : BLACK);
}

export function isCheckmate(p: Position | Board | string): boolean {
  return toBoard(p).isCheckmate();
}

export function isStalemate(p: Position | Board | string): boolean {
  return toBoard(p).isStalemate();
}

export function isInsufficientMaterial(p: Position | Board | string): boolean {
  return toBoard(p).isInsufficientMaterial();
}

export function isFiftyMove(p: Position | Board | string): boolean {
  return toBoard(p).isFiftyMove();
}

/** 0x88 squares of the pieces currently checking the side to move. */
export function checkers(p: Position | Board | string): number[] {
  return toBoard(p).checkers();
}

export function perft(p: Position | Board | string, depth: number, bulk = false): number {
  return perftCount(toBoard(p), depth, bulk);
}

export function divide(p: Position | Board | string, depth: number) {
  return perftDivide(toBoard(p), depth);
}

// --- search ------------------------------------------------------------------------------

/**
 * Search a position. Bounded by `maxNodes` — never by the clock.
 *
 * The result IS a Move (from/to/promo are spread onto it) as well as carrying `.move`,
 * `.score`, `.pv` and friends, so both of these work:
 *   const best = search(pos, { maxNodes: 200_000 });
 *   const next = makeMove(pos, best);          // uses from/to/promo
 *   hud.textContent = best.san + ' ' + best.score;
 *
 * A bare number is read as a node budget, not milliseconds.
 * Returns null when there is no legal move (the game is already over).
 */
export function search(
  p: Position | Board | string,
  opts: SearchOptions | number = DEFAULT_NODES,
): SearchResult | null {
  const o: SearchOptions = typeof opts === 'number' ? { maxNodes: opts } : (opts ?? {});
  const b = toBoard(p);
  const maxNodes = Math.max(2048, o.maxNodes ?? DEFAULT_NODES);
  const maxDepth = Math.max(1, o.maxDepth ?? DEFAULT_DEPTH);

  const stats = sharedSearcher().run(b, maxDepth, maxNodes);
  if (!stats.pv.length) return null;

  const legal = b.legalMoveList();
  if (!legal.length) return null;
  const packed = legal.indexOf(stats.pv[0]) >= 0 ? stats.pv[0] : legal[0];

  const move = decodeMove(b, packed, legal);
  const sanPv = lineToSan(b, stats.pv);
  const pv: Move[] = [];
  {
    let made = 0;
    for (let i = 0; i < stats.pv.length; i++) {
      const list = b.legalMoveList();
      if (list.indexOf(stats.pv[i]) < 0) break;
      pv.push(decodeMove(b, stats.pv[i], list));
      b.make(stats.pv[i]);
      made++;
    }
    while (made-- > 0) b.unmake();
  }

  let mate: number | null = null;
  if (Math.abs(stats.score) >= MATE_IN_MAX) {
    const pliesToMate = MATE - Math.abs(stats.score);
    mate = stats.score > 0 ? Math.ceil(pliesToMate / 2) : -Math.ceil(pliesToMate / 2);
  }

  return {
    ...move,
    move,
    score: stats.score,
    mate,
    depth: stats.depth,
    nodes: stats.nodes,
    pv,
    sanPv,
  };
}

// --- the stateful engine the game flow drives --------------------------------------------

export type GameResult =
  | 'playing'
  | 'checkmate-white'
  | 'checkmate-black'
  | 'stalemate'
  | 'draw';

export interface EngineStatus {
  fen: string;
  turn: Side;
  inCheck: boolean;
  result: GameResult;
  /** Side that got mated, if any. Unambiguous where `result` is not. */
  matedSide: Side | null;
  winner: Side | null;
  /** Why the game is a draw, when it is one. */
  drawReason: 'stalemate' | 'fifty-move' | 'threefold' | 'insufficient-material' | null;
  lastMove: string | null;
  moveNumber: number;
  halfmove: number;
}

/**
 * A whole game: move stack, repetition history, terminal detection, and a search that
 * knows about the moves already played.
 */
export class Engine {
  readonly board: Board;
  private played: number[] = [];
  private sans: string[] = [];

  constructor(fen: string = START_FEN) {
    this.board = new Board(fen);
  }

  reset(fen: string = START_FEN): void {
    this.board.setFen(fen);
    this.played.length = 0;
    this.sans.length = 0;
  }

  get fen(): string { return this.board.fen(); }
  get turn(): Colour { return this.board.turn === WHITE ? 'w' : 'b'; }
  get side(): Side { return this.board.turn === WHITE ? 'white' : 'black'; }
  get moveNumber(): number { return this.board.fullmove; }

  position(): Position { return boardToPosition(this.board); }

  moves(): Move[] {
    const packed = this.board.legalMoveList();
    const out: Move[] = [];
    for (let i = 0; i < packed.length; i++) out.push(decodeMove(this.board, packed[i], packed));
    return out;
  }

  movesSan(): string[] { return legalMovesSan(this.board); }

  /** Apply a move given as a Move, SAN, or UCI. Returns the applied move, or null. */
  move(m: Move | string): Move | null {
    const packed = encodePublicMove(this.board, m);
    if (!packed) return null;
    const legal = this.board.legalMoveList();
    const decoded = decodeMove(this.board, packed, legal);
    this.board.make(packed);
    this.played.push(packed);
    this.sans.push(decoded.san ?? '');
    return decoded;
  }

  undo(): boolean {
    if (!this.played.length) return false;
    this.board.unmake();
    this.played.pop();
    this.sans.pop();
    return true;
  }

  inCheck(): boolean { return this.board.inCheck(); }
  isCheckmate(): boolean { return this.board.isCheckmate(); }
  isStalemate(): boolean { return this.board.isStalemate(); }
  isThreefold(): boolean { return this.board.isThreefold(); }
  isFiftyMove(): boolean { return this.board.isFiftyMove(); }
  isInsufficientMaterial(): boolean { return this.board.isInsufficientMaterial(); }

  isDraw(): boolean {
    return this.isStalemate() || this.isThreefold() || this.isFiftyMove() ||
      this.isInsufficientMaterial();
  }

  isGameOver(): boolean { return this.isCheckmate() || this.isDraw(); }

  /** 0x88 squares of the pieces giving check right now. */
  checkers(): number[] { return this.board.checkers(); }

  kingSquare(side: Side = this.side): number {
    return this.board.kingSq[side === 'white' ? WHITE : BLACK];
  }

  matedSide(): Side | null {
    if (!this.isCheckmate()) return null;
    return this.board.turn === WHITE ? 'white' : 'black';
  }

  winner(): Side | null {
    const mated = this.matedSide();
    return mated === null ? null : mated === 'white' ? 'black' : 'white';
  }

  result(): GameResult {
    if (this.isCheckmate()) {
      return this.board.turn === WHITE ? 'checkmate-white' : 'checkmate-black';
    }
    if (this.isStalemate()) return 'stalemate';
    if (this.isThreefold() || this.isFiftyMove() || this.isInsufficientMaterial()) return 'draw';
    return 'playing';
  }

  status(): EngineStatus {
    const mated = this.matedSide();
    let drawReason: EngineStatus['drawReason'] = null;
    if (!mated) {
      if (this.isStalemate()) drawReason = 'stalemate';
      else if (this.isThreefold()) drawReason = 'threefold';
      else if (this.isFiftyMove()) drawReason = 'fifty-move';
      else if (this.isInsufficientMaterial()) drawReason = 'insufficient-material';
    }
    return {
      fen: this.fen,
      turn: this.side,
      inCheck: this.inCheck(),
      result: this.result(),
      matedSide: mated,
      winner: this.winner(),
      drawReason,
      lastMove: this.sans.length ? this.sans[this.sans.length - 1] : null,
      moveNumber: this.board.fullmove,
      halfmove: this.board.halfmove,
    };
  }

  history(): string[] { return this.sans.slice(); }

  /** Score in centipawns from White's point of view. */
  materialBalance(): number { return materialBalance(this.board); }

  /** Search from the current position, with the game's repetition history in scope. */
  search(opts: SearchOptions | number = DEFAULT_NODES): SearchResult | null {
    return search(this.board, opts);
  }

  /** Search and play the result in one step. */
  playBest(opts: SearchOptions | number = DEFAULT_NODES): Move | null {
    const r = this.search(opts);
    if (!r) return null;
    return this.move(r.move);
  }
}

// --- the demo game ------------------------------------------------------------------------

/** SAN of a short, real, forced-looking game that ends in a genuine mate on e8. */
const DEMO_SAN = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];

let demoCache: DemoGame | null = null;

/**
 * A short legal game ending in a real checkmate, for the king-surrender shot.
 *
 * Scholar's mate: the black king is mated on e8 with White's queen on f7 backed by the
 * bishop on c4. That is the position the shot wants — the king is on e8 (file 4, rank 7,
 * exactly where `king-surrender` is aimed), the checking piece is adjacent and in frame,
 * and every escape square is visibly blocked by Black's own pieces or covered by the
 * queen. Every move is verified legal at build time and the final position is verified to
 * be checkmate; if any of that ever fails, `verified` comes back false rather than
 * quietly handing the scene a fake mate.
 */
export function buildDemoGame(): DemoGame {
  if (demoCache) return demoCache;

  const b = new Board(START_FEN);
  const moves: DemoMove[] = [];
  let verified = true;

  for (let i = 0; i < DEMO_SAN.length; i++) {
    const legal = b.legalMoveList();
    const packed = sanToMove(b, DEMO_SAN[i]);
    if (!packed || legal.indexOf(packed) < 0) { verified = false; break; }

    const from = mvFrom(packed);
    const to = mvTo(packed);
    const flags = mvFlags(packed);
    const promo = mvPromo(packed);
    const capturedCode = mvCaptured(packed);
    const pieceCode = b.sq[from];
    const side: Side = colourOf(pieceCode) === WHITE ? 'white' : 'black';
    const san = moveToSan(b, packed, legal);

    let capture: DemoMove['capture'] = null;
    if (capturedCode) {
      const on = (flags & F_EP)
        ? (side === 'white' ? to - 16 : to + 16)
        : to;
      capture = {
        piece: TYPE_NAME[typeOf(capturedCode)],
        side: colourOf(capturedCode) === WHITE ? 'white' : 'black',
        file: fileOf(on),
        rank: rankOf(on),
        enPassant: (flags & F_EP) !== 0,
      };
    }

    let castle: DemoMove['castle'] = null;
    if (flags & F_CASTLE) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      castle = {
        side: to > from ? 'king' : 'queen',
        rookFromFile: fileOf(rookFrom),
        rookFromRank: rankOf(rookFrom),
        rookToFile: fileOf(rookTo),
        rookToRank: rankOf(rookTo),
      };
    }

    b.make(packed);
    const check = b.inCheck();
    const mate = check && !b.hasLegalMove();

    moves.push({
      ply: i,
      moveNumber: (i >> 1) + 1,
      san,
      uci: moveToUci(packed),
      from,
      to,
      fromName: squareName(from),
      toName: squareName(to),
      fromFile: fileOf(from),
      fromRank: rankOf(from),
      toFile: fileOf(to),
      toRank: rankOf(to),
      side,
      piece: TYPE_NAME[typeOf(pieceCode)],
      capture,
      castle,
      promotion: promo ? TYPE_NAME[promo] : null,
      check,
      mate,
      fenAfter: b.fen(),
    });
  }

  const isMate = verified && b.isCheckmate();
  if (!isMate) verified = false;

  const matedColour = b.turn;
  const matedSide: Side = matedColour === WHITE ? 'white' : 'black';
  const kingSq = b.kingSq[matedColour];

  const checkerList: DemoChecker[] = b.checkers().map((s) => ({
    file: fileOf(s),
    rank: rankOf(s),
    name: squareName(s),
    piece: TYPE_NAME[typeOf(b.sq[s])],
    side: colourOf(b.sq[s]) === WHITE ? 'white' : 'black',
  }));

  const blockedEscapes: DemoEscape[] = [];
  if (kingSq >= 0) {
    const deltas = [-17, -16, -15, -1, 1, 15, 16, 17];
    for (let i = 0; i < deltas.length; i++) {
      const s = kingSq + deltas[i];
      if (s & 0x88) continue;
      const occupant = b.sq[s];
      if (occupant && colourOf(occupant) === matedColour) {
        blockedEscapes.push({ file: fileOf(s), rank: rankOf(s), name: squareName(s), reason: 'occupied' });
        continue;
      }
      // Would the king be in check standing there? Lift the king off first so it does not
      // shadow the attacking ray behind itself.
      const savedTarget = b.sq[s];
      const savedKing = b.sq[kingSq];
      b.sq[kingSq] = 0;
      b.sq[s] = savedKing;
      const attacked = b.attacked(s, matedColour ^ 1);
      b.sq[s] = savedTarget;
      b.sq[kingSq] = savedKing;
      if (attacked) {
        blockedEscapes.push({ file: fileOf(s), rank: rankOf(s), name: squareName(s), reason: 'attacked' });
      }
    }
  }

  demoCache = {
    name: "Scholar's mate",
    startFen: START_FEN,
    moves,
    finalFen: b.fen(),
    matedSide,
    matingSide: matedSide === 'white' ? 'black' : 'white',
    king: { file: fileOf(kingSq), rank: rankOf(kingSq), name: squareName(kingSq) },
    checkers: checkerList,
    blockedEscapes,
    verified,
  };
  return demoCache;
}

/** FEN of the checkmate the demo game arrives at — handy for `--fen=` captures. */
export function demoMateFen(): string {
  return buildDemoGame().finalFen;
}
