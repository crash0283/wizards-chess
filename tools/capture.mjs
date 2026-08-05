#!/usr/bin/env node
/**
 * Render deterministic frames of the real app to PNGs.
 * FROZEN — this is the harness both builders and critics run.
 *
 *   node tools/capture.mjs --shot=wide-establishing --t=3 --out=refs/renders/wide.png
 *   node tools/capture.mjs --all --tag=r3          # all six shots, one browser, one server
 *
 * Each invocation starts its own Vite server on a free port, so many agents can capture
 * at the same time without fighting over a port. Use --all when you want the whole set;
 * it reuses one browser and is far faster than six separate runs.
 *
 * Options:
 *   --shot=<id>     shot id from src/core/shots.ts        (default wide-establishing)
 *   --all           capture every shot in SHOTS
 *   --t=<seconds>   scene time                            (default: the shot's own t)
 *   --out=<path>    output png (single-shot mode)
 *   --tag=<name>    with --all, writes refs/renders/<shot>--<tag>.png
 *   --seed=<int>    rng seed                              (default 20250811)
 *   --w --h         pixel size                            (default 1920x804)
 *   --fen=<fen>     force a board position
 *   --cam=<spec>    free camera "x,y,z,tx,ty,tz,fov"
 *   --quality=high|low
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

const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 804);

/** Read shot ids + default times straight out of the frozen source, no build step. */
async function readShots() {
  const src = await readFile(resolve(ROOT, 'src/core/shots.ts'), 'utf8');
  const ids = [...src.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  const ts = [...src.matchAll(/\n\s*t:\s*([0-9.]+),/g)].map((m) => Number(m[1]));
  return ids.map((id, i) => ({ id, t: ts[i] ?? 3 }));
}

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
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
  while (Date.now() - t0 < ms) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let server = null;
async function startServer() {
  const port = await freePort();
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  if (!(await waitPort(port))) throw new Error('dev server did not start');
  return port;
}

function cleanup() {
  if (server && !server.killed) { try { server.kill('SIGTERM'); } catch {} }
}
process.on('exit', cleanup);
process.on('SIGINT', () => (cleanup(), process.exit(130)));

async function renderOne(page, port, { shot, t, out }) {
  const q = new URLSearchParams({
    shot,
    t: String(t),
    seed: String(args.seed ?? 20250811),
    w: String(W),
    h: String(H),
    quality: args.quality ?? 'high',
    hud: '0',
  });
  if (args.fen) q.set('fen', args.fen);
  if (args.cam) q.set('cam', args.cam);

  const logs = [];
  const onConsole = (m) => logs.push(`[${m.type()}] ${m.text()}`);
  const onErr = (e) => logs.push(`[pageerror] ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onErr);

  await page.goto(`http://127.0.0.1:${port}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  let ok = true;
  try {
    await page.waitForFunction(() => window.__CAPTURE_READY__ === true, null, { timeout: 420000 });
  } catch {
    ok = false;
  }
  page.off('console', onConsole);
  page.off('pageerror', onErr);

  if (!ok) {
    console.error(`TIMEOUT ${shot}\n` + logs.slice(-30).join('\n'));
    return { shot, ok: false, reason: 'timeout' };
  }

  const err = await page.evaluate(() => window.__CAPTURE_ERROR__ ?? null);
  if (err) {
    console.error(`APP ERROR ${shot}:\n${err}\n` + logs.slice(-30).join('\n'));
    return { shot, ok: false, reason: 'app-error', detail: String(err).slice(0, 2000) };
  }

  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  });
  if (!dataUrl) return { shot, ok: false, reason: 'no-canvas' };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const warn = logs.filter((l) => /\[pageerror\]|error/i.test(l)).slice(0, 5);
  return { shot, ok: true, out, warnings: warn };
}

async function main() {
  const shots = await readShots();
  const jobs = args.all
    ? shots.map((s) => ({
        shot: s.id,
        t: args.t ? Number(args.t) : s.t,
        out: resolve(ROOT, `refs/renders/${s.id}${args.tag ? `--${args.tag}` : ''}.png`),
      }))
    : [
        {
          shot: args.shot ?? 'wide-establishing',
          t: args.t ? Number(args.t) : (shots.find((s) => s.id === (args.shot ?? 'wide-establishing'))?.t ?? 3),
          out: resolve(ROOT, args.out ?? `refs/renders/${args.shot ?? 'wide-establishing'}.png`),
        },
      ];

  const port = await startServer();
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--disable-frame-rate-limit',
      '--js-flags=--max-old-space-size=4096',
    ],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  const results = [];
  for (const j of jobs) {
    const t0 = Date.now();
    const r = await renderOne(page, port, j);
    r.seconds = Math.round((Date.now() - t0) / 100) / 10;
    results.push(r);
    console.log(
      r.ok ? `ok   ${r.shot.padEnd(20)} ${r.seconds}s  -> ${r.out}` : `FAIL ${r.shot.padEnd(20)} ${r.reason}`,
    );
  }

  await browser.close();
  cleanup();
  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exit(4);
}

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
