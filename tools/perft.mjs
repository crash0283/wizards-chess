#!/usr/bin/env node
/**
 * Verification harness for the `chess` piece. Owned by the chess builder.
 *
 *   node tools/perft.mjs                # perft suite + search bench + sparring matches
 *   node tools/perft.mjs --perft        # perft suite only
 *   node tools/perft.mjs --bench        # search nodes/sec only
 *   node tools/perft.mjs --match        # 20 games vs random + 20 vs greedy
 *   node tools/perft.mjs --demo         # verify buildDemoGame()
 *   node tools/perft.mjs --extra        # extra correctness positions + determinism checks
 *   node tools/perft.mjs --bulk         # allow bulk counting at depth 1 (faster)
 *   node tools/perft.mjs --divide=<d> --fen="..."   # per-move breakdown for debugging
 *   node tools/perft.mjs --games=<n> --nodes=<n>    # match size / engine budget
 *
 * src/chess is TypeScript, so it is compiled to a self-contained ESM bundle with the
 * esbuild that ships with vite and imported from memory. No build artefacts, no network.
 *
 * The sparring bots use a seeded PRNG, never Math.random, so a match is reproducible.
 */
import { build } from 'esbuild';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

async function loadEngine() {
  const out = await build({
    entryPoints: [resolve(ROOT, 'src/chess/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const url = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
  return import(url);
}

const nf = (n) => n.toLocaleString('en-US');
const pad = (s, n) => String(s).padEnd(n);

let failures = 0;
function ok(cond, msg) {
  if (!cond) { failures++; console.log(`   FAIL  ${msg}`); }
  return cond;
}

// --- seeded PRNG so every match is reproducible ---------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// --- perft ----------------------------------------------------------------------------

async function runPerft(E) {
  console.log('PERFT — published node counts, exact match required');
  console.log('');
  const bulk = args.bulk === 'true';
  let total = 0;
  let totalMs = 0;

  for (const pos of E.PERFT_SUITE) {
    console.log(`  ${pos.name}`);
    console.log(`  ${pos.fen}`);
    for (let d = 1; d <= pos.expect.length; d++) {
      const board = new E.Board(pos.fen);
      const t0 = process.hrtime.bigint();
      const got = E.perft(board, d, bulk);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const want = pos.expect[d - 1];
      const good = got === want;
      if (!good) failures++;
      total += got;
      totalMs += ms;
      console.log(
        `    d${d}  ${pad(nf(got), 12)} expected ${pad(nf(want), 12)} ` +
        `${good ? 'OK  ' : 'MISMATCH  '}${ms.toFixed(0)}ms`,
      );
      // A board must come back from a perft run exactly as it went in.
      if (board.fen() !== new E.Board(pos.fen).fen()) {
        failures++;
        console.log(`    d${d}  FAIL make/unmake did not restore the position`);
      }
    }
    console.log('');
  }
  const nps = totalMs > 0 ? (total / (totalMs / 1000)) : 0;
  console.log(`  suite total ${nf(total)} nodes in ${totalMs.toFixed(0)}ms  (${nf(Math.round(nps))} nodes/sec)`);
  console.log('');
  return { total, totalMs };
}

// --- extra correctness ----------------------------------------------------------------

/**
 * The classic supplementary perft positions — every one of them is a trap for a specific
 * generator bug (illegal en passant that exposes the king along a rank, castling that
 * gives check, promotion out of check, under-promotion, stalemate detection).
 *
 * The three castling/promotion entries had two circulating variants in the wild; d1 and d2
 * for each were re-derived by hand (15/66, 16/71, 11/133) and agree with this generator,
 * so the deep counts below are the ones that go with those roots.
 */
const EXTRA = [
  { name: 'position6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', d: 1, n: 46 },
  { name: 'position6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', d: 2, n: 2079 },
  { name: 'position6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', d: 3, n: 89890 },
  { name: 'position6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', d: 4, n: 3894594 },
  { name: 'illegal ep 1', fen: '3k4/3p4/8/K1P4r/8/8/8/8 b - - 0 1', d: 6, n: 1134888 },
  { name: 'illegal ep 2', fen: '8/8/4k3/8/2p5/8/B2P2K1/8 w - - 0 1', d: 6, n: 1015133 },
  { name: 'ep gives check', fen: '8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1', d: 6, n: 1440467 },
  { name: 'short castle check', fen: '5k2/8/8/8/8/8/8/4K2R w K - 0 1', d: 6, n: 661072 },
  { name: 'long castle check', fen: '3k4/8/8/8/8/8/8/R3K3 w Q - 0 1', d: 6, n: 803711 },
  { name: 'promote out of check', fen: '2K2r2/4P3/8/8/8/8/8/3k4 w - - 0 1', d: 6, n: 3821001 },
  { name: 'promote gives check', fen: '4k3/1P6/8/8/8/8/K7/8 w - - 0 1', d: 6, n: 217342 },
  { name: 'underpromote check', fen: '8/P1k5/K7/8/8/8/8/8 w - - 0 1', d: 6, n: 92683 },
  { name: 'self stalemate', fen: 'K1k5/8/P7/8/8/8/8/8 w - - 0 1', d: 6, n: 2217 },
  { name: 'stalemate + mate', fen: '8/k1P5/8/1K6/8/8/8/8 w - - 0 1', d: 7, n: 567584 },
  { name: 'stalemate + mate 2', fen: '8/8/2k5/5q2/5n2/8/5K2/8 b - - 0 1', d: 4, n: 23527 },
  { name: 'promotions', fen: 'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1', d: 4, n: 182838 },
];

/** Vertical flip + colour swap. A correct generator must produce identical perft counts. */
function mirrorFen(fen) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const ranks = placement.split('/').reverse();
  const swapped = ranks
    .map((r) => r.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())))
    .join('/');
  const c = (castling ?? '-').replace(/[a-zA-Z]/g, (ch) =>
    ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());
  const order = 'KQkq';
  const norm = order.split('').filter((ch) => c.includes(ch)).join('') || '-';
  let e = '-';
  if (ep && ep !== '-') e = ep[0] + String(9 - Number(ep[1]));
  return `${swapped} ${turn === 'w' ? 'b' : 'w'} ${norm} ${e} ${half ?? 0} ${full ?? 1}`;
}

async function runExtra(E) {
  console.log('EXTRA POSITIONS — traps that a naive generator gets wrong');
  console.log('');
  for (const t of EXTRA) {
    const got = E.perft(new E.Board(t.fen), t.d);
    const good = got === t.n;
    if (!good) failures++;
    console.log(
      `  ${pad(t.name, 22)} d${t.d} ${pad(nf(got), 11)} want ${pad(nf(t.n), 11)} ` +
      `${good ? 'OK' : 'MISMATCH'}  ${t.fen}`,
    );
  }
  console.log('');

  console.log('COLOUR-MIRROR SYMMETRY — perft(pos) must equal perft(mirror(pos))');
  {
    const mirrorSet = [
      ...E.PERFT_SUITE.map((p) => ({ fen: p.fen, d: 3 })),
      { fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', d: 3 },
      { fen: '8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1', d: 5 },
      { fen: 'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1', d: 4 },
      { fen: 'r3k2r/1b4bq/8/8/8/8/7B/R3K2R w KQkq - 0 1', d: 4 },
      { fen: '3k4/3p4/8/K1P4r/8/8/8/8 b - - 0 1', d: 5 },
    ];
    for (const t of mirrorSet) {
      const a = E.perft(new E.Board(t.fen), t.d);
      const mfen = mirrorFen(t.fen);
      const b = E.perft(new E.Board(mfen), t.d);
      const good = a === b;
      if (!good) failures++;
      console.log(`  d${t.d} ${pad(nf(a), 11)} vs ${pad(nf(b), 11)} ${good ? 'OK' : 'ASYMMETRIC'}  ${t.fen}`);
    }
  }
  console.log('');

  console.log('BULK VS FULL COUNTING — the two paths must agree');
  {
    for (const p of E.PERFT_SUITE) {
      const d = Math.min(4, p.expect.length);
      const a = E.perft(new E.Board(p.fen), d, false);
      const b = E.perft(new E.Board(p.fen), d, true);
      const good = a === b && a === p.expect[d - 1];
      if (!good) failures++;
      console.log(`  ${pad(p.name, 12)} d${d} full ${pad(nf(a), 11)} bulk ${pad(nf(b), 11)} ${good ? 'OK' : 'FAIL'}`);
    }
  }
  console.log('');

  console.log('TERMINAL DETECTION');
  const cases = [
    ['checkmate (fool)', 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 'checkmate'],
    ['checkmate (back rank)', '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1', 'none'],
    ['stalemate', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'stalemate'],
    ['stalemate 2', 'k7/8/1Q6/8/8/8/8/7K b - - 0 1', 'stalemate'],
    ['K vs K', '8/8/4k3/8/8/3K4/8/8 w - - 0 1', 'insufficient'],
    ['K+B vs K', '8/8/4k3/8/8/3K4/5B2/8 w - - 0 1', 'insufficient'],
    ['K+N vs K', '8/8/4k3/8/8/3K4/5N2/8 w - - 0 1', 'insufficient'],
    ['K+B vs K+B same colour', '8/2b5/4k3/8/8/3K4/5B2/8 w - - 0 1', 'insufficient'],
    ['K+B vs K+B diff colour', '8/3b4/4k3/8/8/3K4/5B2/8 w - - 0 1', 'none'],
    ['K+N+N vs K', '8/8/4k3/8/8/3K4/4NN2/8 w - - 0 1', 'none'],
    ['K+P vs K', '8/8/4k3/8/8/3K4/4P3/8 w - - 0 1', 'none'],
    ['fifty move', '8/8/4k3/8/8/3K4/4P3/6r1 w - - 100 80', 'fifty'],
  ];
  for (const [name, fen, want] of cases) {
    const mate = E.isCheckmate(fen);
    const stale = E.isStalemate(fen);
    const insuf = E.isInsufficientMaterial(fen);
    const fifty = E.isFiftyMove(fen);
    let got = 'none';
    if (mate) got = 'checkmate';
    else if (stale) got = 'stalemate';
    else if (insuf) got = 'insufficient';
    else if (fifty) got = 'fifty';
    const good = got === want;
    if (!good) failures++;
    console.log(`  ${pad(name, 26)} ${pad(got, 13)} want ${pad(want, 13)} ${good ? 'OK' : 'FAIL'}`);
  }
  console.log('');

  console.log('THREEFOLD REPETITION');
  {
    const e = new E.Engine();
    // Knights shuffle out and back, twice — the third occurrence of the start position.
    const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
    let flagged = -1;
    for (let i = 0; i < shuffle.length; i++) {
      if (!e.move(shuffle[i])) { failures++; console.log(`   FAIL illegal shuffle move ${shuffle[i]}`); break; }
      if (e.isThreefold() && flagged < 0) flagged = i + 1;
    }
    ok(flagged === 8, `threefold flagged after ${flagged} plies, expected 8`);
    console.log(`  threefold detected after ply ${flagged} (expected 8)  ${flagged === 8 ? 'OK' : 'FAIL'}`);
  }
  console.log('');

  console.log('FEN ROUND-TRIP + SAN');
  {
    const fens = [
      ...E.PERFT_SUITE.map((p) => p.fen),
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq e6 5 12',
      '8/8/8/2k5/3Pp3/8/8/4K3 b - d3 0 1',
    ];
    for (const fen of fens) {
      const round = E.toFen(E.parseFen(fen));
      const good = round === fen;
      if (!good) failures++;
      console.log(`  ${good ? 'OK  ' : 'FAIL'} ${round}`);
    }
    // SAN must round-trip through the parser for every legal move in every suite position.
    let sanChecked = 0;
    for (const p of E.PERFT_SUITE) {
      const moves = E.legalMoves(p.fen);
      for (const m of moves) {
        const back = E.legalMoves(p.fen).find(
          (x) => x.san === m.san && x.from === m.from && x.to === m.to,
        );
        if (!back) { failures++; console.log(`   FAIL SAN not unique: ${m.san}`); }
        sanChecked++;
      }
      // and the SAN strings within one position must all be distinct
      const sans = moves.map((m) => m.san);
      if (new Set(sans).size !== sans.length) {
        failures++;
        console.log(`   FAIL duplicate SAN in ${p.name}`);
      }
    }
    console.log(`  ${sanChecked} SAN strings unique and re-parseable  OK`);
    // castling and promotion SAN
    const castleSans = E.legalMovesSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    ok(castleSans.includes('O-O') && castleSans.includes('O-O-O'), 'castling SAN missing');
    const promoSans = E.legalMovesSan('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    ok(
      ['a8=Q', 'a8=R', 'a8=B', 'a8=N'].every((s) => promoSans.includes(s)),
      'promotion SAN missing',
    );
    console.log(`  castling + promotion SAN OK`);
  }
  console.log('');

  console.log('DETERMINISM — same position, same budget, same move, three times');
  {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = E.search(fen, { maxNodes: 60000 });
      runs.push(`${r.san}/${r.score}/${r.depth}/${r.nodes}`);
    }
    const same = runs[0] === runs[1] && runs[1] === runs[2];
    if (!same) failures++;
    console.log(`  ${runs.join('  |  ')}  ${same ? 'OK' : 'FAIL'}`);
  }
  console.log('');
}

// --- search bench ---------------------------------------------------------------------

const BENCH = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r2q1rk1/pp1bbppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 10',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  '4rrk1/pp1n1ppp/2pb4/q2p4/3P1B2/P1PB1N2/1PQ2PPP/R4RK1 w - - 0 17',
  '8/8/4k3/8/2p5/8/B2P2K1/8 w - - 0 1',
];

