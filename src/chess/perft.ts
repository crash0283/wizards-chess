/**
 * PIECE: chess — perft.
 *
 * The verification that matters. `perft(d)` counts leaf nodes of the legal move tree; the
 * published values for the standard positions are exact, so any disagreement is a bug in
 * move generation, make/unmake, or the legality filter — there is nowhere for an error to
 * hide. tools/perft.mjs drives this.
 *
 * Deliberately NOT bulk-counted by default: every leaf is reached by a real make/unmake,
 * so a make/unmake asymmetry cannot be masked by counting moves at depth 1.
 */
import { Board, mvFrom, mvPromo, mvTo, TYPE_CHAR, squareName } from './board';

export function perft(b: Board, depth: number, bulk = false): number {
  if (depth <= 0) return 1;
  const moves: number[] = [];
  b.genPseudo(moves, false);
  const us = b.turn;

  if (bulk && depth === 1) {
    let n = 0;
    for (let i = 0; i < moves.length; i++) {
      b.make(moves[i]);
      if (!b.attacked(b.kingSq[us], us ^ 1)) n++;
      b.unmake();
    }
    return n;
  }

  let nodes = 0;
  for (let i = 0; i < moves.length; i++) {
    b.make(moves[i]);
    if (!b.attacked(b.kingSq[us], us ^ 1)) nodes += perft(b, depth - 1, bulk);
    b.unmake();
  }
  return nodes;
}

export interface PerftSplit {
  move: string;
  nodes: number;
}

/** Per-root-move breakdown — the tool you actually debug a mismatch with. */
export function perftDivide(b: Board, depth: number): PerftSplit[] {
  const out: PerftSplit[] = [];
  const moves: number[] = [];
  b.genPseudo(moves, false);
  const us = b.turn;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    b.make(m);
    if (!b.attacked(b.kingSq[us], us ^ 1)) {
      const promo = mvPromo(m);
      out.push({
        move: squareName(mvFrom(m)) + squareName(mvTo(m)) + (promo ? TYPE_CHAR[promo] : ''),
        nodes: perft(b, depth - 1),
      });
    }
    b.unmake();
  }
  out.sort((a, c) => (a.move < c.move ? -1 : a.move > c.move ? 1 : 0));
  return out;
}

/** The published positions every generator is measured against. */
export const PERFT_SUITE: Array<{
  name: string;
  fen: string;
  expect: number[];
}> = [
  {
    name: 'startpos',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    expect: [20, 400, 8902, 197281, 4865609],
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    expect: [48, 2039, 97862, 4085603],
  },
  {
    name: 'position3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    expect: [14, 191, 2812, 43238, 674624],
  },
  {
    name: 'position4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    expect: [6, 264, 9467, 422333],
  },
  {
    name: 'position5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 0 1',
    expect: [44, 1486, 62379, 2103487],
  },
];
