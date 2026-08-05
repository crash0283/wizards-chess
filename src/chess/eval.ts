/**
 * PIECE: chess — positional evaluation.
 *
 * Tapered: a middlegame and an endgame score are accumulated separately and blended by a
 * material phase, so the same tables handle both a cramped opening and a king-and-pawn
 * ending. Terms: material, piece-square tables, bishop pair, pawn structure (doubled,
 * isolated, backward, passed, connected), rook placement, king safety (shield + attacker
 * weight), and mobility.
 *
 * The score returned by `evaluate` is from the side to move's point of view.
 */
import {
  BISHOP, BISHOP_D, BLACK, Board, KING, KING_D, KNIGHT, KNIGHT_D, PAWN, QUEEN, ROOK,
  ROOK_D, WHITE, colourOf, fileOf, makeCode, onBoard, rankOf, typeOf,
} from './board';

// --- material ------------------------------------------------------------------------

export const MG_VALUE = [0, 82, 337, 365, 477, 1025, 0];
export const EG_VALUE = [0, 94, 281, 297, 512, 936, 0];
/** Flat values used for MVV-LVA and SEE, where a taper would be noise. */
export const SEE_VALUE = [0, 100, 320, 330, 500, 900, 20000];

const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const TOTAL_PHASE = 24;

// --- piece-square tables -------------------------------------------------------------
// Written a8..h8 first, h1 last — i.e. as you would look at a board from White's side.

