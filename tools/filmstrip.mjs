#!/usr/bin/env node
/**
 * Capture a shot across TIME and composite the frames into one contact sheet.
 * FROZEN — critics run this to judge motion, which a single frame cannot show.
 *
 *   node tools/filmstrip.mjs --shot=piece-mid-strike --from=0.0 --to=2.4 --frames=9
 *
 * Weight, follow-through, debris settling and dust drift are all temporal properties.
 * "Stone reads as tons" is a statement about acceleration curves; you cannot see it in a
 * still. This renders an evenly spaced sequence, labels each panel with its scene time,
 * and writes a single grid image plus the individual frames.
 *
 * Options:
 *   --shot=<id>      required
 *   --from=<s>       start time            (default 0)
 *   --to=<s>         end time              (default the shot's own t)
 *   --frames=<n>     panel count           (default 8)
 *   --out=<path>     contact sheet png     (default refs/strips/<shot>.png)
 *   --cols=<n>       grid columns          (default 2)
 *   --w --h          per-frame pixel size  (default 960x402, half of the render size)
 *   --seed --fen --cam --quality  as per capture.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const shot = args.shot;
if (!shot) { console.error('need --shot'); process.exit(1); }

const W = Number(args.w ?? 960);
const H = Number(args.h ?? 402);
const N = Math.max(2, Number(args.frames ?? 8));
const COLS = Number(args.cols ?? 2);
const out = resolve(ROOT, args.out ?? `refs/strips/${shot}.png`);

async function shotDefaultT() {
  const src = await readFile(resolve(ROOT, 'src/core/shots.ts'), 'utf8');
  const ids = [...src.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  const ts = [...src.matchAll(/\n\s*t:\s*([0-9.]+),/g)].map((m) => Number(m[1]));
  const i = ids.indexOf(shot);
  return i >= 0 ? ts[i] : 3;
}

const FROM = Number(args.from ?? 0);
const TO = Number(args.to ?? (await shotDefaultT()));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function portOpen(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(700, () => (s.destroy(), res(false)));
  });
}
async function waitPort(port, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await portOpen(port)) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

let server = null;
const cleanup = () => { if (server && !server.killed) { try { server.kill('SIGTERM'); } catch {} } };
process.on('exit', cleanup);
process.on('SIGINT', () => (cleanup(), process.exit(130)));

const port = await freePort();
server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: 'ignore',
});
if (!(await waitPort(port))) { console.error('dev server did not start'); process.exit(1); }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-lcd-text', '--force-device-scale-factor=1', '--hide-scrollbars',
         '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const times = Array.from({ length: N }, (_, i) => FROM + ((TO - FROM) * i) / (N - 1));
const panels = [];

await mkdir(dirname(out), { recursive: true });
await mkdir(resolve(ROOT, `refs/strips/${shot}-frames`), { recursive: true });

for (const [i, t] of times.entries()) {
  const q = new URLSearchParams({
    shot, t: t.toFixed(4), seed: String(args.seed ?? 20250811),
    w: String(W), h: String(H), quality: args.quality ?? 'high', hud: '0',
  });
  if (args.fen) q.set('fen', args.fen);
  if (args.cam) q.set('cam', args.cam);

  await page.goto(`http://127.0.0.1:${port}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  try {
    await page.waitForFunction(() => window.__CAPTURE_READY__ === true, null, { timeout: 420000 });
  } catch {
    console.error(`TIMEOUT at t=${t.toFixed(3)}`);
    await browser.close(); cleanup(); process.exit(2);
  }
  const err = await page.evaluate(() => window.__CAPTURE_ERROR__ ?? null);
  if (err) { console.error(`APP ERROR at t=${t.toFixed(3)}:\n${err}`); await browser.close(); cleanup(); process.exit(3); }

  const dataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png') ?? null);
  if (!dataUrl) { console.error('no canvas'); await browser.close(); cleanup(); process.exit(3); }
  panels.push({ t, dataUrl });
  await writeFile(
    resolve(ROOT, `refs/strips/${shot}-frames/${String(i).padStart(2, '0')}-t${t.toFixed(3)}.png`),
    Buffer.from(dataUrl.split(',')[1], 'base64'),
  );
  console.log(`  frame ${i + 1}/${N}  t=${t.toFixed(3)}s`);
}

const SHEET = `async ([panels, cols, w, h]) => {
  const imgs = await Promise.all(panels.map((p) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = p.dataUrl;
  })));
  const rows = Math.ceil(imgs.length / cols);
  const LBL = 28, GAP = 8;
  const c = document.createElement('canvas');
  c.width = cols * w + (cols - 1) * GAP;
  c.height = rows * (h + LBL) + (rows - 1) * GAP;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, i) => {
    const cx = i % cols, cy = (i / cols) | 0;
    const x = cx * (w + GAP), y = cy * (h + LBL + GAP);
    g.fillStyle = '#d6c39f';
    g.font = '600 15px ui-monospace, monospace';
    g.fillText('t = ' + panels[i].t.toFixed(3) + ' s', x + 4, y + 19);
    g.drawImage(img, x, y + LBL, w, h);
  });
  return c.toDataURL('image/png');
}`;

const sheet = await page.evaluate(SHEET, [panels, COLS, W, H]);
await writeFile(out, Buffer.from(sheet.split(',')[1], 'base64'));

await browser.close();
cleanup();
console.log(`\nwrote ${out}  (${N} frames, t=${FROM}..${TO}s)`);
console.log(`individual frames in refs/strips/${shot}-frames/`);
