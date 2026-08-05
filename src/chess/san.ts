/**
 * PIECE: chess — SAN and UCI notation.
 *
 * SAN is what the HUD prints and what the game flow logs, so it has to be right down to
 * the disambiguation rules: file first, then rank, then both, and only when a genuinely
 * different legal move of the same piece type could reach the same square.
 */
import {
  Board, F_CAPTURE, F_CASTLE, F_PROMO, PAWN, TYPE_CHAR, fileOf, mvFlags, mvFrom, mvPromo,
  mvTo, rankOf, squareFromName, typeOf,
} from './board';

const SAN_PIECE = ['', '', 'N', 'B', 'R', 'Q', 'K'];

/**
 * SAN for a legal move in `b`. The board is left exactly as it was.
 * `legal` may be passed in when the caller already has the legal move list.
 */
export function moveToSan(b: Board, m: number, legal?: number[]): string {
  const from = mvFrom(m);
  const to = mvTo(m);
  const flags = mvFlags(m);
  const piece = b.sq[from];
  const type = typeOf(piece);

  let san: string;
  if (flags & F_CASTLE) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else if (type === PAWN) {
    san = (flags & F_CAPTURE)
      ? `${String.fromCharCode(97 + fileOf(from))}x${squareStr(to)}`
      : squareStr(to);
    if (flags & F_PROMO) san += `=${SAN_PIECE[mvPromo(m)]}`;
  } else {
    const moves = legal ?? b.legalMoveList();
    let sameFile = false;
    let sameRank = false;
    let ambiguous = false;
    for (let i = 0; i < moves.length; i++) {
      const o = moves[i];
      if (o === m) continue;
      if (mvTo(o) !== to) continue;
      const of = mvFrom(o);
      if (of === from) continue;
      if (typeOf(b.sq[of]) !== type) continue;
      ambiguous = true;
      if (fileOf(of) === fileOf(from)) sameFile = true;
      if (rankOf(of) === rankOf(from)) sameRank = true;
    }
    let disamb = '';
    if (ambiguous) {
      if (!sameFile) disamb = String.fromCharCode(97 + fileOf(from));
      else if (!sameRank) disamb = String(rankOf(from) + 1);
      else disamb = squareStr(from);
    }
    san = SAN_PIECE[type] + disamb + ((flags & F_CAPTURE) ? 'x' : '') + squareStr(to);
  }

  b.make(m);
  if (b.inCheck()) san += b.hasLegalMove() ? '+' : '#';
  b.unmake();
  return san;
}

export function moveToUci(m: number): string {
  const promo = mvPromo(m);
  return squareStr(mvFrom(m)) + squareStr(mvTo(m)) + (promo ? TYPE_CHAR[promo] : '');
}

function squareStr(sq: number): string {
  return String.fromCharCode(97 + fileOf(sq)) + (rankOf(sq) + 1);
}

/**
 * Parse SAN (or UCI, or "e2e4"/"e2-e4") against the legal moves of `b`.
 * Returns the packed move, or 0 when nothing matches.
 */
export function sanToMove(b: Board, text: string): number {
  const want = text.trim();
  if (!want) return 0;
  const moves = b.legalMoveList();

  // exact SAN, then SAN with check/mate marks stripped
  const strip = (s: string) => s.replace(/[+#]$/, '').replace(/[!?]+$/, '');
  const target = strip(want).replace(/0/g, 'O');
  for (let i = 0; i < moves.length; i++) {
    if (strip(moveToSan(b, moves[i], moves)) === target) return moves[i];
  }
  // UCI
  const uci = want.toLowerCase().replace(/[-x]/g, '');
  if (uci.length >= 4) {
    const from = squareFromName(uci.slice(0, 2));
    const to = squareFromName(uci.slice(2, 4));
    const promoCh = uci.length > 4 ? uci[4] : '';
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (mvFrom(m) !== from || mvTo(m) !== to) continue;
      const p = mvPromo(m);
      if (promoCh) { if (TYPE_CHAR[p] !== promoCh) continue; }
      else if (p && p !== 5) continue; // default a bare "e7e8" to the queen
      return m;
    }
  }
  return 0;
}

/** Human-readable move list: "1. e4 e5 2. Bc4 Nc6". Restores the board. */
export function lineToSan(b: Board, moves: number[]): string[] {
  const out: string[] = [];
  let made = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    // Guard against a stale PV move that is not legal in this position.
    const legal = b.legalMoveList();
    if (legal.indexOf(m) < 0) break;
    out.push(moveToSan(b, m, legal));
    b.make(m);
    made++;
  }
  while (made-- > 0) b.unmake();
  return out;
}
