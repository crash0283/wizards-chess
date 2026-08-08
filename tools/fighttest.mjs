#!/usr/bin/env node
/**
 * Does the camera actually SHOW the fight — and does it let go afterwards?
 *
 * The capture push-in is a frustum move: the camera never travels, the frame tightens onto
 * the two men and recentres, then releases. That makes it invisible to every existing check
 * in this project. `capture.mjs` cannot see it (it renders one frozen instant of a scripted
 * timeline, and the push-in is interactive-only), and a screenshot cannot tell a tighter
 * frustum from a bigger board.
 *
 * The frustum itself can, so this reads it. It stages a position where White has a capture
 * available, plays it, and samples `right - left` off the live camera about ten times a
 * second while the capture runs. Three things have to be true, and the third is the one
 * that matters most: the frame has to come BACK. A push-in that sticks is worse than none,
 * and the failure mode is a lost promise or an interrupted move, neither of which a
 * screenshot taken at the right moment would ever reveal.
 *
 *   node tools/fighttest.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * White pawn b4, Black pawn a5 — White to move, and bxa5 is a legal capture.
 *
 * Deliberately out at the a-file rather than in the middle of the board. A capture near the
 * centre is already near the frame's own axis, so there is almost nothing to recentre and a
 * recentring test run there measures nothing; a5 sits 8.2 m off the lens axis.
 */
