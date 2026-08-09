#!/usr/bin/env node
/**
 * Is the animation SMOOTH — measured, per frame, on the thing that actually moves.
 *
 * "Smooth" is four different faults wearing one word, and they need separating before
 * anything can be fixed:
 *
 *   PACING   frames arriving unevenly
 *   CLOCK    frames even, but the motion samples time unevenly
 *   CURVE    the path itself has velocity discontinuities — corners, snaps, dead stops
 *   POPPING  discrete changes mid-move: an LOD swap, a resolution change
 *
 * WHAT THIS BOX CAN AND CANNOT TELL YOU, corrected by running it.
 *
 * Frame PACING here is meaningless: this runs under a software rasteriser, so any interval
 * statistic describes SwiftShader and not the player's machine.
 *
 * POPPING is measurable and trustworthy — an LOD swap or a canvas resize during the move is
 * a discrete event, and a discrete event either happened between two samples or it did not.
 *
 * The CURVE is NOT measurable here, and the first version of this file claimed otherwise.
 * The argument was that a velocity discontinuity is a property of the animation rather than
 * of the renderer and so shows up at any frame rate. That is true of the animation and
 * false of the MEASUREMENT: frames came 1.63 s apart, the whole walk landed on six samples,
 * and one of them recorded 108 m/s because the piece had crossed most of a square between
 * two of them. You cannot see the shape of a curve through six points spread over a corner.
 * So the curve assertion below refuses to run under a sample floor rather than reporting a
 * number it cannot support — and the real gate for pacing arithmetic is `tools/pacing.mjs`,
 * which reads the scheduler and the animation's speed law directly and needs no frames at
 * all.
 *
 * The instrument is a second requestAnimationFrame loop in the page. Browsers run every
 * rAF callback once per displayed frame, so it samples exactly the frames the player sees,
 * and it records the moving man's own world position rather than anything the game says
 * about him.
 *
 *   node tools/smoothtest.mjs [--from=b1] [--to=c3] [--frames=400]
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
/** A knight's move by default: two legs and a corner, which is where a join shows. */
const FROM = sq(args.from ?? 'b1');
const TO = sq(args.to ?? 'c3');
const FRAMES = Number(args.frames ?? 400);

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
// Small and cheap, to get enough frames that the SHAPE of the motion is visible. See header.
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
await page.waitForTimeout(20000);

/** Start a per-frame recorder for the man standing on `from`. */
const RECORD = ([f, r, n]) => {
  const { world, pieces } = window.__WC__;
  const S = 2.35;
  const want = pieces.all().find((p) => Math.round(3.5 - p.group.position.x / S) === f
    && Math.round(p.group.position.z / S + 3.5) === r);
  if (!want) return false;
  const canvas = world.renderer.domElement;
  /** The first mesh with geometry under the man — its identity changes when LOD swaps. */
  const geoOf = () => {
    let uuid = '';
    want.group.traverse((o) => { if (!uuid && o.geometry) uuid = o.geometry.uuid; });
    return uuid;
  };
  const log = [];
  let frames = 0;
  const tick = () => {
    log.push({
      ms: performance.now(),
      realTime: world.realTime,
      sceneTime: world.time,
      x: want.group.position.x,
      y: want.group.position.y,
      z: want.group.position.z,
      ry: want.group.rotation.y,
      cw: canvas.width,
      ch: canvas.height,
      geo: geoOf(),
    });
    if (++frames < n) requestAnimationFrame(tick);
    else window.__SMOOTH_DONE__ = true;
  };
  window.__SMOOTH__ = log;
  window.__SMOOTH_DONE__ = false;
  requestAnimationFrame(tick);
  return true;
};

const project = (m) => page.evaluate(([f, r]) => {
  const { world, THREE } = window.__WC__;
  const v = new THREE.Vector3((3.5 - f) * 2.35, 0.9, (r - 3.5) * 2.35);
  v.project(world.camera);
  const b = world.renderer.domElement.getBoundingClientRect();
  return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((-v.y + 1) / 2) * b.height };
}, [m.file, m.rank]);

const armed = await page.evaluate(RECORD, [FROM.file, FROM.rank, FRAMES]);
if (!armed) {
  console.error('FAIL  no man found on the from-square — nothing to measure');
  await browser.close(); cleanup(); process.exit(1);
}

const fenNow = () => page.evaluate(() => window.__WC__.game.state().fen.split(' ')[0]);
const before = await fenNow();
const a = await project(FROM);
const b = await project(TO);
await page.mouse.click(a.x, a.y);
await page.waitForTimeout(2000);
await page.mouse.click(b.x, b.y);

// The move must actually happen, or every statistic below describes a stationary piece.
let after = before;
for (let i = 0; i < 40 && after === before; i++) {
  await page.waitForTimeout(500);
  after = await fenNow();
}
if (after === before) {
  console.error(`FAIL  the move never happened — board still ${before}`);
  await browser.close(); cleanup(); process.exit(1);
}

await page.waitForFunction(() => window.__SMOOTH_DONE__ === true, null, { timeout: 300000 })
  .catch(() => {});
const log = await page.evaluate(() => window.__SMOOTH__);
await browser.close();
cleanup();

// --- reduce ------------------------------------------------------------------------------