const PST_PAWN_MG = [
    0,   0,   0,   0,   0,   0,   0,   0,
   98, 134,  61,  95,  68, 126,  34, -11,
   -6,   7,  26,  31,  65,  56,  25, -20,
  -14,  13,   6,  21,  23,  12,  17, -23,
  -27,  -2,  -5,  12,  17,   6,  10, -25,
  -26,  -4,  -4, -10,   3,   3,  33, -12,
  -35,  -1, -20, -23, -15,  24,  38, -22,
    0,   0,   0,   0,   0,   0,   0,   0,
];
const PST_PAWN_EG = [
    0,   0,   0,   0,   0,   0,   0,   0,
  178, 173, 158, 134, 147, 132, 165, 187,
   94, 100,  85,  67,  56,  53,  82,  84,
   32,  24,  13,   5,  -2,   4,  17,  17,
   13,   9,  -3,  -7,  -7,  -8,   3,  -1,
    4,   7,  -6,   1,   0,  -5,  -1,  -8,
   13,   8,   8,  10,  13,   0,   2,  -7,
    0,   0,   0,   0,   0,   0,   0,   0,
];
const PST_KNIGHT_MG = [
 -167, -89, -34, -49,  61, -97, -15,-107,
  -73, -41,  72,  36,  23,  62,   7, -17,
  -47,  60,  37,  65,  84, 129,  73,  44,
   -9,  17,  19,  53,  37,  69,  18,  22,
  -13,   4,  16,  13,  28,  19,  21,  -8,
  -23,  -9,  12,  10,  19,  17,  25, -16,
  -29, -53, -12,  -3,  -1,  18, -14, -19,
 -105, -21, -58, -33, -17, -28, -19, -23,
];
const PST_KNIGHT_EG = [
  -58, -38, -13, -28, -31, -27, -63, -99,
  -25,  -8, -25,  -2,  -9, -25, -24, -52,
  -24, -20,  10,   9,  -1,  -9, -19, -41,
  -17,   3,  22,  22,  22,  11,   8, -18,
  -18,  -6,  16,  25,  16,  17,   4, -18,
  -23,  -3,  -1,  15,  10,  -3, -20, -22,
  -42, -20, -10,  -5,  -2, -20, -23, -44,
  -29, -51, -23, -15, -22, -18, -50, -64,
];
const PST_BISHOP_MG = [
  -29,   4, -82, -37, -25, -42,   7,  -8,
  -26,  16, -18, -13,  30,  59,  18, -47,
  -16,  37,  43,  40,  35,  50,  37,  -2,
   -4,   5,  19,  50,  37,  37,   7,  -2,
   -6,  13,  13,  26,  34,  12,  10,   4,
    0,  15,  15,  15,  14,  27,  18,  10,
    4,  15,  16,   0,   7,  21,  33,   1,
  -33,  -3, -14, -21, -13, -12, -39, -21,
];
const PST_BISHOP_EG = [
  -14, -21, -11,  -8,  -7,  -9, -17, -24,
   -8,  -4,   7, -12,  -3, -13,  -4, -14,
    2,  -8,   0,  -1,  -2,   6,   0,   4,
   -3,   9,  12,   9,  14,  10,   3,   2,
   -6,   3,  13,  19,   7,  10,  -3,  -9,
  -12,  -3,   8,  10,  13,   3,  -7, -15,
  -14, -18,  -7,  -1,   4,  -9, -15, -27,
  -23,  -9, -23,  -5,  -9, -16,  -5, -17,
];
const PST_ROOK_MG = [
   32,  42,  32,  51,  63,   9,  31,  43,
   27,  32,  58,  62,  80,  67,  26,  44,
   -5,  19,  26,  36,  17,  45,  61,  16,
  -24, -11,   7,  26,  24,  35,  -8, -20,
  -36, -26, -12,  -1,   9,  -7,   6, -23,
  -45, -25, -16, -17,   3,   0,  -5, -33,
  -44, -16, -20,  -9,  -1,  11,  -6, -71,
  -19, -13,   1,  17,  16,   7, -37, -26,
];
const PST_ROOK_EG = [
   13,  10,  18,  15,  12,  12,   8,   5,
   11,  13,  13,  11,  -3,   3,   8,   3,
    7,   7,   7,   5,   4,  -3,  -5,  -3,
    4,   3,  13,   1,   2,   1,  -1,   2,
    3,   5,   8,   4,  -5,  -6,  -8, -11,
   -4,   0,  -5,  -1,  -7, -12,  -8, -16,
   -6,  -6,   0,   2,  -9,  -9, -11,  -3,
   -9,   2,   3,  -1,  -5, -13,   4, -20,
];
const PST_QUEEN_MG = [
  -28,   0,  29,  12,  59,  44,  43,  45,
  -24, -39,  -5,   1, -16,  57,  28,  54,
  -13, -17,   7,   8,  29,  56,  47,  57,
  -27, -27, -16, -16,  -1,  17,  -2,   1,
   -9, -26,  -9, -10,  -2,  -4,   3,  -3,
  -14,   2, -11,  -2,  -5,   2,  14,   5,
  -35,  -8,  11,   2,   8,  15,  -3,   1,
   -1, -18,  -9,  10, -15, -25, -31, -50,
];
const PST_QUEEN_EG = [
   -9,  22,  22,  27,  27,  19,  10,  20,
  -17,  20,  32,  41,  58,  25,  30,   0,
  -20,   6,   9,  49,  47,  35,  19,   9,
    3,  22,  24,  45,  57,  40,  57,  36,
  -18,  28,  19,  47,  31,  34,  39,  23,
  -16, -27,  15,   6,   9,  17,  10,   5,
  -22, -23, -30, -16, -16, -23, -36, -32,
  -33, -28, -22, -43,  -5, -32, -20, -41,
];
const PST_KING_MG = [
  -65,  23,  16, -15, -56, -34,   2,  13,
   29,  -1, -20,  -7,  -8,  -4, -38, -29,
   -9,  24,   2, -16, -20,   6,  22, -22,
  -17, -20, -12, -27, -30, -25, -14, -36,
  -49,  -1, -27, -39, -46, -44, -33, -51,
  -14, -14, -22, -46, -44, -30, -15, -27,
    1,   7,  -8, -64, -43, -16,   9,   8,
  -15,  36,  12, -54,   8, -28,  24,  14,
];
const PST_KING_EG = [
  -74, -35, -18, -18, -11,  15,   4, -17,
  -12,  17,  14,  17,  17,  38,  23,  11,
   10,  17,  23,  15,  20,  45,  44,  13,
   -8,  22,  24,  27,  26,  33,  26,   3,
  -18,  -4,  21,  24,  27,  23,   9, -11,
  -19,  -3,  11,  21,  23,  16,   7,  -9,
  -27, -11,   4,  13,  14,   4,  -5, -17,
  -53, -34, -21, -11, -28, -14, -24, -43,
];

