#!/usr/bin/env node
/**
 * Look at the play view at the EDGES of its orbit envelope.
 *
 * The orbit is clamped to a band that was derived, not chosen: 47 to 66 degrees of
 * declination and plus or minus 18 of azimuth, each limit set by something that breaks
 * just outside it — the north wall culls, the near piers un-cull, file-neighbours' plinths
 * start overlapping. Derived limits are worth exactly as much as the assumptions behind
 * them, and every one of those assumptions is about what the room LOOKS like at that pose.
 *
 * So this drags the view to each corner of the band and writes a frame, which is the only
 * way to find out whether the derivation was right. `capture.mjs` cannot do it: the orbit
 * lives in the live rig and there is no URL that sets it.
 *
 *   node tools/orbitview.mjs [--out=refs/renders]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
}));
const OUT = resolve(ROOT, args.out ?? 'refs/renders');

/** Each corner of the envelope, plus the rest pose, as degrees to ask the rig for. */
const POSES = [
  { name: 'rest', az: 0, decl: 0 },
  { name: 'low', az: 0, decl: -40 },
  { name: 'high', az: 0, decl: +40 },
  { name: 'left', az: -40, decl: 0 },
  { name: 'low-left', az: -40, decl: -40 },
];

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(700, () => (s.destroy(), res(false)));
});

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
const cleanup = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);
for (let i = 0; i < 240; i++) { if (await portOpen(port)) break; await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 536 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
await page.waitForTimeout(20000);

/** Ask the rig directly. Deliberately NOT by synthesising drags — this is about the pose. */
const AIM = ([az, decl]) => {
  const { camera } = window.__WC__;
  camera.recentre();
  camera.orbit(az, decl);
};
const POSE = () => {
  const c = window.__WC__.world.camera;
  const t = [0, 1.4, 0];
  const dx = c.position.x - t[0], dy = c.position.y - t[1], dz = c.position.z - t[2];
  const r = Math.hypot(dx, dy, dz);
  return {
    eye: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
    declinationDeg: +((Math.asin(dy / r) * 180) / Math.PI).toFixed(1),
    azimuthDeg: +((Math.atan2(dx, -dz) * 180) / Math.PI).toFixed(1),
    near: +c.near.toFixed(2),
    frameWidth: +(c.right - c.left).toFixed(2),
  };
};

await mkdir(OUT, { recursive: true });
const report = [];
for (const p of POSES) {
  await page.evaluate(AIM, [p.az, p.decl]);
  // Several frames, so the resolution scaler and the shadow map settle before the grab.
  await page.waitForTimeout(9000);
  const pose = await page.evaluate(POSE);
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  const file = resolve(OUT, `play--orbit-${p.name}.png`);
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  report.push({ pose: p.name, asked: p, got: pose, file });
  console.log(`${p.name.padEnd(9)} declination ${String(pose.declinationDeg).padStart(5)}  `
    + `azimuth ${String(pose.azimuthDeg).padStart(6)}  near ${String(pose.near).padStart(6)}  `
    + `frame ${pose.frameWidth} m  -> ${file}`);
}
await browser.close();
cleanup();
if (errors.length) console.log('\npage errors:', errors.slice(0, 5));
