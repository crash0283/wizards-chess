/**
 * PIECE: chess — the search.
 *
 * Principal-variation alpha-beta with iterative deepening, a transposition table,
 * MVV-LVA + SEE capture ordering, killer and history heuristics, null-move pruning,
 * late-move reductions, check extensions, and a quiescence search over captures,
 * promotions and check evasions.
 *
 * BOUNDED BY NODES, NOT BY THE CLOCK. Nothing here reads a clock, so the same position
 * with the same budget always returns the same move — which is the only way the capture
 * harness can re-render a game and get the same pixels back.
 */
import {
  BISHOP, BISHOP_D, Board, F_CAPTURE, F_EP, F_PROMO, KING, KING_D, KNIGHT, KNIGHT_D,
  PAWN, QUEEN, ROOK, ROOK_D, WHITE, makeCode, mvCaptured, mvFlags, mvFrom, mvPromo,
  mvTo, onBoard, typeOf,
} from './board';
import { SEE_VALUE, evaluate } from './eval';

export const MATE = 30000;
export const MATE_IN_MAX = MATE - 512;
const INF = 32000;
const MAX_PLY = 128;

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;

const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;

const HISTORY_CLAMP = 1 << 20;

export interface SearchStats {
  nodes: number;
  qnodes: number;
  depth: number;
  seldepth: number;
  score: number;
  /** Packed moves, best first. */
  pv: number[];
  aborted: boolean;
}

/** Scratch board for static exchange evaluation. SEE never recurses, so one is enough. */
const seeOcc = new Int8Array(128);
const seeGain = new Int32Array(64);

export class Searcher {
  private ttKey = new Int32Array(TT_SIZE);
  private ttMove = new Int32Array(TT_SIZE);
  private ttScore = new Int32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Int8Array(TT_SIZE);
  private ttUsed = new Uint8Array(TT_SIZE);

  private killers = new Int32Array(MAX_PLY * 2);
  private history = new Int32Array(2 * 128 * 128);
  private lists: number[][] = [];
  private quiets: number[][] = [];
  private scores: number[] = [];
  private pvTable = new Int32Array(MAX_PLY * MAX_PLY);
  private pvLength = new Int32Array(MAX_PLY);

  private board!: Board;
  private nodes = 0;
  private qnodes = 0;
  private maxNodes = 0;
  private stopped = false;
  private seldepth = 0;

  constructor() {
    for (let i = 0; i < MAX_PLY; i++) { this.lists.push([]); this.quiets.push([]); }
  }

  clear(): void {
    this.ttUsed.fill(0);
    this.ttKey.fill(0);
    this.ttMove.fill(0);
    this.ttDepth.fill(0);
    this.killers.fill(0);
    this.history.fill(0);
  }

  /**
   * Search `board` in place — it is restored exactly on return.
   * Returns the deepest fully completed iteration (or depth 1, which always completes).
   */
  run(board: Board, maxDepth: number, maxNodes: number): SearchStats {
    this.board = board;
    this.nodes = 0;
    this.qnodes = 0;
    this.maxNodes = Math.max(2048, maxNodes | 0);
    this.stopped = false;
    this.seldepth = 0;
    this.clear();

    const rootMoves: number[] = [];
    board.genLegal(rootMoves);

    const stats: SearchStats = {
      nodes: 0, qnodes: 0, depth: 0, seldepth: 0, score: 0, pv: [], aborted: false,
    };
    if (rootMoves.length === 0) {
      stats.score = board.inCheck() ? -MATE : 0;
      return stats;
    }

    let bestPv: number[] = [rootMoves[0]];
    let bestScore = 0;
    const cap = Math.max(1, Math.min(maxDepth, MAX_PLY - 8));

    for (let depth = 1; depth <= cap; depth++) {
      const score = this.searchRoot(depth, rootMoves);
      const completed = !this.stopped || depth === 1;
      if (completed) {
        bestScore = score;
        const pv = this.readPv();
        if (pv.length) bestPv = pv;
        else bestPv = [rootMoves[0]];
        stats.depth = depth;
      }
      if (this.stopped) { stats.aborted = true; break; }
      if (Math.abs(score) >= MATE_IN_MAX) break; // a forced mate — nothing deeper to learn
    }

    stats.nodes = this.nodes;
    stats.qnodes = this.qnodes;
    stats.seldepth = this.seldepth;
    stats.score = bestScore;
    stats.pv = bestPv;
    return stats;
  }