const MG_TABLE = [
  null, PST_PAWN_MG, PST_KNIGHT_MG, PST_BISHOP_MG, PST_ROOK_MG, PST_QUEEN_MG, PST_KING_MG,
];
const EG_TABLE = [
  null, PST_PAWN_EG, PST_KNIGHT_EG, PST_BISHOP_EG, PST_ROOK_EG, PST_QUEEN_EG, PST_KING_EG,
];

/**
 * PST lookup, flattened to 0x88 and pre-mirrored per colour, so evaluation is one array
 * read per piece instead of a branch and two multiplies.
 */
const MG_PST = new Int32Array(16 * 128);
const EG_PST = new Int32Array(16 * 128);
(function initPst() {
  for (let type = PAWN; type <= KING; type++) {
    const mg = MG_TABLE[type] as number[];
    const eg = EG_TABLE[type] as number[];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = (rank << 4) | file;
        const whiteIdx = (7 - rank) * 8 + file;
        const blackIdx = rank * 8 + file;
        const w = makeCode(type, WHITE);
        const b = makeCode(type, BLACK);
        MG_PST[w * 128 + sq] = mg[whiteIdx] + MG_VALUE[type];
        EG_PST[w * 128 + sq] = eg[whiteIdx] + EG_VALUE[type];
        MG_PST[b * 128 + sq] = mg[blackIdx] + MG_VALUE[type];
        EG_PST[b * 128 + sq] = eg[blackIdx] + EG_VALUE[type];
      }
    }
  }
})();

// --- structural bonuses --------------------------------------------------------------

const PASSED_MG = [0, 5, 10, 20, 38, 68, 110, 0];
const PASSED_EG = [0, 12, 22, 42, 74, 122, 180, 0];
const DOUBLED_MG = -12, DOUBLED_EG = -22;
const ISOLATED_MG = -16, ISOLATED_EG = -14;
const BACKWARD_MG = -10, BACKWARD_EG = -8;
const CONNECTED_MG = 8, CONNECTED_EG = 6;
const BISHOP_PAIR_MG = 30, BISHOP_PAIR_EG = 48;
const ROOK_OPEN_MG = 26, ROOK_OPEN_EG = 12;
const ROOK_SEMI_MG = 12, ROOK_SEMI_EG = 6;
const ROOK_SEVENTH_MG = 18, ROOK_SEVENTH_EG = 28;
const TEMPO = 12;

/** Mobility is worth different amounts to different pieces; these are per legal step. */
const MOB_MG = [0, 0, 4, 5, 3, 1, 0];
const MOB_EG = [0, 0, 4, 5, 5, 3, 0];
/** Subtracted so an average piece scores near zero and the term is a differential. */
const MOB_BASE = [0, 0, 4, 6, 7, 14, 0];

/** How much each attacker type contributes to pressure on the enemy king zone. */
const KING_ATTACK_WEIGHT = [0, 0, 20, 20, 40, 80, 0];
/** Scaled by the number of distinct attackers. */
const ATTACK_SCALE = [0, 0, 50, 75, 88, 94, 97, 99, 100, 100, 100, 100, 100, 100, 100, 100];

const SHIELD_MISSING_MG = -18;
const SHIELD_OPEN_FILE_MG = -22;

const pawnFiles = [new Int32Array(8), new Int32Array(8)];
const pawnMinRank = [new Int32Array(8), new Int32Array(8)];
const pawnMaxRank = [new Int32Array(8), new Int32Array(8)];

/**
 * Full static evaluation. Returns centipawns from the side to move's perspective.
 */
