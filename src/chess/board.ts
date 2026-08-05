/**
 * PIECE: chess — board representation, move generation, make/unmake, Zobrist hashing.
 *
 * 0x88 mailbox. `sq = rank * 16 + file`; a square is off the board iff `sq & 0x88`.
 * Pieces are small integers: type in bits 0..2, colour in bit 3.
 *
 * There is exactly ONE move generator in this piece (Board.genPseudo / Board.genLegal).
 * The struct-shaped public API in index.ts converts to and from this class, so there is no
 * second implementation that can drift out of agreement with the one perft verifies.
 *
 * Determinism: the Zobrist keys come from a fixed xorshift seeded with a constant. No
 * Math.random, no clock, anywhere in this piece.
 */

// --- piece codes ---------------------------------------------------------------------

export const WHITE = 0;
export const BLACK = 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WP = 1, WN = 2, WB = 3, WR = 4, WQ = 5, WK = 6;
export const BP = 9, BN = 10, BB = 11, BR = 12, BQ = 13, BK = 14;

export const typeOf = (code: number): number => code & 7;
export const colourOf = (code: number): number => code >> 3;
export const makeCode = (type: number, colour: number): number => type | (colour << 3);

export const fileOf = (sq: number): number => sq & 15;
export const rankOf = (sq: number): number => sq >> 4;
export const sq0x88 = (file: number, rank: number): number => (rank << 4) | file;
export const onBoard = (sq: number): boolean => (sq & 0x88) === 0;

/** code -> FEN letter. Index 0 and the gaps are ''. */
export const PIECE_CHAR: string[] = new Array(16).fill('');
PIECE_CHAR[WP] = 'P'; PIECE_CHAR[WN] = 'N'; PIECE_CHAR[WB] = 'B';
PIECE_CHAR[WR] = 'R'; PIECE_CHAR[WQ] = 'Q'; PIECE_CHAR[WK] = 'K';
PIECE_CHAR[BP] = 'p'; PIECE_CHAR[BN] = 'n'; PIECE_CHAR[BB] = 'b';
PIECE_CHAR[BR] = 'r'; PIECE_CHAR[BQ] = 'q'; PIECE_CHAR[BK] = 'k';

export const CHAR_CODE: Record<string, number> = {
  P: WP, N: WN, B: WB, R: WR, Q: WQ, K: WK,
  p: BP, n: BN, b: BB, r: BR, q: BQ, k: BK,
};

/** type -> lowercase letter used in UCI promotions and SAN. */
export const TYPE_CHAR = ['', 'p', 'n', 'b', 'r', 'q', 'k'];

// --- move packing --------------------------------------------------------------------
// from: bits 0..7   to: bits 8..15   promo type: 16..19   captured code: 20..23
// flags: 24..28
export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_CASTLE = 4;
export const F_DOUBLE = 8;
export const F_PROMO = 16;

export const encodeMove = (
  from: number, to: number, promo: number, captured: number, flags: number,
): number => from | (to << 8) | (promo << 16) | (captured << 20) | (flags << 24);

export const mvFrom = (m: number): number => m & 0xff;
export const mvTo = (m: number): number => (m >> 8) & 0xff;
export const mvPromo = (m: number): number => (m >> 16) & 0xf;
export const mvCaptured = (m: number): number => (m >> 20) & 0xf;
export const mvFlags = (m: number): number => (m >> 24) & 0x1f;

// --- geometry ------------------------------------------------------------------------

export const KNIGHT_D = [-33, -31, -18, -14, 14, 18, 31, 33];
export const BISHOP_D = [-17, -15, 15, 17];
export const ROOK_D = [-16, -1, 1, 16];
export const KING_D = [-17, -16, -15, -1, 1, 15, 16, 17];

/** Castling rights removed when a piece leaves or lands on a square. */
const CASTLE_MASK = new Int32Array(128).fill(15);
CASTLE_MASK[0x04] = 12; // e1: white loses both
CASTLE_MASK[0x07] = 14; // h1: white loses kingside
CASTLE_MASK[0x00] = 13; // a1: white loses queenside
CASTLE_MASK[0x74] = 3;  // e8
CASTLE_MASK[0x77] = 11; // h8
CASTLE_MASK[0x70] = 7;  // a8