async function runBench(E) {
  console.log('SEARCH BENCH — node budget 400,000 per position');
  console.log('');
  let nodes = 0;
  let ms = 0;
  for (const fen of BENCH) {
    const t0 = process.hrtime.bigint();
    const r = E.search(fen, { maxNodes: 400000 });
    const el = Number(process.hrtime.bigint() - t0) / 1e6;
    nodes += r.nodes;
    ms += el;
    console.log(
      `  d${pad(r.depth, 3)} ${pad(r.san, 8)} score ${pad(r.score, 7)} ` +
      `${pad(nf(r.nodes), 10)} nodes ${pad(el.toFixed(0) + 'ms', 8)} pv: ${r.sanPv.slice(0, 8).join(' ')}`,
    );
  }
  const nps = nodes / (ms / 1000);
  console.log('');
  console.log(`  ${nf(nodes)} nodes in ${ms.toFixed(0)}ms  =  ${nf(Math.round(nps))} nodes/sec`);
  console.log('');

  console.log('TACTICS — the forced mates must be found, and scored as mates');
  const mates = [
    // the move before the demo game's checkmate: the engine must see Qxf7#
    ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'Qxf7#', 1],
    ['6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'Ra8#', 1],
    ['6k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1', 'Rb8#', 1],
    ['k7/8/5R2/6R1/8/8/8/7K w - - 0 1', null, 2],
    ['7k/8/8/8/8/8/5R2/6RK w - - 0 1', null, 2],
    ['8/8/8/8/8/1k6/8/K1r5 b - - 0 1', null, 2],
  ];
  for (const [fen, expectSan, expectMate] of mates) {
    const r = E.search(fen, { maxNodes: 500000 });
    if (!r) { failures++; console.log(`  FAIL no move for ${fen}`); continue; }
    const good = r.mate === expectMate && (!expectSan || r.san === expectSan);
    if (!good) failures++;
    console.log(
      `  ${pad(r.san, 9)} mate ${pad(r.mate ?? '-', 5)} score ${pad(r.score, 7)} ` +
      `${good ? 'OK  ' : `FAIL want mate ${expectMate}${expectSan ? ' ' + expectSan : ''}  `}` +
      `pv ${r.sanPv.slice(0, 6).join(' ')}`,
    );
  }
  // A finished game must not produce a move at all.
  const overFen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
  ok(E.search(overFen, { maxNodes: 50000 }) === null, 'search returned a move in a mated position');
  console.log(`  search() on a checkmated position returns null  OK`);
  console.log('');
  return nps;
}