export function evaluate(b: Board): number {
  const sq = b.sq;
  let mg = 0;
  let eg = 0;
  let phase = 0;

  const wp = pawnFiles[WHITE]; wp.fill(0);
  const bp = pawnFiles[BLACK]; bp.fill(0);
  const wMin = pawnMinRank[WHITE]; wMin.fill(9);
  const bMin = pawnMinRank[BLACK]; bMin.fill(9);
  const wMax = pawnMaxRank[WHITE]; wMax.fill(-1);
  const bMax = pawnMaxRank[BLACK]; bMax.fill(-1);

  let wBishops = 0, bBishops = 0;

  // pass 1 — material, PST, phase, pawn skeleton
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = sq[s];
    if (!p) continue;
    const t = typeOf(p);
    const c = colourOf(p);
    phase += PHASE_WEIGHT[t];
    if (c === WHITE) { mg += MG_PST[p * 128 + s]; eg += EG_PST[p * 128 + s]; }
    else { mg -= MG_PST[p * 128 + s]; eg -= EG_PST[p * 128 + s]; }
    if (t === PAWN) {
      const f = fileOf(s), r = rankOf(s);
      if (c === WHITE) {
        wp[f]++;
        if (r < wMin[f]) wMin[f] = r;
        if (r > wMax[f]) wMax[f] = r;
      } else {
        bp[f]++;
        if (r < bMin[f]) bMin[f] = r;
        if (r > bMax[f]) bMax[f] = r;
      }
    } else if (t === BISHOP) {
      if (c === WHITE) wBishops++; else bBishops++;
    }
  }

  if (wBishops >= 2) { mg += BISHOP_PAIR_MG; eg += BISHOP_PAIR_EG; }
  if (bBishops >= 2) { mg -= BISHOP_PAIR_MG; eg -= BISHOP_PAIR_EG; }

  // pass 2 — everything that needs the pawn skeleton
  const wKing = b.kingSq[WHITE];
  const bKing = b.kingSq[BLACK];
  let wAttackUnits = 0, wAttackers = 0;
  let bAttackUnits = 0, bAttackers = 0;

  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = sq[s];
    if (!p) continue;
    const t = typeOf(p);
    const c = colourOf(p);
    const sign = c === WHITE ? 1 : -1;
    const f = fileOf(s);
    const r = rankOf(s);

    if (t === PAWN) {
      const own = c === WHITE ? wp : bp;
      const relRank = c === WHITE ? r : 7 - r;

      if (own[f] > 1) { mg += sign * DOUBLED_MG; eg += sign * DOUBLED_EG; }

      const left = f > 0 ? own[f - 1] : 0;
      const right = f < 7 ? own[f + 1] : 0;
      if (left === 0 && right === 0) { mg += sign * ISOLATED_MG; eg += sign * ISOLATED_EG; }

      // passed: no enemy pawn ahead of it on this or an adjacent file
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const ff = f + df;
        if (ff < 0 || ff > 7) continue;
        if (c === WHITE) {
          if (bp[ff] > 0 && bMax[ff] > r) { passed = false; break; }
        } else {
          if (wp[ff] > 0 && wMin[ff] < r) { passed = false; break; }
        }
      }
      if (passed) { mg += sign * PASSED_MG[relRank]; eg += sign * PASSED_EG[relRank]; }

      // connected / phalanx
      const back = c === WHITE ? -16 : 16;
      const supportL = s + back - 1, supportR = s + back + 1;
      const ownPawn = makeCode(PAWN, c);
      let connected = false;
      if (onBoard(supportL) && sq[supportL] === ownPawn) connected = true;
      if (onBoard(supportR) && sq[supportR] === ownPawn) connected = true;
      if (onBoard(s - 1) && sq[s - 1] === ownPawn) connected = true;
      if (onBoard(s + 1) && sq[s + 1] === ownPawn) connected = true;
      if (connected) { mg += sign * CONNECTED_MG; eg += sign * CONNECTED_EG; }
      else if (!passed && left === 0 && right === 0) {
        // already isolated, no extra penalty
      } else if (!connected) {
        const behindL = f > 0 ? (c === WHITE ? wMin[f - 1] : bMax[f - 1]) : -1;
        const behindR = f < 7 ? (c === WHITE ? wMin[f + 1] : bMax[f + 1]) : -1;
        const isBackward = c === WHITE
          ? (behindL > r || behindL === -1) && (behindR > r || behindR === -1)
          : (behindL < r || behindL === -1) && (behindR < r || behindR === -1);
        if (isBackward) { mg += sign * BACKWARD_MG; eg += sign * BACKWARD_EG; }
      }
      continue;
    }

    if (t === KING) continue;

    // --- mobility + king pressure, one walk per piece ---
    const enemyKing = c === WHITE ? bKing : wKing;
    let moves = 0;
    let attackUnits = 0;

    if (t === KNIGHT) {
      for (let i = 0; i < 8; i++) {
        const to = s + KNIGHT_D[i];
        if (!onBoard(to)) continue;
        const q = sq[to];
        if (q && colourOf(q) === c) continue;
        moves++;
        if (enemyKing >= 0 && isKingZone(to, enemyKing)) attackUnits++;
      }
    } else {
      const deltas = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
      const nd = t === QUEEN ? 8 : 4;
      for (let i = 0; i < nd; i++) {
        const d = deltas[i];
        for (let to = s + d; onBoard(to); to += d) {
          const q = sq[to];
          if (q && colourOf(q) === c) break;
          moves++;
          if (enemyKing >= 0 && isKingZone(to, enemyKing)) attackUnits++;
          if (q) break;
        }
      }
    }

    mg += sign * (moves - MOB_BASE[t]) * MOB_MG[t];
    eg += sign * (moves - MOB_BASE[t]) * MOB_EG[t];

    if (attackUnits > 0) {
      if (c === WHITE) { wAttackers++; wAttackUnits += KING_ATTACK_WEIGHT[t] * attackUnits; }
      else { bAttackers++; bAttackUnits += KING_ATTACK_WEIGHT[t] * attackUnits; }
    }

    if (t === ROOK) {
      const own = c === WHITE ? wp : bp;
      const foe = c === WHITE ? bp : wp;
      if (own[f] === 0) {
        if (foe[f] === 0) { mg += sign * ROOK_OPEN_MG; eg += sign * ROOK_OPEN_EG; }
        else { mg += sign * ROOK_SEMI_MG; eg += sign * ROOK_SEMI_EG; }
      }
      const seventh = c === WHITE ? 6 : 1;
      if (r === seventh) { mg += sign * ROOK_SEVENTH_MG; eg += sign * ROOK_SEVENTH_EG; }
    }
  }

  // --- king safety: pawn shield and accumulated pressure ---
  mg += shieldScore(b, WHITE, wKing, wp, bp);
  mg -= shieldScore(b, BLACK, bKing, bp, wp);

  const wPressure = (wAttackUnits * ATTACK_SCALE[Math.min(wAttackers, 15)]) / 100 / 8;
  const bPressure = (bAttackUnits * ATTACK_SCALE[Math.min(bAttackers, 15)]) / 100 / 8;
  mg += (wPressure - bPressure) | 0;
  eg += ((wPressure - bPressure) / 3) | 0;

  // --- taper ---
  const ph = Math.min(phase, TOTAL_PHASE);
  let score = ((mg * ph) + (eg * (TOTAL_PHASE - ph))) / TOTAL_PHASE;
  score += b.turn === WHITE ? TEMPO : -TEMPO;
  score = score | 0;
  return b.turn === WHITE ? score : -score;
}

