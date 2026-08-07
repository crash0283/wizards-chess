#!/usr/bin/env node
/**
 * What the SELECTION MARKS do to the picture — the one thing no capture can see.
 *
 * `game/affordances.ts` is constructed only when `world.capturing` is false, so every
 * marker in this game is invisible to `tools/capture.mjs` by construction. That is why the
 * complaint "the highlight erases the piece it is pointing at" has been argued about from
 * inference rather than measurement: the frames the numbers came off had no marks in them.
 *
 * So this drives the live app the way play-test.mjs does, picks a man up, and measures
 * three crops through the app's own camera:
 *
 *   the marked square      — did the ring erase the piece it is marking?
 *   a marked DESTINATION   — same question for the quiet-move embers
 *   an untouched neighbour — did the mark spill onto the man next door?
 *
 * and then clears the selection and re-measures the same crops, which is the only way to
 * catch a marker that is still burning on an empty square two moves later.
 *
 *   node tools/marktest.mjs [--from=e2] [--to=e4]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
}));
const sq = (s) => ({ file: s.charCodeAt(0) - 97, rank: Number(s[1]) - 1 });
const FROM = sq(args.from ?? 'e2');
const TO = sq(args.to ?? 'e4');
/** A man on the same rank as FROM, one file over — the collateral probe. */
const NEIGHBOUR = { file: FROM.file + 1 > 7 ? FROM.file - 1 : FROM.file + 1, rank: FROM.rank };

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
// Same viewport as handcheck.mjs, and for the same reason: this scene is fragment-bound
// under SwiftShader, and a bigger canvas is a slower frame, not a better measurement.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
await page.waitForTimeout(20000);

/**
 * Project a square through the app's LIVE camera, whatever projection is installed.
 *
 * `y` matters and is per-probe. A man is measured at 0.9 m, up in his body where he is on
 * screen; a MARKER lies flat on the slab at 0.055 m (see game/affordances.ts), and at a 62
 * degree declination those two are 15 px apart. Probing a flat ember at body height and
 * then averaging over a crop 1.4 squares wide is how a plainly visible mark measured as a
 * 0.0006 lift and got reported as missing.
 */
const project = (m, y = 0.9) => page.evaluate(([f, r, yy]) => {
  const { world, THREE } = window.__WC__;
  const S = 2.35;
  const v = new THREE.Vector3((3.5 - f) * S, yy, (r - 3.5) * S);
  v.project(world.camera);
  const b = world.renderer.domElement.getBoundingClientRect();
  return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((-v.y + 1) / 2) * b.height };
}, [m.file, m.rank, y]);

/** Runs in the browser: statistics for a square crop of the canvas, read back off the GPU. */
const CROP = ([spots, half]) => new Promise((res) => {
  const c = document.querySelector('canvas');
  const src = document.createElement('canvas');
  src.width = c.width; src.height = c.height;
  src.getContext('2d').drawImage(c, 0, 0);
  const g = src.getContext('2d', { willReadFrequently: true });
  const b = c.getBoundingClientRect();
  const out = {};
  for (const [name, p] of Object.entries(spots)) {
    // CSS pixels -> backing-store pixels; the game renders at a reduced buffer and scales up.
    const cx = Math.round(((p.x - b.left) / b.width) * c.width);
    const cy = Math.round(((p.y - b.top) / b.height) * c.height);
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const w = Math.min(c.width - x0, half * 2), h = Math.min(c.height - y0, half * 2);
    if (w <= 0 || h <= 0) { out[name] = null; continue; }
    const d = g.getImageData(x0, y0, w, h).data;
    const l = [];
    for (let i = 0; i < d.length; i += 4) l.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
    l.sort((a, z) => a - z);
    out[name] = {
      pixels: l.length,
      // MEAN, not just the median, and the mean is what the visibility assertions read.
      // A sigil is a thin figure over a few per cent of a crop: with a man selected, a mark
      // burning at opacity 0.408 and correctly placed moved this crop's MEDIAN by 0.002,
      // which reads exactly like a mark that is not there. The median describes the marble,
      // not the mark. The mean integrates it.
      mean: +(l.reduce((a, z) => a + z, 0) / l.length).toFixed(4),
      median: +l[l.length >> 1].toFixed(4),
      p99: +l[Math.floor(l.length * 0.99)].toFixed(4),
      peak: +l[l.length - 1].toFixed(4),
      fracBlown: +(l.filter((v) => v > 0.92).length / l.length).toFixed(4),
    };
  }
  res(out);
});