  private searchRoot(depth: number, rootMoves: number[]): number {
    const b = this.board;
    let alpha = -INF;
    const beta = INF;
    let best = -INF;
    let bestMove = rootMoves[0];

    const ttm = this.probeMove();
    this.orderMoves(rootMoves, ttm, 0);
    this.pvLength[0] = 0;

    for (let i = 0; i < rootMoves.length; i++) {
      const m = rootMoves[i];
      b.make(m);
      let score: number;
      if (i === 0) {
        score = -this.negamax(depth - 1, 1, -beta, -alpha, true);
      } else {
        score = -this.negamax(depth - 1, 1, -alpha - 1, -alpha, true);
        if (score > alpha && !this.stopped) {
          score = -this.negamax(depth - 1, 1, -beta, -alpha, true);
        }
      }
      b.unmake();

      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          this.storePv(0, m);
        }
      }
      if (this.stopped) break;
    }

    this.store(depth, best, TT_EXACT, bestMove, 0);
    // Keep the best root move first so the next iteration gets an instant cutoff.
    const idx = rootMoves.indexOf(bestMove);
    if (idx > 0) { rootMoves.splice(idx, 1); rootMoves.unshift(bestMove); }
    return best;
  }

  private negamax(
    depth: number, ply: number, alpha: number, beta: number, canNull: boolean,
  ): number {
    const b = this.board;
    if (ply > this.seldepth) this.seldepth = ply;
    this.pvLength[ply] = 0;

    if (this.stopped) return 0;
    if (++this.nodes >= this.maxNodes) { this.stopped = true; return 0; }

    const isPv = beta - alpha > 1;
    const inCheck = b.inCheck();

    if (ply > 0) {
      if (b.isRepetitionInSearch() || b.halfmove >= 100 || b.isInsufficientMaterial()) {
        return 0;
      }
      const mateAlpha = alpha > -MATE + ply ? alpha : -MATE + ply;
      const mateBeta = beta < MATE - ply - 1 ? beta : MATE - ply - 1;
      if (mateAlpha >= mateBeta) return mateAlpha;
      alpha = mateAlpha;
      beta = mateBeta;
    }

    // Check extension. Only from depth >= 1, so a chain of checks can never keep the
    // search alive below the horizon indefinitely.
    if (inCheck && depth >= 1) depth++;

    if (depth <= 0) return this.quiesce(ply, alpha, beta);
    if (ply >= MAX_PLY - 8) return evaluate(b);

    // --- transposition probe ---
    const idx = (b.hashLo >>> 0) & TT_MASK;
    let ttm = 0;
    if (this.ttUsed[idx] === 1 && this.ttKey[idx] === b.hashHi) {
      ttm = this.ttMove[idx];
      if (!isPv && this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s > MATE_IN_MAX) s -= ply;
        else if (s < -MATE_IN_MAX) s += ply;
        const flag = this.ttFlag[idx];
        if (flag === TT_EXACT) return s;
        if (flag === TT_LOWER && s >= beta) return s;
        if (flag === TT_UPPER && s <= alpha) return s;
      }
    }

    const staticEval = inCheck ? -INF : evaluate(b);

    // --- reverse futility ---
    if (!isPv && !inCheck && depth <= 4 && staticEval - 96 * depth >= beta) return staticEval;

    // --- null move ---
    if (
      canNull && !isPv && !inCheck && depth >= 3 &&
      staticEval >= beta && b.hasNonPawnMaterial(b.turn)
    ) {
      const r = 2 + ((depth / 6) | 0);
      b.makeNull();
      const score = -this.negamax(depth - 1 - r, ply + 1, -beta, -beta + 1, false);
      b.unmakeNull();
      if (this.stopped) return 0;
      if (score >= beta) return score >= MATE_IN_MAX ? beta : score;
    }

    const moves = this.lists[ply];
    moves.length = 0;
    b.genPseudo(moves, false);
    this.orderMoves(moves, ttm, ply);

    const quietsTried = this.quiets[ply];
    quietsTried.length = 0;

    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    let flag = TT_UPPER;
    const us = b.turn;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      b.make(m);
      if (b.attacked(b.kingSq[us], us ^ 1)) { b.unmake(); continue; }
      legal++;

      const f = mvFlags(m);
      const tactical = (f & (F_CAPTURE | F_PROMO)) !== 0;
      const givesCheck = b.inCheck();
      const quiet = !tactical && !givesCheck;

      const newDepth = depth - 1;
      let reduction = 0;
      if (quiet && depth >= 3 && legal > 3 && !inCheck) {
        reduction = 1 + ((depth >= 6 && legal > 8) ? 1 : 0);
        if (isPv && reduction > 0) reduction--;
      }

      let score: number;
      if (legal === 1) {
        score = -this.negamax(newDepth, ply + 1, -beta, -alpha, true);
      } else {
        score = -this.negamax(newDepth - reduction, ply + 1, -alpha - 1, -alpha, true);
        if (score > alpha && reduction > 0 && !this.stopped) {
          score = -this.negamax(newDepth, ply + 1, -alpha - 1, -alpha, true);
        }
        if (score > alpha && score < beta && !this.stopped) {
          score = -this.negamax(newDepth, ply + 1, -beta, -alpha, true);
        }
      }
      b.unmake();

      if (this.stopped) return 0;
      if (quiet) quietsTried.push(m);

      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          flag = TT_EXACT;
          this.storePv(ply, m);
          if (score >= beta) {
            if (quiet) this.creditQuiet(m, quietsTried, depth, ply, us);
            this.store(depth, best, TT_LOWER, bestMove, ply);
            return best;
          }
        }
      }
    }

    if (legal === 0) return inCheck ? -MATE + ply : 0;

    this.store(depth, best, flag, bestMove, ply);
    return best;
  }

  private creditQuiet(
    m: number, tried: number[], depth: number, ply: number, us: number,
  ): void {
    const k = ply * 2;
    if (this.killers[k] !== m) {
      this.killers[k + 1] = this.killers[k];
      this.killers[k] = m;
    }
    const bonus = depth * depth;
    const hi = (us * 128 + mvFrom(m)) * 128 + mvTo(m);
    this.history[hi] += bonus;
    if (this.history[hi] > HISTORY_CLAMP) this.history[hi] = HISTORY_CLAMP;
    for (let j = 0; j < tried.length - 1; j++) {
      const q = tried[j];
      const qi = (us * 128 + mvFrom(q)) * 128 + mvTo(q);
      this.history[qi] -= bonus;
      if (this.history[qi] < -HISTORY_CLAMP) this.history[qi] = -HISTORY_CLAMP;
    }
  }

  /**
   * Quiescence. Captures and promotions only, except when in check — then every evasion
   * is searched and there is no stand-pat, so a mate is never mistaken for a quiet score.
   */
  private quiesce(ply: number, alpha: number, beta: number): number {
    const b = this.board;
    if (ply > this.seldepth) this.seldepth = ply;
    this.pvLength[ply] = 0;

    if (this.stopped) return 0;
    if (++this.nodes >= this.maxNodes) { this.stopped = true; return 0; }
    this.qnodes++;

    if (b.isRepetitionInSearch() || b.halfmove >= 100 || b.isInsufficientMaterial()) return 0;
    if (ply >= MAX_PLY - 8) return evaluate(b);

    const inCheck = b.inCheck();
    let best: number;
    if (inCheck) {
      best = -INF;
    } else {
      const standPat = evaluate(b);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      best = standPat;
    }

    const moves = this.lists[ply];
    moves.length = 0;
    b.genPseudo(moves, !inCheck);
    this.orderMoves(moves, 0, ply);

    const us = b.turn;
    let legal = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const victim = mvCaptured(m);
      const promo = mvPromo(m);

      if (!inCheck) {
        // delta pruning — even the best case cannot reach alpha
        const gain = (victim ? SEE_VALUE[typeOf(victim)] : 0) +
          (promo ? SEE_VALUE[promo] - SEE_VALUE[PAWN] : 0);
        if (best + gain + 200 < alpha) continue;
        // skip captures that lose material outright
        if (victim && SEE_VALUE[typeOf(victim)] < SEE_VALUE[typeOf(b.sq[mvFrom(m)])]) {
          if (this.see(m) < 0) continue;
        }
      }

      b.make(m);
      if (b.attacked(b.kingSq[us], us ^ 1)) { b.unmake(); continue; }
      legal++;
      const score = -this.quiesce(ply + 1, -beta, -alpha);
      b.unmake();
      if (this.stopped) return 0;

      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          this.storePv(ply, m);
          if (score >= beta) return score;
        }
      }
    }

    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  // --- move ordering -----------------------------------------------------------------

  private orderMoves(moves: number[], ttm: number, ply: number): void {
    const b = this.board;
    const us = b.turn;
    const k0 = this.killers[ply * 2];
    const k1 = this.killers[ply * 2 + 1];
    const s = this.scores;
    s.length = moves.length;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttm && ttm !== 0) { s[i] = 1 << 28; continue; }
      const flags = mvFlags(m);
      const victim = mvCaptured(m);
      if (victim) {
        const attacker = typeOf(b.sq[mvFrom(m)]);
        const vv = SEE_VALUE[typeOf(victim)];
        let v = (1 << 24) + vv * 16 - SEE_VALUE[attacker];
        // Only pay for SEE when the trade is not obviously winning.
        if (vv < SEE_VALUE[attacker] && this.see(m) < 0) v -= 1 << 23;
        if (flags & F_PROMO) v += SEE_VALUE[mvPromo(m)];
        s[i] = v;
        continue;
      }
      if (flags & F_PROMO) { s[i] = (1 << 23) + SEE_VALUE[mvPromo(m)]; continue; }
      if (m === k0) { s[i] = 1 << 22; continue; }
      if (m === k1) { s[i] = (1 << 22) - 1; continue; }
      s[i] = this.history[(us * 128 + mvFrom(m)) * 128 + mvTo(m)];
    }

    // insertion sort — lists are short and usually nearly ordered already
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i];
      const sc = s[i];
      let j = i - 1;
      while (j >= 0 && s[j] < sc) { moves[j + 1] = moves[j]; s[j + 1] = s[j]; j--; }
      moves[j + 1] = m;
      s[j + 1] = sc;
    }
  }

  /**
   * Static exchange evaluation: the material outcome of the whole capture sequence on the
   * destination square, both sides always recapturing with their least valuable attacker.
   */
  see(m: number): number {
    const b = this.board;
    const from = mvFrom(m);
    const to = mvTo(m);
    const flags = mvFlags(m);
    seeOcc.set(b.sq);
    let side = b.turn;

    const captured = mvCaptured(m);
    if (flags & F_EP) {
      const capSq = side === WHITE ? to - 16 : to + 16;
      seeOcc[capSq] = 0;
    }
    seeGain[0] = captured ? SEE_VALUE[typeOf(captured)] : 0;
    if (flags & F_PROMO) seeGain[0] += SEE_VALUE[mvPromo(m)] - SEE_VALUE[PAWN];

    // `aPiece` is whatever is standing on `to` after the previous capture — i.e. the thing
    // the next recapture would win. gain[d] is speculative and only survives if a capturer
    // is actually found at that depth.
    let aPiece = (flags & F_PROMO) ? mvPromo(m) : typeOf(seeOcc[from]);
    seeOcc[from] = 0;
    side ^= 1;

    let d = 0;
    for (;;) {
      d++;
      seeGain[d] = SEE_VALUE[aPiece] - seeGain[d - 1];
      // Neither side would enter a sequence that is already losing for both readings.
      if (Math.max(-seeGain[d - 1], seeGain[d]) < 0) break;
      const next = leastValuableAttacker(seeOcc, to, side);
      if (next < 0) break;
      aPiece = typeOf(seeOcc[next]);
      seeOcc[next] = 0;
      side ^= 1;
      if (d >= 30) break;
    }
    while (--d > 0) seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]);
    return seeGain[0];
  }

  // --- transposition table -----------------------------------------------------------

  private store(depth: number, score: number, flag: number, move: number, ply: number): void {
    if (this.stopped) return;
    const idx = (this.board.hashLo >>> 0) & TT_MASK;
    if (this.ttUsed[idx] === 1 && this.ttKey[idx] === this.board.hashHi && this.ttDepth[idx] > depth) {
      return;
    }
    let s = score;
    if (s > MATE_IN_MAX) s += ply;
    else if (s < -MATE_IN_MAX) s -= ply;
    this.ttUsed[idx] = 1;
    this.ttKey[idx] = this.board.hashHi;
    this.ttScore[idx] = s;
    this.ttDepth[idx] = depth > 127 ? 127 : depth;
    this.ttFlag[idx] = flag;
    if (move) this.ttMove[idx] = move;
  }

  private probeMove(): number {
    const idx = (this.board.hashLo >>> 0) & TT_MASK;
    if (this.ttUsed[idx] === 1 && this.ttKey[idx] === this.board.hashHi) return this.ttMove[idx];
    return 0;
  }

  // --- principal variation -----------------------------------------------------------

  private storePv(ply: number, m: number): void {
    const base = ply * MAX_PLY;
    this.pvTable[base] = m;
    const childBase = (ply + 1) * MAX_PLY;
    let childLen = ply + 1 < MAX_PLY ? this.pvLength[ply + 1] : 0;
    if (childLen > MAX_PLY - 1) childLen = MAX_PLY - 1;
    for (let i = 0; i < childLen; i++) this.pvTable[base + 1 + i] = this.pvTable[childBase + i];
    this.pvLength[ply] = childLen + 1;
  }

  private readPv(): number[] {
    const out: number[] = [];
    const n = this.pvLength[0];
    for (let i = 0; i < n && i < MAX_PLY; i++) out.push(this.pvTable[i]);
    return out;
  }
}

