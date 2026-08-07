#!/usr/bin/env node
/**
 * Can you SEE every man, and can you CLICK the one you are looking at?
 *
 * This is the gate on the play camera's angle, and it exists because the two things the
 * player asked for pull against each other. A lower, more oblique camera shows fuller
 * figures — which is the whole point — and the same lowering makes each man hide the man
 * behind him. Somewhere between "a plan drawing where every piece is a disc" and "a
 * cinematic angle where White's own back rank eclipses White's own pawns" there is an
 * angle that does both, and no amount of reasoning about it is worth one measurement.
 *
 * GROUND TRUTH IS THE POINT. Everything here is measured against the REAL carved meshes
 * via three.js raycasting, never against the game's own pick proxies. Testing the pick
 * proxy against the pick proxy is circular and would have happily passed the bug that
 * made the a2 pawn unselectable. So:
 *
 *   visible   how many grid rays land on this man with NOTHING nearer in the way
 *   total     how many land on him at all, occluded or not
 *   fraction  visible / total — 1.0 is a man standing clear, 0.0 is a man erased
 *   centroid  the middle of what you can actually see of him
 *
 * and then it CLICKS each centroid and asks the game which square it decided on. The
 * answer is read off the selection mark's own world position (the plates are named — see
 * `plate` in src/game/affordances.ts), because a FEN only moves once a whole move has been
 * made and "did clicking that pawn select that pawn" needs an answer before that.
 *
 *   node tools/selectcheck.mjs [--step=8] [--min-visible=0.15] [--json=out.json]
 *
 * Exit is non-zero if any man is invisible or if any click resolves to the wrong square.
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
/** Grid pitch in CSS pixels. 8 keeps a full sweep near a minute; 4 is four times that. */
const STEP = Number(args.step ?? 8);
/** Below this share of a man showing, "you can see the pieces" is not true. */
const MIN_VISIBLE = Number(args['min-visible'] ?? 0.15);

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__WC__, null, { timeout: 300000 });
await page.waitForTimeout(20000);

/**
 * Runs in the browser. Sweeps a grid over the canvas, raycasts the real piece meshes, and
 * reports per-man visible/total ray counts and the centroid of the visible set.
 */
const SWEEP = (step) => {
  const { world, pieces, THREE } = window.__WC__;
  const el = world.renderer.domElement;
  const b = el.getBoundingClientRect();
  const S = 2.35;
  const men = pieces.all().map((p) => {
    const x = p.group.position.x;
    const z = p.group.position.z;
    return {
      id: p.id,
      type: p.type,
      side: p.side,
      file: Math.round(3.5 - x / S),
      rank: Math.round(z / S + 3.5),
      group: p.group,
      visible: 0,
      total: 0,
      sx: 0,
      sy: 0,
    };
  });
  const byRoot = new Map(men.map((m) => [m.group, m]));
  /** Walk up to the object that `pieces.all()` handed us, so a hit on any sub-mesh counts. */
  const ownerOf = (obj) => {
    let o = obj;
    while (o) { const m = byRoot.get(o); if (m) return m; o = o.parent; }
    return null;
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groups = men.map((m) => m.group);
  let rays = 0;

  for (let y = 0; y < b.height; y += step) {
    for (let x = 0; x < b.width; x += step) {
      ndc.set((x / b.width) * 2 - 1, -((y / b.height) * 2) + 1);
      ray.setFromCamera(ndc, world.camera);
      const hits = ray.intersectObjects(groups, true);
      if (!hits.length) continue;
      rays++;
      // Nearest hit is what the eye sees; every distinct man hit at all counts toward
      // "would be visible if nothing were in front of him".
      const front = ownerOf(hits[0].object);
      if (front) { front.visible++; front.sx += x; front.sy += y; }
      const seen = new Set();
      for (const h of hits) {
        const o = ownerOf(h.object);
        if (o && !seen.has(o)) { seen.add(o); o.total++; }
      }
    }
  }

  return {
    rays,
    canvas: { width: b.width, height: b.height },
    men: men.map((m) => ({
      id: m.id,
      type: m.type,
      side: m.side,
      square: String.fromCharCode(97 + m.file) + (m.rank + 1),
      file: m.file,
      rank: m.rank,
      visible: m.visible,
      total: m.total,
      fraction: m.total ? +(m.visible / m.total).toFixed(3) : 0,
      centroid: m.visible
        ? { x: +(b.left + m.sx / m.visible).toFixed(1), y: +(b.top + m.sy / m.visible).toFixed(1) }
        : null,
    })),
  };
};

const sweep = await page.evaluate(SWEEP, STEP);

/** Which square the game currently believes is selected, off the named selection plate. */
const SELECTED = () => {
  const { world } = window.__WC__;
  let plate = null;
  world.scene.traverse((o) => { if (o.name === 'affordance-selection') plate = o; });
  if (!plate || !plate.visible) return null;
  const S = 2.35;
  return {
    file: Math.round(3.5 - plate.position.x / S),
    rank: Math.round(plate.position.z / S + 3.5),
  };
};

// Only men with a legal move can be SELECTED; the rest are visibly refused instead, and a
// refusal fades in 0.45 s which is under one frame on this renderer. In the start position
// that is White's eight pawns and two knights — which is exactly the hard set, because the
// pawns are the rank standing directly behind White's own court pieces.
const MOBILE = ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'b1', 'g1'];