// The two piece probes are wide enough to hold a whole man and the square he stands on.
// The destination probe is tight and sits on the MARKER PLANE, because a quiet-move ember
// is 0.55 m across: spread over the wide crop it is 1.8% of the pixels, and no honest
// threshold can tell 1.8% of a soft mark from nothing.
const spots = {
  marked: await project(FROM),
  neighbour: await project(NEIGHBOUR),
};
const destSpot = { destination: await project(TO, 0.055) };
const HALF = 46;
const DEST_HALF = 13;

const before = { ...(await page.evaluate(CROP, [spots, HALF])),
  ...(await page.evaluate(CROP, [destSpot, DEST_HALF])) };
await page.mouse.click(spots.marked.x, spots.marked.y);
await page.waitForTimeout(2600);
const held = { ...(await page.evaluate(CROP, [spots, HALF])),
  ...(await page.evaluate(CROP, [destSpot, DEST_HALF])) };
// Keep the evidence. Every wrong conclusion in this area so far came from arguing about
// numbers without looking at the frame they were taken off.
//
// Read the canvas, never page.screenshot(): the latter waits for a stable frame and this
// scene renders at about one frame a second under SwiftShader, so it times out every time.
if (args.png) {
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  await writeFile(args.png, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
// Clicking well off the board clears the selection without moving anything.
await page.mouse.click(12, 12);
await page.waitForTimeout(2600);
const cleared = { ...(await page.evaluate(CROP, [spots, HALF])),
  ...(await page.evaluate(CROP, [destSpot, DEST_HALF])) };

const selected = await page.evaluate(() => !!document.querySelector('canvas'));
await browser.close();
cleanup();

const name = (m) => `${String.fromCharCode(97 + m.file)}${m.rank + 1}`;
console.log(JSON.stringify({
  from: name(FROM), to: name(TO), neighbour: name(NEIGHBOUR),
  cropPx: HALF * 2, destCropPx: DEST_HALF * 2, canvasPresent: selected,
  before, held, cleared,
  pageErrors: errors.slice(0, 5),
}, null, 2));

let bad = 0;
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) bad++; };

for (const [phase, set] of Object.entries({ before, held, cleared })) {
  for (const [k, v] of Object.entries(set)) {
    if (!v) { say(false, `${phase}.${k} crop fell outside the canvas — nothing was measured`); }
  }
}
if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }

// FIRST, and before any brightness claim: did the click select anything at all?
//
// The first version of this file asserted only "the mark does not blow the crop" and "the
// crop goes back where it was", and both of those are TRUE OF A GAME THAT IGNORED THE
// CLICK. It reported four passes on a run where nothing was ever selected. Every statement
// below is conditional on the mark actually being on the board, so that is measured first
// and it is a failure, not a skip.
const lift = (a, b) => +(a.mean - b.mean).toFixed(4);
const selLift = lift(held.marked, before.marked);
const destLift = lift(held.destination, before.destination);
say(selLift >= 0.010,
  `the selection mark LIT the square it is on: mean ${before.marked.mean} -> `
  + `${held.marked.mean} (+${selLift}, want >= +0.010 or it is not visible)`);
say(destLift >= 0.010,
  `the destination mark LIT ${name(TO)}: mean ${before.destination.mean} -> `
  + `${held.destination.mean} (+${destLift}, want >= +0.010)`);

say(held.marked.fracBlown <= 0.02,
  `marked square blows ${(held.marked.fracBlown * 100).toFixed(1)}% of its crop (want <= 2%)`);
say(held.marked.peak < 0.999,
  `marked square peaks at ${held.marked.peak} (want under 0.999 — the piece must survive)`);
say(Math.abs(held.neighbour.mean - before.neighbour.mean) <= 0.010,
  `neighbour mean moved ${before.neighbour.mean} -> ${held.neighbour.mean}`
  + ' (want no collateral spill)');
say(Math.abs(cleared.marked.mean - before.marked.mean) <= 0.006,
  `after clearing, the square returns to mean ${cleared.marked.mean}`
  + ` from ${before.marked.mean} (want it to go out)`);

console.log(bad ? `\n${bad} FAILED` : '\nall mark checks RAN and passed');
process.exit(bad ? 1 : 0);
