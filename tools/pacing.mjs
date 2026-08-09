#!/usr/bin/env node
/**
 * Does the SCHEDULE agree with the ANIMATION about how long a move takes?
 *
 * This is the check that should have existed before a player ever said "the animation needs
 * to be smooth", and it needs no browser, no renderer and no frames — which is the point.
 * The bug it exists to catch is arithmetic, it is identical at 60 fps and at 144, and every
 * instrument that samples rendered frames is the wrong tool for it.
 *
 * ── the bug ──────────────────────────────────────────────────────────────────────────
 *
 * Two modules priced the same walk under two different laws. `game/choreography.ts` priced
 * it in seconds per SQUARE and clamped the result; `pieces/motion.ts` prices it in metres
 * per SECOND and treats the seconds it is handed as a floor, taking `walkSeconds(metres)`
 * whenever that is longer. So the scheduler laid out a timeline the stone was not on: a
 * seven-square charge was scheduled at 1.55 s against an animation of 7.48 s, which is the
 * scheduler asking for 10.61 m/s from a piece with a 2.2-2.5 m/s cruise. Everything hung
 * off that schedule — the next leg, the poise, the strike, the shatter, the step onto the
 * cleared square, the promotion swap, the window that tells the renderer to keep refreshing
 * shadows — fired while the man was still walking.
 *
 * ── what is tested, and how ──────────────────────────────────────────────────────────
 *
 * The REAL modules, bundled with the repo's own esbuild and imported. Not a transcription
 * of their constants: a copy is how the two laws drifted apart in the first place, and a
 * test that re-implements the thing it is checking cannot see the disagreement it exists
 * to find.
 *
 *   node tools/pacing.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'pacing-'));
const bundle = (src, out) => {
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
    [resolve(ROOT, src), '--bundle', '--format=esm', '--platform=node', `--outfile=${join(tmp, out)}`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  return pathToFileURL(join(tmp, out)).href;
};

const choreo = await import(bundle('src/game/choreography.ts', 'choreo.mjs'));
const play = await import(bundle('src/pieces/play.ts', 'play.mjs'));
const consts = await import(bundle('src/core/constants.ts', 'consts.mjs'));
rmSync(tmp, { recursive: true, force: true });

const { chargeSeconds, quietSeconds, planMove, POISE } = choreo;
const { walkSeconds } = play;
const { SQUARE } = consts;

let bad = 0;
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) bad++; };

// --- 1. the two pricing laws, head to head -----------------------------------------------
//
// A schedule shorter than the animation is not a faster animation, it is a beat that fires
// while the piece is still moving. So the scheduler's price must never be under the stone's
// own crossing time, at any distance.
{
  const rows = [];
  let worstCharge = 1;
  let worstQuiet = 1;
  for (let u = 0.25; u <= 8.001; u += 0.25) {
    const need = walkSeconds(u * SQUARE);
    const c = chargeSeconds(u);
    const q = quietSeconds(u);
    worstCharge = Math.min(worstCharge, c / need);
    worstQuiet = Math.min(worstQuiet, q / need);
    if (Math.abs(u - Math.round(u)) < 1e-9 && u >= 1) {
      rows.push(`    ${u} sq: animation ${need.toFixed(2)}s  charge ${c.toFixed(2)}s`
        + `  quiet ${q.toFixed(2)}s`);
    }
  }
  console.log('  scheduled price against the animation it is pricing:');
  for (const r of rows) console.log(r);
  say(worstCharge >= 0.999,
    `a charge is never scheduled shorter than it animates (worst ratio ${worstCharge.toFixed(3)})`);
  say(worstQuiet >= 0.999,
    `a quiet move is never scheduled shorter than it animates (worst ratio ${worstQuiet.toFixed(3)})`);
}

// --- 2. real routes, leg by leg ------------------------------------------------------------
//
// The totals agreeing is not enough. Legs share a route's total in proportion to their
// length, so an uneven route — a knight's L, an approach that swings wide to buy itself a
// walk — can hand a long leg a share it cannot be crossed in even when the sum is right.
{
  const CASES = [
    { name: 'pawn e2-e4', from: { file: 4, rank: 1 }, to: { file: 4, rank: 3 }, knight: false, capSq: null },
    { name: 'rook a1-a8', from: { file: 0, rank: 0 }, to: { file: 0, rank: 7 }, knight: false, capSq: null },
    { name: 'queen d1-h5', from: { file: 3, rank: 0 }, to: { file: 7, rank: 4 }, knight: false, capSq: null },
    { name: 'knight b1-c3', from: { file: 1, rank: 0 }, to: { file: 2, rank: 2 }, knight: true, capSq: null },
    { name: 'rook takes adjacent', from: { file: 0, rank: 0 }, to: { file: 0, rank: 1 }, knight: false, capSq: { file: 0, rank: 1 } },
    { name: 'rook takes 6 away', from: { file: 0, rank: 0 }, to: { file: 0, rank: 6 }, knight: false, capSq: { file: 0, rank: 6 } },
    { name: 'queen takes across', from: { file: 3, rank: 0 }, to: { file: 7, rank: 4 }, knight: false, capSq: { file: 7, rank: 4 } },
    { name: 'knight takes', from: { file: 1, rank: 0 }, to: { file: 2, rank: 2 }, knight: true, capSq: { file: 2, rank: 2 } },
  ];

  let worstLeg = 1;
  let worstName = '';
  for (const c of CASES) {
    const plan = planMove({
      from: c.from, to: c.to, capSq: c.capSq, knight: c.knight, occupied: () => false,
    });
    const legs = [...plan.approach, ...plan.finish];
    let cur = { file: c.from.file, rank: c.from.rank };
    for (const leg of legs) {
      const metres = Math.hypot(leg.file - cur.file, leg.rank - cur.rank) * SQUARE;
      const need = walkSeconds(metres);
      if (need > 1e-6) {
        const ratio = leg.seconds / need;
        if (ratio < worstLeg) { worstLeg = ratio; worstName = c.name; }
      }
      cur = { file: leg.file, rank: leg.rank };
    }
  }
  say(worstLeg >= 0.999,
    `every leg of every route is scheduled at least as long as it animates`
    + ` (worst ${worstLeg.toFixed(3)}${worstName ? ` on ${worstName}` : ''})`);
}

// --- 3. the strike is not ordered while the attacker is still walking ----------------------
//
// The consequence that a player actually sees. When the approach is under-priced the strike
// is ordered early, and Motion takes its safety-valve branch and compresses the whole
// unwalked remainder underneath the wind-up — a hard velocity step in the middle of the
// charge. This asserts the condition that keeps that branch unused.
{
  const CASES = [
    { name: 'rook takes 6 away', from: { file: 0, rank: 0 }, to: { file: 0, rank: 6 }, capSq: { file: 0, rank: 6 }, knight: false },
    { name: 'queen takes across', from: { file: 3, rank: 0 }, to: { file: 7, rank: 4 }, capSq: { file: 7, rank: 4 }, knight: false },
    { name: 'rook takes adjacent', from: { file: 0, rank: 0 }, to: { file: 0, rank: 1 }, capSq: { file: 0, rank: 1 }, knight: false },
    { name: 'knight takes', from: { file: 1, rank: 0 }, to: { file: 2, rank: 2 }, capSq: { file: 2, rank: 2 }, knight: true },
  ];
  let worstSlack = Infinity;
  let worstName = '';
  for (const c of CASES) {
    const plan = planMove({ ...c, occupied: () => false });
    let cur = { file: c.from.file, rank: c.from.rank };
    let scheduled = 0;
    let animated = 0;
    for (const leg of plan.approach) {
      scheduled += leg.seconds;
      animated += walkSeconds(Math.hypot(leg.file - cur.file, leg.rank - cur.rank) * SQUARE);
      cur = { file: leg.file, rank: leg.rank };
    }
    // The strike is ordered POISE after the approach's scheduled end.
    const slack = scheduled + POISE - animated;
    if (slack < worstSlack) { worstSlack = slack; worstName = c.name; }
  }
  say(worstSlack >= 0,
    `the blade is never ordered before the attacker has arrived`
    + ` (tightest margin ${worstSlack.toFixed(3)}s on ${worstName})`);
}

console.log(bad ? `\n${bad} FAILED` : '\nall pacing checks RAN and passed');
process.exit(bad ? 1 : 0);