const pct = (xs, p) => {
  const s = [...xs].sort((u, v) => u - v);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

/** Frames where the man actually moved, plus a little either side. */
const moved = [];
for (let i = 1; i < log.length; i++) {
  const d = Math.hypot(log[i].x - log[i - 1].x, log[i].y - log[i - 1].y, log[i].z - log[i - 1].z);
  moved.push({ i, d, dt: (log[i].ms - log[i - 1].ms) / 1000, dReal: log[i].realTime - log[i - 1].realTime });
}
const active = moved.filter((m) => m.d > 1e-4);
const firstMove = active.length ? active[0].i : -1;
const lastMove = active.length ? active[active.length - 1].i : -1;

/** Metres per second, per frame, over the moving stretch — the shape of the motion. */
const speeds = active.map((m) => (m.dt > 0 ? m.d / m.dt : 0));
const medSpeed = pct(speeds, 0.5);
/** Frame-to-frame change in speed, normalised. A smooth ease stays well under 1. */
const jerks = [];
for (let i = 1; i < speeds.length; i++) {
  if (medSpeed > 0) jerks.push(Math.abs(speeds[i] - speeds[i - 1]) / medSpeed);
}

/** Gaps inside the movement: frames where the man was stationary between two moving ones. */
let stalls = 0;
let longestStall = 0;
if (firstMove >= 0) {
  let run = 0;
  for (const m of moved) {
    if (m.i < firstMove || m.i > lastMove) continue;
    if (m.d <= 1e-4) { run++; longestStall = Math.max(longestStall, run); } else run = 0;
    if (run === 1) stalls++;
  }
}

const canvasChanges = [];
const geoChanges = [];
for (let i = 1; i < log.length; i++) {
  if (log[i].cw !== log[i - 1].cw || log[i].ch !== log[i - 1].ch) {
    canvasChanges.push({ frame: i, from: `${log[i - 1].cw}x${log[i - 1].ch}`, to: `${log[i].cw}x${log[i].ch}`,
      duringMove: i >= firstMove && i <= lastMove });
  }
  if (log[i].geo !== log[i - 1].geo) {
    geoChanges.push({ frame: i, duringMove: i >= firstMove && i <= lastMove });
  }
}

/** Does the clock the motion runs on advance evenly? */
const realSteps = moved.filter((m) => m.i >= firstMove && m.i <= lastMove).map((m) => m.dReal);
const medReal = pct(realSteps, 0.5);

const report = {
  framesRecorded: log.length,
  movingFrames: active.length,
  moveSpanFrames: firstMove >= 0 ? lastMove - firstMove + 1 : 0,
  motion: {
    medianSpeed: +medSpeed.toFixed(4),
    p95Speed: +pct(speeds, 0.95).toFixed(4),
    maxSpeed: +Math.max(...speeds, 0).toFixed(4),
    // The headline smoothness number: how violently speed changes between frames.
    medianJerk: +pct(jerks, 0.5).toFixed(3),
    p95Jerk: +pct(jerks, 0.95).toFixed(3),
    maxJerk: +Math.max(...jerks, 0).toFixed(3),
    framesWithJerkOver1: jerks.filter((j) => j > 1).length,
  },
  stalls: { count: stalls, longestRunFrames: longestStall },
  popping: {
    canvasResizes: canvasChanges.length,
    canvasResizesDuringMove: canvasChanges.filter((c) => c.duringMove).length,
    detail: canvasChanges.slice(0, 8),
    lodSwaps: geoChanges.length,
    lodSwapsDuringMove: geoChanges.filter((g) => g.duringMove).length,
  },
  clock: {
    medianRealStep: +medReal.toFixed(4),
    p95RealStep: +pct(realSteps, 0.95).toFixed(4),
  },
  pageErrors: errors.slice(0, 5),
};
if (args.json) await writeFile(args.json, JSON.stringify({ report, log }, null, 2));
console.log(JSON.stringify(report, null, 2));

let bad = 0;
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) bad++; };

/** Samples across the move below which its SHAPE cannot honestly be judged. See the header. */
const CURVE_MIN_SAMPLES = 30;
say(active.length >= 6,
  `the man moved on ${active.length} frames (want >= 6, or there is nothing to judge)`);
// A stall is only a stall if a frame was actually drawn during it; at one frame a second
// every animation looks like it stops. Judged under the same sample floor as the curve.
if (active.length >= CURVE_MIN_SAMPLES) {
  say(report.stalls.count === 0,
    `the man never stops mid-move (${report.stalls.count} stalls, longest`
    + ` ${report.stalls.longestRunFrames} frames)`);
}
say(report.popping.lodSwapsDuringMove === 0,
  `no LOD swap while he is walking (${report.popping.lodSwapsDuringMove})`);
say(report.popping.canvasResizesDuringMove === 0,
  `no resolution change while he is walking (${report.popping.canvasResizesDuringMove})`);
// Only meaningful with enough samples ACROSS the move to see its shape. Under that, this
// says so and fails, rather than reporting a jerk figure that is really a frame rate.
if (active.length >= CURVE_MIN_SAMPLES) {
  say(report.motion.p95Jerk < 1.0,
    `speed changes smoothly: 95th percentile jerk ${report.motion.p95Jerk} (want < 1.0)`);
} else {
  say(false,
    `the curve CANNOT be judged here: the move landed on ${active.length} sampled frames`
    + ` (need ${CURVE_MIN_SAMPLES}). Frames are ${report.clock.medianRealStep}s apart on this`
    + ' renderer. Run tools/pacing.mjs instead — it checks the arithmetic without frames.');
}

console.log(bad ? `\n${bad} FAILED` : '\nall smoothness checks RAN and passed');
process.exit(bad ? 1 : 0);
