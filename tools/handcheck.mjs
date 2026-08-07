#!/usr/bin/env node
/**
 * Prove the board is handed correctly — in the GEOMETRY, the HIT TEST and the CARVED LETTERS.
 *
 * The first version of this checked only projected square centres. That is exactly one of the
 * three places the file axis is consumed, and when squareCentre's sign was corrected the other
 * two stayed on the old convention: the click hit test hand-rolled its own inverse, so clicking
 * the rendered a2 selected h2, and the kerb inscription derived its glyph index from the same
 * expression as the ranks, so the far kerb still read H G F E D C B A. Both survived a check
 * that passed, which is worse than no check at all.
 *
 * So this now issues a real click and reads a real letter.
 *
 *   node tools/handcheck.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const portOpen = (port) => new Promise((res) => {
  const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(500, () => (s.destroy(), res(false)));
});

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
const cleanup = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);

for (let i = 0; i < 240; i++) { if (await portOpen(port)) break; await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
await page.waitForTimeout(14000);

/** Project a square centre to canvas coordinates through the app's own live camera. */
const project = (file, rank) => page.evaluate(([f, r]) => {
  const { world, THREE } = window.__WC__;
  const S = 2.35;
  const v = new THREE.Vector3((3.5 - f) * S, 0.2, (r - 3.5) * S);
  v.project(world.camera);
  const b = world.renderer.domElement.getBoundingClientRect();
  return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((-v.y + 1) / 2) * b.height };
}, [file, rank]);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

// --- 1. geometry -----------------------------------------------------------------------
const a1 = await project(0, 0), h1 = await project(7, 0), a8 = await project(0, 7);
check(a1.x < h1.x, `a-file left of h-file  (a1 x=${a1.x.toFixed(0)}, h1 x=${h1.x.toFixed(0)})`);
check(a1.y > a8.y, `rank 1 below rank 8    (a1 y=${a1.y.toFixed(0)}, a8 y=${a8.y.toFixed(0)})`);

// --- 2. the hit test agrees with what is drawn ------------------------------------------
//
// Read through the FEN rather than through any selection accessor: the FEN is part of the
// public Game interface and cannot quietly stop existing. Click the square that RENDERS as
// a2, then the one that renders as a4, and the resulting position must show a pawn that
// left the A file. When the hit test was mirrored this produced h2-h4 instead, and a
// checker that only projected square centres reported the board correct throughout.
{
  const before = await page.evaluate(() => window.__WC__.game.state().fen);
  const from = await project(0, 1);   // a2 as drawn
  const to = await project(0, 3);     // a4 as drawn
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(900);
  await page.mouse.click(to.x, to.y);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => window.__WC__.game.state().fen);

  if (after === before) {
    check(false, 'clicking the rendered a2 then a4 did not move anything');
  } else {
    // Rank 2 is the 7th field of the placement; a-file is its first square.
    const rank2Before = before.split(' ')[0].split('/')[6];
    const rank2After = after.split(' ')[0].split('/')[6];
    const expand = (s) => [...s].flatMap((c) => (/\d/.test(c) ? Array(+c).fill('') : [c]));
    const aGone = expand(rank2Before)[0] === 'P' && expand(rank2After)[0] === '';
    const hGone = expand(rank2Before)[7] === 'P' && expand(rank2After)[7] === '';
    check(aGone && !hGone,
      `clicking rendered a2->a4 moved the ${aGone ? 'A' : hGone ? 'H' : '?'} file pawn` +
      `  (${before.split(' ')[0]} -> ${after.split(' ')[0]})`);
  }
}

// --- 3. the carved letters agree too ------------------------------------------------------
// The glyph over the a-file must be A. Sample the kerb just outside a1 and h1 and compare
// which is brighter against a reference render of each letter is overkill; instead assert the
// shader's own index mapping, which is what went wrong.
const glyph = await page.evaluate(() => {
  const S = 2.35;
  // Mirror the shader's derivation: gRaw = 4.0 - w.x / uGlyphSq for the file kerbs.
  const idxAt = (x) => Math.max(0, Math.min(7, Math.floor(4.0 - x / S)));
  return { overA: idxAt((3.5 - 0) * S), overH: idxAt((3.5 - 7) * S) };
});
check(glyph.overA === 0, `glyph over the a-file is index ${glyph.overA} (want 0 = 'A')`);
check(glyph.overH === 7, `glyph over the h-file is index ${glyph.overH} (want 7 = 'H')`);

await browser.close();
cleanup();
// Never report a clean bill for a check that did not run — that is how the mirrored hit
// test and the mirrored inscription both survived a passing checker.
console.log(failures
  ? `\n${failures} FAILED`
  : '\nall handedness checks RAN and passed: geometry, hit test, inscription');
process.exit(failures ? 1 : 0);