function isKingZone(sq: number, king: number): boolean {
  const df = fileOf(sq) - fileOf(king);
  const dr = rankOf(sq) - rankOf(king);
  return df >= -1 && df <= 1 && dr >= -1 && dr <= 1;
}

function shieldScore(
  b: Board, colour: number, king: number, own: Int32Array, foe: Int32Array,
): number {
  if (king < 0) return 0;
  const kf = fileOf(king);
  const kr = rankOf(king);
  // Only meaningful while the king is still near its own back ranks.
  const homeish = colour === WHITE ? kr <= 2 : kr >= 5;
  if (!homeish) return 0;
  const ownPawn = makeCode(PAWN, colour);
  const dir = colour === WHITE ? 16 : -16;
  let s = 0;
  for (let df = -1; df <= 1; df++) {
    const f = kf + df;
    if (f < 0 || f > 7) continue;
    const near = king + df + dir;
    const far = king + df + dir * 2;
    const hasNear = onBoard(near) && b.sq[near] === ownPawn;
    const hasFar = onBoard(far) && b.sq[far] === ownPawn;
    if (!hasNear && !hasFar) s += SHIELD_MISSING_MG;
    else if (!hasNear) s += (SHIELD_MISSING_MG / 2) | 0;
    if (own[f] === 0 && foe[f] === 0) s += SHIELD_OPEN_FILE_MG;
    else if (own[f] === 0) s += (SHIELD_OPEN_FILE_MG / 2) | 0;
  }
  return s;
}

/** Bare material count in centipawns, White minus Black. Used by the greedy sparring bot. */
export function materialBalance(b: Board): number {
  let v = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = b.sq[s];
    if (!p) continue;
    const t = typeOf(p);
    if (t === KING) continue;
    v += colourOf(p) === WHITE ? SEE_VALUE[t] : -SEE_VALUE[t];
  }
  return v;
}