const FEN = 'rnbqkbnr/1ppppppp/8/p7/1P6/8/P1PPPPPP/RNBQKBNR w KQkq - 0 2';
const FROM = { file: 1, rank: 3 };   // b4
const TO = { file: 0, rank: 4 };     // a5

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
/**
 * Small and cheap on purpose, and this is not a detail.
 *
 * The push-in is a 2.3 second gesture in REAL time. Observing it needs frames, and this
 * scene under SwiftShader with a piece shattering in it does not produce them: at
 * 1280x720 a run of this test advanced `world.realTime` by 0.52 s over 54 s of wall clock
 * — roughly one frame — and the frustum simply held whatever the last drawn frame left in
 * it. That reads exactly like a camera stuck pushed in, and it is not: it is a renderer
 * that stopped. Frame cost here is fragment cost, so a quarter of the pixels is most of an
 * order of magnitude of frames back.
 */
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// No ?shot / ?t, so the app runs interactively and accepts clicks; ?fen stages the position.
await page.goto(`http://127.0.0.1:${port}/?quality=low&fen=${encodeURIComponent(FEN)}`,
  { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
await page.waitForTimeout(20000);

const project = (m) => page.evaluate(([f, r]) => {
  const { world, THREE } = window.__WC__;
  const v = new THREE.Vector3((3.5 - f) * 2.35, 0.9, (r - 3.5) * 2.35);
  v.project(world.camera);
  const b = world.renderer.domElement.getBoundingClientRect();
  return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((-v.y + 1) / 2) * b.height };
}, [m.file, m.rank]);

/** Frame width in world metres, plus where its centre sits — the whole push-in, observed. */
const FRUSTUM = () => {
  const c = window.__WC__.world.camera;
  return {
    ortho: !!c.isOrthographicCamera,
    width: c.right - c.left,
    cx: (c.right + c.left) / 2,
    cy: (c.top + c.bottom) / 2,
    eye: [+c.position.x.toFixed(4), +c.position.y.toFixed(4), +c.position.z.toFixed(4)],
    // The clock the push-in is driven by, and the scene clock beside it. If the frustum
    // freezes, these say whether the envelope stalled or the frame loop did.
    realTime: +window.__WC__.world.realTime.toFixed(2),
    sceneTime: +window.__WC__.world.time.toFixed(2),
  };
};

const rest = await page.evaluate(FRUSTUM);
if (!rest.ortho) {
  console.error('FAIL  the play camera is not orthographic — nothing below is meaningful');
  await browser.close(); cleanup(); process.exit(1);
}

const FEN_NOW = () => window.__WC__.game.state().fen.split(' ')[0];
const beforeFen = await page.evaluate(FEN_NOW);

const fromPt = await project(FROM);
const toPt = await project(TO);
await page.mouse.click(fromPt.x, fromPt.y);
await page.waitForTimeout(2500);
await page.mouse.click(toPt.x, toPt.y);

// PRECONDITION, not a nicety. Everything below describes a camera reacting to a capture,
// and all of it is trivially true of a capture that never happened — a frustum that never
// moves passes "it came back" perfectly. So the move is confirmed FIRST, and if the board
// did not change this exits rather than reporting four cheerful passes.
let afterFen = beforeFen;
for (let i = 0; i < 40 && afterFen === beforeFen; i++) {
  await page.waitForTimeout(500);
  afterFen = await page.evaluate(FEN_NOW);
}
if (afterFen === beforeFen) {
  console.error(`FAIL  the capture never happened — board still ${beforeFen}`);
  console.error(`      clicked ${JSON.stringify(fromPt)} then ${JSON.stringify(toPt)}`);
  console.error(`      page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  await browser.close(); cleanup(); process.exit(1);
}

// Sample across the whole capture: approach, poise, strike, contact, follow, step-in.
//
// Sampled for a long time on purpose. `runSequence` stretches every phase to a minimum
// number of MEASURED FRAMES, so on a renderer taking seconds a frame the approach alone
// runs far past its nominal duration — an 18 s window ended just as the push-in began and
// reported it as stuck, because the last sample it took was the tightest one.
const samples = [];
for (let i = 0; i < 300; i++) {
  samples.push(await page.evaluate(FRUSTUM));
  await page.waitForTimeout(150);
}
// And then a reading taken well after everything must be over. The sampling window can
// end mid-gesture by luck; this cannot. If the frame is still tight here it is stuck.
await page.waitForTimeout(9000);
const settled = await page.evaluate(FRUSTUM);
await browser.close();
cleanup();

const widths = samples.map((s) => s.width);
const minW = Math.min(...widths);
const tight = minW / rest.width;
const finalW = widths[widths.length - 1];
const eyesMoved = samples.filter((s) => s.eye.some((v, i) => Math.abs(v - rest.eye[i]) > 0.02)).length;
const offCentre = Math.max(...samples.map((s) => Math.hypot(s.cx - rest.cx, s.cy - rest.cy)));

console.log(JSON.stringify({
  boardBefore: beforeFen,
  boardAfter: afterFen,
  realTimeSpanSeconds: +(samples[samples.length - 1].realTime - samples[0].realTime).toFixed(2),
  distinctFrustumWidths: new Set(widths.map((w) => w.toFixed(3))).size,
  restWidthMetres: +rest.width.toFixed(3),
  tightestWidthMetres: +minW.toFixed(3),
  tightestFraction: +tight.toFixed(3),
  finalWidthMetres: +finalW.toFixed(3),
  maxRecentreMetres: +offCentre.toFixed(3),
  framesWhereTheEyeMoved: eyesMoved,
  minAtSample: widths.indexOf(minW) + '/' + widths.length,
  settledWidthMetres: +settled.width.toFixed(3),
  widthTrace: widths.filter((w, i) => i === 0 || Math.abs(w - widths[i - 1]) > 0.01)
    .map((w) => +w.toFixed(2)),
  pageErrors: errors.slice(0, 5),
}, null, 2));

let bad = 0;
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) bad++; };

say(samples[samples.length - 1].realTime - samples[0].realTime > 5,
  `the clock advanced ${(samples[samples.length - 1].realTime - samples[0].realTime).toFixed(1)} s`
  + ' while sampling (want > 5 s, or the frame loop stalled and nothing below means anything)');
say(tight <= 0.85,
  `the frame tightened to ${(tight * 100).toFixed(0)}% of its resting width (want <= 85%)`);
say(offCentre > 1.0,
  `it recentred by ${offCentre.toFixed(2)} m on the two men (want > 1 m, or it only zoomed)`);
say(Math.abs(settled.width - rest.width) < 0.05,
  `and it CAME BACK: settled at ${settled.width.toFixed(2)} m against`
  + ` ${rest.width.toFixed(2)} m at rest`);
say(eyesMoved === 0,
  `the eye never moved (${eyesMoved} frames off its rest position) — a pose move would`
  + ' re-solve the ceiling cut and the pier cutback');

console.log(bad ? `\n${bad} FAILED` : '\nall capture-camera checks RAN and passed');
process.exit(bad ? 1 : 0);