const clicks = [];
for (const want of MOBILE) {
  const man = sweep.men.find((m) => m.square === want && m.side === 'white');
  if (!man || !man.centroid) { clicks.push({ square: want, ok: false, why: 'not visible at all' }); continue; }
  await page.mouse.click(man.centroid.x, man.centroid.y);
  await page.waitForTimeout(2200);
  const sel = await page.evaluate(SELECTED);
  const got = sel ? String.fromCharCode(97 + sel.file) + (sel.rank + 1) : null;
  clicks.push({
    square: want,
    clickedAt: man.centroid,
    visibleFraction: man.fraction,
    got,
    ok: got === want,
    why: got === want ? '' : got ? `selected ${got} instead` : 'nothing was selected',
  });
}

await browser.close();
cleanup();

const white = sweep.men.filter((m) => m.side === 'white');
const black = sweep.men.filter((m) => m.side === 'black');
const worst = [...sweep.men].sort((a, b) => a.fraction - b.fraction).slice(0, 6);
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? +s[s.length >> 1].toFixed(3) : 0;
};

const report = {
  gridStep: STEP,
  raysOnPieces: sweep.rays,
  canvas: sweep.canvas,
  men: sweep.men.length,
  visibility: {
    medianFractionWhite: med(white.map((m) => m.fraction)),
    medianFractionBlack: med(black.map((m) => m.fraction)),
    worstSix: worst.map((m) => ({ square: m.square, type: m.type, side: m.side, fraction: m.fraction })),
    belowThreshold: sweep.men.filter((m) => m.fraction < MIN_VISIBLE)
      .map((m) => ({ square: m.square, type: m.type, side: m.side, fraction: m.fraction })),
  },
  clicks,
  pageErrors: errors.slice(0, 5),
};
if (args.json) await writeFile(args.json, JSON.stringify({ report, sweep }, null, 2));
console.log(JSON.stringify(report, null, 2));

let bad = 0;
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) bad++; };

say(sweep.men.length === 32, `the sweep found ${sweep.men.length} men on the board (want 32)`);
say(sweep.rays > 500, `${sweep.rays} grid rays landed on a piece (want > 500, or the sweep missed the board)`);
say(report.visibility.belowThreshold.length === 0,
  `every man shows at least ${MIN_VISIBLE * 100}% of himself`
  + (report.visibility.belowThreshold.length
    ? ` — HIDDEN: ${report.visibility.belowThreshold.map((m) => `${m.square} ${m.type} ${m.fraction}`).join(', ')}`
    : ''));
for (const c of clicks) {
  say(c.ok, `clicking what you can see of ${c.square} selects ${c.square}`
    + (c.ok ? ` (visible ${c.visibleFraction})` : ` — ${c.why}`));
}

console.log(bad
  ? `\n${bad} FAILED`
  : `\nall selectability checks RAN and passed: 32 men, median visible `
    + `${report.visibility.medianFractionWhite} white / ${report.visibility.medianFractionBlack} black`);
process.exit(bad ? 1 : 0);