/** Square of the least valuable piece of `side` attacking `to` in `occ`, or -1. */
function leastValuableAttacker(occ: Int8Array, to: number, side: number): number {
  const pawn = makeCode(PAWN, side);
  if (side === WHITE) {
    if (onBoard(to - 15) && occ[to - 15] === pawn) return to - 15;
    if (onBoard(to - 17) && occ[to - 17] === pawn) return to - 17;
  } else {
    if (onBoard(to + 15) && occ[to + 15] === pawn) return to + 15;
    if (onBoard(to + 17) && occ[to + 17] === pawn) return to + 17;
  }
  const knight = makeCode(KNIGHT, side);
  for (let i = 0; i < 8; i++) {
    const s = to + KNIGHT_D[i];
    if (onBoard(s) && occ[s] === knight) return s;
  }
  const bishop = makeCode(BISHOP, side);
  const queen = makeCode(QUEEN, side);
  let queenSq = -1;
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_D[i];
    for (let s = to + d; onBoard(s); s += d) {
      const p = occ[s];
      if (!p) continue;
      if (p === bishop) return s;
      if (p === queen && queenSq < 0) queenSq = s;
      break;
    }
  }
  const rook = makeCode(ROOK, side);
  for (let i = 0; i < 4; i++) {
    const d = ROOK_D[i];
    for (let s = to + d; onBoard(s); s += d) {
      const p = occ[s];
      if (!p) continue;
      if (p === rook) return s;
      if (p === queen && queenSq < 0) queenSq = s;
      break;
    }
  }
  if (queenSq >= 0) return queenSq;
  const king = makeCode(KING, side);
  for (let i = 0; i < 8; i++) {
    const s = to + KING_D[i];
    if (onBoard(s) && occ[s] === king) return s;
  }
  return -1;
}

/** Module-level searcher, so the big typed arrays are allocated once and reused. */
let shared: Searcher | null = null;
export function sharedSearcher(): Searcher {
  if (!shared) shared = new Searcher();
  return shared;
}