export const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

// --- Zobrist -------------------------------------------------------------------------

let zseed = 0x1a2b3c4d;
function rnd32(): number {
  // xorshift32 — fixed seed, so the keys are identical on every run and every machine.
  zseed ^= zseed << 13; zseed |= 0;
  zseed ^= zseed >>> 17;
  zseed ^= zseed << 5; zseed |= 0;
  return zseed | 0;
}

const Z_PIECE_LO = new Int32Array(16 * 128);
const Z_PIECE_HI = new Int32Array(16 * 128);
const Z_CASTLE_LO = new Int32Array(16);
const Z_CASTLE_HI = new Int32Array(16);
const Z_EP_LO = new Int32Array(8);
const Z_EP_HI = new Int32Array(8);
let Z_SIDE_LO = 0;
let Z_SIDE_HI = 0;
(function initZobrist() {
  for (let i = 0; i < 16 * 128; i++) { Z_PIECE_LO[i] = rnd32(); Z_PIECE_HI[i] = rnd32(); }
  for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = rnd32(); Z_CASTLE_HI[i] = rnd32(); }
  for (let i = 0; i < 8; i++) { Z_EP_LO[i] = rnd32(); Z_EP_HI[i] = rnd32(); }
  Z_SIDE_LO = rnd32(); Z_SIDE_HI = rnd32();
})();

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const MAX_PLY = 2048;
/** Undo record stride in the flat stack. */
const ST = 8;

export class Board {
  readonly sq = new Int8Array(128);
  turn = WHITE;
  castling = 0;
  /** 0x88 en-passant target square, -1 when none. */
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  readonly kingSq = new Int32Array(2);
  hashLo = 0;
  hashHi = 0;
  /** File currently XORed into the hash for en passant, or -1. */
  private epHashFile = -1;

  private st = new Int32Array(ST * MAX_PLY);
  private sp = 0;

  /** Zobrist of every position reached, index 0 = the position this Board started from. */
  readonly repLo: number[] = [];
  readonly repHi: number[] = [];
  /** Plies played on this Board since construction/reset. */
  ply = 0;

  constructor(fen: string = START_FEN) {
    this.setFen(fen);
  }

  clone(): Board {
    const b = new Board(this.fen());
    return b;
  }

  // --- FEN ---------------------------------------------------------------------------

  setFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    const placement = parts[0] ?? '';
    this.sq.fill(0);
    let rank = 7;
    let file = 0;
    for (let i = 0; i < placement.length; i++) {
      const ch = placement[i];
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '8') { file += ch.charCodeAt(0) - 48; continue; }
      const code = CHAR_CODE[ch];
      if (code !== undefined && rank >= 0 && rank < 8 && file < 8) {
        this.sq[sq0x88(file, rank)] = code;
      }
      file++;
    }
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    const c = parts[2] ?? '-';
    this.castling = 0;
    if (c.indexOf('K') >= 0) this.castling |= CASTLE_WK;
    if (c.indexOf('Q') >= 0) this.castling |= CASTLE_WQ;
    if (c.indexOf('k') >= 0) this.castling |= CASTLE_BK;
    if (c.indexOf('q') >= 0) this.castling |= CASTLE_BQ;
    const e = parts[3] ?? '-';
    this.ep = e && e !== '-' && e.length >= 2
      ? sq0x88(e.charCodeAt(0) - 97, e.charCodeAt(1) - 49)
      : -1;
    if (this.ep >= 0 && !onBoard(this.ep)) this.ep = -1;
    const hm = Number(parts[4]);
    this.halfmove = Number.isFinite(hm) ? hm : 0;
    const fm = Number(parts[5]);
    this.fullmove = Number.isFinite(fm) && fm > 0 ? fm : 1;

    this.kingSq[WHITE] = -1;
    this.kingSq[BLACK] = -1;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.sq[s];
      if (p && typeOf(p) === KING) this.kingSq[colourOf(p)] = s;
    }
    this.sp = 0;
    this.ply = 0;
    this.recomputeHash();
    this.repLo.length = 0;
    this.repHi.length = 0;
    this.repLo.push(this.hashLo);
    this.repHi.push(this.hashHi);
  }

  fen(): string {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.sq[sq0x88(file, rank)];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += PIECE_CHAR[p];
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    let c = '';
    if (this.castling & CASTLE_WK) c += 'K';
    if (this.castling & CASTLE_WQ) c += 'Q';
    if (this.castling & CASTLE_BK) c += 'k';
    if (this.castling & CASTLE_BQ) c += 'q';
    const ep = this.ep >= 0
      ? String.fromCharCode(97 + fileOf(this.ep)) + (rankOf(this.ep) + 1)
      : '-';
    return `${out} ${this.turn === WHITE ? 'w' : 'b'} ${c || '-'} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  // --- hashing -----------------------------------------------------------------------

  /**
   * The en-passant square only belongs in the hash when an enemy pawn could actually take,
   * otherwise two genuinely identical positions hash differently and repetition is missed.
   */
  private epHashableFile(): number {
    if (this.ep < 0) return -1;
    // The pawn that just double-pushed sits behind the ep square, from the mover's side.
    const pawnSq = rankOf(this.ep) === 2 ? this.ep + 16 : this.ep - 16;
    const them = rankOf(this.ep) === 2 ? BLACK : WHITE; // white pushed -> black may capture
    const enemyPawn = makeCode(PAWN, them);
    const l = pawnSq - 1;
    const r = pawnSq + 1;
    if (onBoard(l) && this.sq[l] === enemyPawn) return fileOf(this.ep);
    if (onBoard(r) && this.sq[r] === enemyPawn) return fileOf(this.ep);
    return -1;
  }

  recomputeHash(): void {
    let lo = 0, hi = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.sq[s];
      if (!p) continue;
      lo ^= Z_PIECE_LO[p * 128 + s];
      hi ^= Z_PIECE_HI[p * 128 + s];
    }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    if (this.turn === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    const f = this.epHashableFile();
    this.epHashFile = f;
    if (f >= 0) { lo ^= Z_EP_LO[f]; hi ^= Z_EP_HI[f]; }
    this.hashLo = lo | 0;
    this.hashHi = hi | 0;
  }

  // --- attacks -----------------------------------------------------------------------

  /** Is `s` attacked by any piece of colour `by`? */
  attacked(s: number, by: number): boolean {
    const b = this.sq;
    // pawns
    if (by === WHITE) {
      if (onBoard(s - 15) && b[s - 15] === WP) return true;
      if (onBoard(s - 17) && b[s - 17] === WP) return true;
    } else {
      if (onBoard(s + 15) && b[s + 15] === BP) return true;
      if (onBoard(s + 17) && b[s + 17] === BP) return true;
    }
    // knights
    const n = makeCode(KNIGHT, by);
    for (let i = 0; i < 8; i++) {
      const t = s + KNIGHT_D[i];
      if (onBoard(t) && b[t] === n) return true;
    }
    // king
    const k = makeCode(KING, by);
    for (let i = 0; i < 8; i++) {
      const t = s + KING_D[i];
      if (onBoard(t) && b[t] === k) return true;
    }
    // diagonal sliders
    const bq = makeCode(BISHOP, by);
    const q = makeCode(QUEEN, by);
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_D[i];
      for (let t = s + d; onBoard(t); t += d) {
        const p = b[t];
        if (p) { if (p === bq || p === q) return true; break; }
      }
    }
    // orthogonal sliders
    const r = makeCode(ROOK, by);
    for (let i = 0; i < 4; i++) {
      const d = ROOK_D[i];
      for (let t = s + d; onBoard(t); t += d) {
        const p = b[t];
        if (p) { if (p === r || p === q) return true; break; }
      }
    }
    return false;
  }

  inCheck(colour: number = this.turn): boolean {
    const k = this.kingSq[colour];
    if (k < 0) return false;
    return this.attacked(k, colour ^ 1);
  }

  /** 0x88 squares of every piece currently giving check to `colour`'s king. */
  checkers(colour: number = this.turn): number[] {
    const out: number[] = [];
    const k = this.kingSq[colour];
    if (k < 0) return out;
    const by = colour ^ 1;
    const b = this.sq;
    if (by === WHITE) {
      if (onBoard(k - 15) && b[k - 15] === WP) out.push(k - 15);
      if (onBoard(k - 17) && b[k - 17] === WP) out.push(k - 17);
    } else {
      if (onBoard(k + 15) && b[k + 15] === BP) out.push(k + 15);
      if (onBoard(k + 17) && b[k + 17] === BP) out.push(k + 17);
    }
    const n = makeCode(KNIGHT, by);
    for (let i = 0; i < 8; i++) {
      const t = k + KNIGHT_D[i];
      if (onBoard(t) && b[t] === n) out.push(t);
    }
    const bq = makeCode(BISHOP, by), q = makeCode(QUEEN, by), r = makeCode(ROOK, by);
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_D[i];
      for (let t = k + d; onBoard(t); t += d) {
        const p = b[t];
        if (p) { if (p === bq || p === q) out.push(t); break; }
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = ROOK_D[i];
      for (let t = k + d; onBoard(t); t += d) {
        const p = b[t];
        if (p) { if (p === r || p === q) out.push(t); break; }
      }
    }
    return out;
  }

  // --- move generation ---------------------------------------------------------------

  /**
   * Pseudo-legal moves for the side to move, appended to `out`.
   * When `capturesOnly`, generates captures, en passant and every promotion (quiet
   * promotions included — a queening move is never a quiet move in practice).
   */
  genPseudo(out: number[], capturesOnly = false): void {
    const b = this.sq;
    const us = this.turn;
    const them = us ^ 1;
    const pawnPush = us === WHITE ? 16 : -16;
    const startRank = us === WHITE ? 1 : 6;
    const promoRank = us === WHITE ? 7 : 0;

    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p || colourOf(p) !== us) continue;
      const t = typeOf(p);

      if (t === PAWN) {
        // captures (and en passant)
        for (let i = -1; i <= 1; i += 2) {
          const to = s + pawnPush + i;
          if (!onBoard(to)) continue;
          const victim = b[to];
          if (victim && colourOf(victim) === them) {
            if (rankOf(to) === promoRank) {
              out.push(encodeMove(s, to, QUEEN, victim, F_CAPTURE | F_PROMO));
              out.push(encodeMove(s, to, ROOK, victim, F_CAPTURE | F_PROMO));
              out.push(encodeMove(s, to, BISHOP, victim, F_CAPTURE | F_PROMO));
              out.push(encodeMove(s, to, KNIGHT, victim, F_CAPTURE | F_PROMO));
            } else {
              out.push(encodeMove(s, to, 0, victim, F_CAPTURE));
            }
          } else if (!victim && to === this.ep) {
            out.push(encodeMove(s, to, 0, makeCode(PAWN, them), F_CAPTURE | F_EP));
          }
        }
        // pushes
        const one = s + pawnPush;
        if (onBoard(one) && !b[one]) {
          if (rankOf(one) === promoRank) {
            out.push(encodeMove(s, one, QUEEN, 0, F_PROMO));
            if (!capturesOnly) {
              out.push(encodeMove(s, one, ROOK, 0, F_PROMO));
              out.push(encodeMove(s, one, BISHOP, 0, F_PROMO));
              out.push(encodeMove(s, one, KNIGHT, 0, F_PROMO));
            }
          } else if (!capturesOnly) {
            out.push(encodeMove(s, one, 0, 0, 0));
            const two = one + pawnPush;
            if (rankOf(s) === startRank && !b[two]) {
              out.push(encodeMove(s, two, 0, 0, F_DOUBLE));
            }
          }
        }
        continue;
      }

      if (t === KNIGHT || t === KING) {
        const deltas = t === KNIGHT ? KNIGHT_D : KING_D;
        for (let i = 0; i < 8; i++) {
          const to = s + deltas[i];
          if (!onBoard(to)) continue;
          const victim = b[to];
          if (!victim) {
            if (!capturesOnly) out.push(encodeMove(s, to, 0, 0, 0));
          } else if (colourOf(victim) === them) {
            out.push(encodeMove(s, to, 0, victim, F_CAPTURE));
          }
        }
        continue;
      }

      // sliders
      const deltas = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
      const nd = t === QUEEN ? 8 : 4;
      for (let i = 0; i < nd; i++) {
        const d = deltas[i];
        for (let to = s + d; onBoard(to); to += d) {
          const victim = b[to];
          if (!victim) {
            if (!capturesOnly) out.push(encodeMove(s, to, 0, 0, 0));
            continue;
          }
          if (colourOf(victim) === them) out.push(encodeMove(s, to, 0, victim, F_CAPTURE));
          break;
        }
      }
    }

    if (!capturesOnly) this.genCastles(out);
  }

  private genCastles(out: number[]): void {
    const us = this.turn;
    const them = us ^ 1;
    const b = this.sq;
    const k = this.kingSq[us];
    if (k < 0) return;
    const home = us === WHITE ? 0x04 : 0x74;
    if (k !== home) return;
    const rookCode = makeCode(ROOK, us);
    const kingSideRight = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const queenSideRight = us === WHITE ? CASTLE_WQ : CASTLE_BQ;

    if (this.castling & kingSideRight) {
      const rookFrom = home + 3;
      if (b[rookFrom] === rookCode && !b[home + 1] && !b[home + 2]) {
        if (!this.attacked(home, them) && !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) {
          out.push(encodeMove(home, home + 2, 0, 0, F_CASTLE));
        }
      }
    }
    if (this.castling & queenSideRight) {
      const rookFrom = home - 4;
      if (b[rookFrom] === rookCode && !b[home - 1] && !b[home - 2] && !b[home - 3]) {
        if (!this.attacked(home, them) && !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) {
          out.push(encodeMove(home, home - 2, 0, 0, F_CASTLE));
        }
      }
    }
  }

  /** Fully legal moves for the side to move. */
  genLegal(out: number[]): void {
    const pseudo: number[] = [];
    this.genPseudo(pseudo, false);
    const us = this.turn;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      this.make(m);
      if (!this.attacked(this.kingSq[us], us ^ 1)) out.push(m);
      this.unmake();
    }
  }

  legalMoveList(): number[] {
    const out: number[] = [];
    this.genLegal(out);
    return out;
  }

  hasLegalMove(): boolean {
    const pseudo: number[] = [];
    this.genPseudo(pseudo, false);
    const us = this.turn;
    for (let i = 0; i < pseudo.length; i++) {
      this.make(pseudo[i]);
      const ok = !this.attacked(this.kingSq[us], us ^ 1);
      this.unmake();
      if (ok) return true;
    }
    return false;
  }

  /** True if `m` (pseudo-legal) leaves our own king safe. Board is left unchanged. */
  isLegal(m: number): boolean {
    const us = this.turn;
    this.make(m);
    const ok = !this.attacked(this.kingSq[us], us ^ 1);
    this.unmake();
    return ok;
  }

  // --- make / unmake -----------------------------------------------------------------

  make(m: number): void {
    const from = m & 0xff;
    const to = (m >> 8) & 0xff;
    const promo = (m >> 16) & 0xf;
    const cap = (m >> 20) & 0xf;
    const flags = (m >> 24) & 0x1f;

    const b = this.sq;
    const us = this.turn;
    const them = us ^ 1;
    const piece = b[from];

    const sp = this.sp;
    const st = this.st;
    st[sp] = m;
    st[sp + 1] = this.castling;
    st[sp + 2] = this.ep;
    st[sp + 3] = this.halfmove;
    st[sp + 4] = this.fullmove;
    st[sp + 5] = this.hashLo;
    st[sp + 6] = this.hashHi;
    st[sp + 7] = this.epHashFile;
    this.sp = sp + ST;

    let lo = this.hashLo, hi = this.hashHi;

    if (this.epHashFile >= 0) { lo ^= Z_EP_LO[this.epHashFile]; hi ^= Z_EP_HI[this.epHashFile]; }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];

    if (flags & F_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      const victim = b[capSq];
      b[capSq] = 0;
      lo ^= Z_PIECE_LO[victim * 128 + capSq]; hi ^= Z_PIECE_HI[victim * 128 + capSq];
    } else if (cap) {
      lo ^= Z_PIECE_LO[cap * 128 + to]; hi ^= Z_PIECE_HI[cap * 128 + to];
    }

    lo ^= Z_PIECE_LO[piece * 128 + from]; hi ^= Z_PIECE_HI[piece * 128 + from];
    b[from] = 0;
    const placed = promo ? makeCode(promo, us) : piece;
    b[to] = placed;
    lo ^= Z_PIECE_LO[placed * 128 + to]; hi ^= Z_PIECE_HI[placed * 128 + to];

    if (flags & F_CASTLE) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      const rook = b[rookFrom];
      b[rookFrom] = 0;
      b[rookTo] = rook;
      lo ^= Z_PIECE_LO[rook * 128 + rookFrom] ^ Z_PIECE_LO[rook * 128 + rookTo];
      hi ^= Z_PIECE_HI[rook * 128 + rookFrom] ^ Z_PIECE_HI[rook * 128 + rookTo];
    }

    if (typeOf(piece) === KING) this.kingSq[us] = to;

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];

    if (flags & F_DOUBLE) {
      this.ep = us === WHITE ? from + 16 : from - 16;
      // hash the ep file only when a hostile pawn is actually beside the pushed pawn
      const enemyPawn = makeCode(PAWN, them);
      const l = to - 1, r = to + 1;
      if ((onBoard(l) && b[l] === enemyPawn) || (onBoard(r) && b[r] === enemyPawn)) {
        const f = fileOf(this.ep);
        this.epHashFile = f;
        lo ^= Z_EP_LO[f]; hi ^= Z_EP_HI[f];
      } else {
        this.epHashFile = -1;
      }
    } else {
      this.ep = -1;
      this.epHashFile = -1;
    }

    if (typeOf(piece) === PAWN || cap) this.halfmove = 0;
    else this.halfmove++;
    if (us === BLACK) this.fullmove++;

    this.turn = them;
    lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI;

    this.hashLo = lo | 0;
    this.hashHi = hi | 0;
    this.ply++;
    this.repLo.push(this.hashLo);
    this.repHi.push(this.hashHi);
  }

  unmake(): void {
    const sp = this.sp - ST;
    this.sp = sp;
    const st = this.st;
    const m = st[sp];

    const from = m & 0xff;
    const to = (m >> 8) & 0xff;
    const promo = (m >> 16) & 0xf;
    const cap = (m >> 20) & 0xf;
    const flags = (m >> 24) & 0x1f;

    const b = this.sq;
    const us = this.turn ^ 1;
    const them = us ^ 1;
    this.turn = us;

    const placed = b[to];
    const piece = promo ? makeCode(PAWN, us) : placed;
    b[from] = piece;
    b[to] = 0;

    if (flags & F_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      b[capSq] = makeCode(PAWN, them);
    } else if (cap) {
      b[to] = cap;
    }

    if (flags & F_CASTLE) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      b[rookFrom] = b[rookTo];
      b[rookTo] = 0;
    }

    if (typeOf(piece) === KING) this.kingSq[us] = from;

    this.castling = st[sp + 1];
    this.ep = st[sp + 2];
    this.halfmove = st[sp + 3];
    this.fullmove = st[sp + 4];
    this.hashLo = st[sp + 5];
    this.hashHi = st[sp + 6];
    this.epHashFile = st[sp + 7];
    this.ply--;
    this.repLo.pop();
    this.repHi.pop();
  }

  /** A null move — pass the turn. Used by null-move pruning. Never generated as a move. */
  makeNull(): void {
    const sp = this.sp;
    const st = this.st;
    st[sp] = 0;
    st[sp + 1] = this.castling;
    st[sp + 2] = this.ep;
    st[sp + 3] = this.halfmove;
    st[sp + 4] = this.fullmove;
    st[sp + 5] = this.hashLo;
    st[sp + 6] = this.hashHi;
    st[sp + 7] = this.epHashFile;
    this.sp = sp + ST;

    let lo = this.hashLo, hi = this.hashHi;
    if (this.epHashFile >= 0) { lo ^= Z_EP_LO[this.epHashFile]; hi ^= Z_EP_HI[this.epHashFile]; }
    this.ep = -1;
    this.epHashFile = -1;
    this.halfmove++;
    if (this.turn === BLACK) this.fullmove++;
    this.turn ^= 1;
    lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI;
    this.hashLo = lo | 0;
    this.hashHi = hi | 0;
    this.ply++;
    this.repLo.push(this.hashLo);
    this.repHi.push(this.hashHi);
  }

  unmakeNull(): void {
    const sp = this.sp - ST;
    this.sp = sp;
    const st = this.st;
    this.turn ^= 1;
    this.castling = st[sp + 1];
    this.ep = st[sp + 2];
    this.halfmove = st[sp + 3];
    this.fullmove = st[sp + 4];
    this.hashLo = st[sp + 5];
    this.hashHi = st[sp + 6];
    this.epHashFile = st[sp + 7];
    this.ply--;
    this.repLo.pop();
    this.repHi.pop();
  }

  // --- terminal conditions -----------------------------------------------------------

  isCheckmate(): boolean {
    return this.inCheck() && !this.hasLegalMove();
  }

  isStalemate(): boolean {
    return !this.inCheck() && !this.hasLegalMove();
  }

  isFiftyMove(): boolean {
    // 100 half-moves without a capture or pawn move. A position that is already mate is
    // not a draw, so guard on that.
    if (this.halfmove < 100) return false;
    return this.hasLegalMove() || !this.inCheck();
  }

  /**
   * FIDE-style insufficient material: no side can possibly force mate.
   * K vs K, K+minor vs K, and K+B vs K+B with both bishops on the same colour complex.
   */
  isInsufficientMaterial(): boolean {
    let wn = 0, wb = 0, bn = 0, bb = 0;
    let wbLight = false, wbDark = false, bbLight = false, bbDark = false;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.sq[s];
      if (!p) continue;
      const t = typeOf(p);
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      if (t === KING) continue;
      const light = ((fileOf(s) + rankOf(s)) & 1) === 1;
      if (colourOf(p) === WHITE) {
        if (t === KNIGHT) wn++;
        else { wb++; if (light) wbLight = true; else wbDark = true; }
      } else {
        if (t === KNIGHT) bn++;
        else { bb++; if (light) bbLight = true; else bbDark = true; }
      }
    }
    const w = wn + wb;
    const b = bn + bb;
    if (w === 0 && b === 0) return true;              // K vs K
    if (w <= 1 && b === 0) return true;               // K+minor vs K
    if (b <= 1 && w === 0) return true;
    if (wn === 0 && bn === 0 && wb >= 1 && bb >= 1) { // only bishops, all one colour
      const allLight = !wbDark && !bbDark;
      const allDark = !wbLight && !bbLight;
      if (allLight || allDark) return true;
    }
    return false;
  }

  /**
   * Number of times the current position has occurred, counting this one.
   * Only looks back as far as the last irreversible move.
   */
  repetitionCount(): number {
    const n = this.repLo.length - 1;
    const lo = this.hashLo, hi = this.hashHi;
    let count = 1;
    const limit = Math.min(this.halfmove, n);
    for (let i = 2; i <= limit; i += 2) {
      if (this.repLo[n - i] === lo && this.repHi[n - i] === hi) count++;
    }
    return count;
  }

  isThreefold(): boolean {
    return this.repetitionCount() >= 3;
  }

  /** True the moment a position repeats at all — what a search wants, not what a rulebook wants. */
  isRepetitionInSearch(): boolean {
    const n = this.repLo.length - 1;
    const lo = this.hashLo, hi = this.hashHi;
    const limit = Math.min(this.halfmove, n);
    for (let i = 2; i <= limit; i += 2) {
      if (this.repLo[n - i] === lo && this.repHi[n - i] === hi) return true;
    }
    return false;
  }

  /** Non-pawn, non-king material for `colour` — the null-move zugzwang guard. */
  hasNonPawnMaterial(colour: number): boolean {
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.sq[s];
      if (!p || colourOf(p) !== colour) continue;
      const t = typeOf(p);
      if (t !== PAWN && t !== KING) return true;
    }
    return false;
  }
}

export function squareName(sq: number): string {
  return String.fromCharCode(97 + (sq & 15)) + ((sq >> 4) + 1);
}

export function squareFromName(name: string): number {
  if (!name || name.length < 2) return -1;
  const f = name.charCodeAt(0) - 97;
  const r = name.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return sq0x88(f, r);
}