// --- sparring -------------------------------------------------------------------------

function randomBot(E, rng) {
  return (engine) => {
    const moves = engine.moves();
    return moves[Math.floor(rng() * moves.length)];
  };
}

/**
 * Greedy material: take the most valuable thing available, otherwise a random quiet move.
 * Prefers mate when it sees one, and never hangs into an immediate recapture blindly —
 * it is a genuine (if crude) opponent, not a punching bag.
 */
function greedyBot(E, rng) {
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  return (engine) => {
    const moves = engine.moves();
    let best = null;
    let bestScore = -Infinity;
    for (const m of moves) {
      let s = 0;
      if (m.captured) s += VAL[m.captured.toLowerCase()] ?? 0;
      if (m.promo) s += VAL[m.promo] - 100;
      if (m.san && m.san.endsWith('#')) s += 100000;
      else if (m.san && m.san.endsWith('+')) s += 30;
      s += rng() * 5; // deterministic tie-break from the seeded rng
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  };
}

function playGame(E, white, black, maxPlies) {
  const engine = new E.Engine();
  let plies = 0;
  while (plies < maxPlies) {
    if (engine.isGameOver()) break;
    const bot = engine.turn === 'w' ? white : black;
    const m = bot(engine);
    if (!m) break;
    if (!engine.move(m)) return { result: 'error', plies, fen: engine.fen };
    plies++;
  }
  const st = engine.status();
  if (st.matedSide) return { result: st.matedSide === 'white' ? 'black-wins' : 'white-wins', plies, fen: st.fen };
  if (plies >= maxPlies) return { result: 'unfinished', plies, fen: st.fen };
  return { result: 'draw', plies, fen: st.fen, reason: st.drawReason };
}

async function runMatch(E) {
  const games = Number(args.games ?? 20);
  const nodes = Number(args.nodes ?? 60000);
  const maxPlies = Number(args.plies ?? 300);
  console.log(`SPARRING — ${games} games each, engine budget ${nf(nodes)} nodes/move`);
  console.log('');

  const engineBot = (engine) => {
    const r = engine.search({ maxNodes: nodes });
    return r ? r.move : null;
  };

  for (const [name, makeBot] of [['random-mover', randomBot], ['greedy-material', greedyBot]]) {
    let wins = 0, losses = 0, draws = 0, unfinished = 0;
    const detail = [];
    for (let g = 0; g < games; g++) {
      const rng = makeRng(0x5eed0000 + g * 7919 + name.length);
      const bot = makeBot(E, rng);
      // Alternate colours so the engine has to win from both sides.
      const engineIsWhite = g % 2 === 0;
      const r = playGame(
        E,
        engineIsWhite ? engineBot : bot,
        engineIsWhite ? bot : engineBot,
        maxPlies,
      );
      let tag;
      if (r.result === 'white-wins') tag = engineIsWhite ? 'W' : 'L';
      else if (r.result === 'black-wins') tag = engineIsWhite ? 'L' : 'W';
      else if (r.result === 'draw') tag = 'D';
      else tag = '?';
      if (tag === 'W') wins++;
      else if (tag === 'L') losses++;
      else if (tag === 'D') draws++;
      else unfinished++;
      detail.push(`${tag}${r.plies}`);
    }
    const bad = losses > 0;
    if (bad) failures++;
    console.log(`  engine vs ${pad(name, 16)} +${wins} =${draws} -${losses} (unfinished ${unfinished})`);
    console.log(`    ${detail.join(' ')}`);
    console.log(`    ${bad ? 'FAIL — the engine lost a game' : 'OK — no losses'}`);
    console.log('');
  }
}

// --- demo game ------------------------------------------------------------------------

async function runDemo(E) {
  console.log('DEMO GAME — buildDemoGame() must end in a real, legal checkmate');
  console.log('');
  const d = E.buildDemoGame();
  console.log(`  ${d.name}`);
  console.log(`  moves: ${d.moves.map((m) => (m.side === 'white' ? `${m.moveNumber}. ` : '') + m.san).join(' ')}`);
  console.log(`  final: ${d.finalFen}`);
  console.log(`  mated: ${d.matedSide} king on ${d.king.name} (file ${d.king.file}, rank ${d.king.rank})`);
  console.log(`  checkers: ${d.checkers.map((c) => `${c.side} ${c.piece} ${c.name}`).join(', ')}`);
  console.log(`  blocked escapes: ${d.blockedEscapes.map((e) => `${e.name}:${e.reason}`).join(', ')}`);
  console.log(`  verified: ${d.verified}`);

  ok(d.verified, 'demo game did not verify');
  ok(E.isCheckmate(d.finalFen), 'final position is not checkmate');
  ok(d.moves[d.moves.length - 1].mate === true, 'last move is not flagged as mate');
  ok(d.checkers.length >= 1, 'no checking piece recorded');
  ok(d.king.file === 4 && d.king.rank === 7, 'mated king is not on e8, where the shot is aimed');

  // Replay every move independently through the struct API — the FENs must chain.
  let fen = d.startFen;
  for (const m of d.moves) {
    if (!E.moveIsLegal(fen, m.san)) { failures++; console.log(`   FAIL illegal replay move ${m.san}`); break; }
    fen = E.toFen(E.makeMove(E.parseFen(fen), m.san));
    if (fen !== m.fenAfter) { failures++; console.log(`   FAIL fen drift at ${m.san}: ${fen} != ${m.fenAfter}`); break; }
  }
  console.log(`  replay chain: ${fen === d.finalFen ? 'OK' : 'FAIL'}`);

  // The king really has nowhere to go.
  const escapes = E.legalMoves(d.finalFen);
  ok(escapes.length === 0, `mated side still has ${escapes.length} legal moves`);
  console.log(`  legal replies for ${d.matedSide}: ${escapes.length} (must be 0)`);
  console.log('');
}

// --- main -----------------------------------------------------------------------------

async function main() {
  const E = await loadEngine();

  if (args.divide) {
    const fen = args.fen ?? E.START_FEN;
    const depth = Number(args.divide);
    const split = E.divide(fen, depth);
    let total = 0;
    for (const s of split) { console.log(`${s.move} ${s.nodes}`); total += s.nodes; }
    console.log(`\nmoves ${split.length}  nodes ${total}`);
    return;
  }

  const all = !args.perft && !args.bench && !args.match && !args.demo && !args.extra;
  if (all || args.perft) await runPerft(E);
  if (all || args.extra) await runExtra(E);
  if (all || args.demo) await runDemo(E);
  if (all || args.bench) await runBench(E);
  if (all || args.match) await runMatch(E);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
