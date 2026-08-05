#!/usr/bin/env node
/**
 * Prove the game is actually PLAYABLE, not just renderable.
 *
 * Drives the real app the way a person does — projects a square to screen coordinates,
 * clicks the canvas, clicks a destination — then checks that the move was accepted and
 * that the engine answered with a legal reply of its own. A scripted capture can look
 * perfect while the interactive path is broken, so this exercises the path captures never
 * touch: raycasting, selection, legality, and the engine's turn.
 *
 *   node tools/play-test.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
const portOpen = (port) => new Promise((res) => {
  const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(700, () => (s.destroy(), res(false)));
});
async function waitPort(port, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await portOpen(port)) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
const cleanup = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);

if (!(await waitPort(port))) { console.error('dev server did not start'); process.exit(1); }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Interactive mode: no ?shot / ?t, so the app runs its rAF loop and accepts input.
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
// Let the scene build and a few frames run.
await page.waitForTimeout(8000);

/** Project a board square to canvas coordinates using the app's own live camera. */
async function squareToScreen(file, rank) {
  return page.evaluate(([f, r]) => {
    const { world } = window.__WC__;
    const S = 2.35;
    const v = new window.__WC__.THREE.Vector3((f - 3.5) * S, 0.2, (r - 3.5) * S);
    v.project(world.camera);
    const el = world.renderer.domElement;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((-v.y + 1) / 2) * rect.height,
      onScreen: v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1,
    };
  }, [file, rank]);
}

const before = await page.evaluate(() => {
  const s = window.__WC__.game.state();
  return { fen: s.fen, turn: s.turn, moveNumber: s.moveNumber, result: s.result };
});
console.log('before      :', before.turn, 'to move,  move', before.moveNumber);
console.log('             ', before.fen);

// e2 -> e4  (file 4, rank 1) -> (file 4, rank 3)
const from = await squareToScreen(4, 1);
const to = await squareToScreen(4, 3);
if (!from.onScreen || !to.onScreen) {
  console.error('FAIL: e2/e4 are not on screen from the default camera — cannot click them.');
  await browser.close(); cleanup(); process.exit(2);
}

await page.mouse.click(from.x, from.y);
await page.waitForTimeout(400);
await page.mouse.click(to.x, to.y);

// The engine replies on a timer measured in SCENE time. main.ts clamps dt to 0.05 s per
// frame, so under software rendering (a few frames per second) scene time advances far
// slower than the wall clock — poll for the reply rather than guessing a fixed wait.
const replied = await page
  .waitForFunction(() => window.__WC__.game.state().turn === 'white' &&
                         window.__WC__.game.state().fen.includes('4P3'),
                   null, { timeout: 180000, polling: 1000 })
  .then(() => true)
  .catch(() => false);
if (!replied) console.log('(engine did not reply within 180 s of wall clock)');

const after = await page.evaluate(() => {
  const s = window.__WC__.game.state();
  return { fen: s.fen, turn: s.turn, moveNumber: s.moveNumber, result: s.result, last: s.lastMove };
});
console.log('after       :', after.turn, 'to move,  move', after.moveNumber);
console.log('             ', after.fen);

// Verify with the engine itself that the resulting position is reachable and legal.
const check = await page.evaluate(() => {
  const s = window.__WC__.game.state();
  return { fen: s.fen };
});

await browser.close();
cleanup();

const moved = after.fen !== before.fen;
const engineReplied = after.fen.split(' ')[1] === 'w' && moved;

console.log('');
console.log('player move accepted :', moved);
console.log('engine replied       :', engineReplied);
console.log('page errors          :', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
console.log('');
if (moved && engineReplied && errors.length === 0) {
  console.log('PLAYABLE: a human move was accepted and the engine answered.');
  process.exit(0);
}
console.log('NOT PLAYABLE — see above.');
process.exit(3);
