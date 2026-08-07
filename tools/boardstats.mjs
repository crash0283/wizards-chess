#!/usr/bin/env node
/**
 * What the BOARD is doing, square by square, in a captured play frame.
 *
 * `tools/metrics.mjs` measures whole frames, and on the play view it says the picture is
 * fine: fracBlown 0.00041, median luminance 0.106, nothing clipping anywhere. Look at the
 * same frame and the middle of the board is a glare. Both are true. The board is 18% of
 * the picture and the other 82% is a dark blue room, so a board that is far too bright for
 * what it is barely moves a whole-frame statistic — which is exactly how "the middle of
 * the board is too blown out" survived three rounds of whole-frame numbers saying it had
 * been fixed.
 *
 * So this measures the board and only the board, and it separates the two populations that
 * matter — the cream squares and the navy ones — because the complaint is about ONE of
 * them and an average over both hides it.
 *
 *   node tools/boardstats.mjs refs/renders/play--try62.png
 *
 * The square centres are projected through the same parallel frustum the app installs,
 * solved here from `src/core/shots.ts` and `src/core/constants.ts` rather than hard-coded,
 * so re-aiming PLAY_SHOT re-aims this too and the numbers stay comparable across angles.
 * Ranks 3-6 are sampled by default: the four EMPTY middle ranks, so no piece contaminates
 * a reading meant to describe marble.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: boardstats.mjs <play-render.png> [--ranks=3-6] [--patch=18]');
  process.exit(1);
}
const opt = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return [m[1], m[2] ?? 'true'];
  }),
);
const [rank0, rank1] = (opt.ranks ?? '3-6').split('-').map(Number);
/** Half-width of the patch sampled at each square centre, px. Stays inside the slab. */
const PATCH = Number(opt.patch ?? 18);

// --- read the frozen constants out of source, never re-typed -----------------------------

const constants = await readFile(resolve(ROOT, 'src/core/constants.ts'), 'utf8');
const shots = await readFile(resolve(ROOT, 'src/core/shots.ts'), 'utf8');

const num = (src, re, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`could not read ${label} from source`);
  return Number(m[1]);
};

const SQUARE = num(constants, /export const SQUARE = ([0-9.]+)/, 'SQUARE');
const KING = num(constants, /king: ([0-9.]+)/, 'PIECE_HEIGHT.king');

const play = shots.slice(shots.indexOf('export const PLAY_SHOT'));
const triple = (re, label) => {
  const m = play.match(re);
  if (!m) throw new Error(`could not read ${label} from PLAY_SHOT`);
  return m[1].split(',').map((s) => Number(s.trim()));
};
const EYE = triple(/eye: \[([^\]]+)\]/, 'eye');
const TARGET = triple(/target: \[([^\]]+)\]/, 'target');

// --- replicate camera/ortho.ts's solve ----------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

const fwd = norm(sub(TARGET, EYE));
const right = norm(cross(fwd, [0, 1, 0]));
const up = cross(right, fwd);

const MARGIN = 1.05;
const half = SQUARE * 4;
let halfX = 0;
let lo = Infinity;
let hi = -Infinity;
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    for (const y of [0, KING]) {
      const v = sub([sx * half, y, sz * half], EYE);
      halfX = Math.max(halfX, Math.abs(dot(v, right)));
      const ty = dot(v, up);
      lo = Math.min(lo, ty);
      hi = Math.max(hi, ty);
    }
  }
}
const FIT = { halfX: halfX * MARGIN, halfY: ((hi - lo) / 2) * MARGIN, centreY: (hi + lo) / 2 };

const squareCentre = (f, r) => [(3.5 - f) * SQUARE, 0, (r - 3.5) * SQUARE];

function project(P, W, H) {
  const aspect = W / H;
  const halfH = Math.max(FIT.halfY, FIT.halfX / aspect);
  const halfW = halfH * aspect;
  const v = sub(P, EYE);
  const ndcX = dot(v, right) / halfW;
  const ndcY = (dot(v, up) - FIT.centreY) / halfH;
  return { x: ((ndcX + 1) / 2) * W, y: ((1 - ndcY) / 2) * H };
}

// --- sample -------------------------------------------------------------------------------

const b = await readFile(resolve(file));
const url = `data:image/png;base64,${b.toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

/** Runs in the browser. A real function reference, never a string — see metrics.mjs. */
const SAMPLE = ([dataUrl, spots, patch]) => new Promise((res, rej) => {
  const img = new Image();
  img.onerror = () => rej(new Error('decode failed'));
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const out = [];
    for (const s of spots) {
      const px = [];
      for (let y = Math.round(s.y) - patch; y <= Math.round(s.y) + patch; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = Math.round(s.x) - patch; x <= Math.round(s.x) + patch; x++) {
          if (x < 0 || x >= W) continue;
          const i = (y * W + x) * 4;
          px.push([d[i], d[i + 1], d[i + 2]]);
        }
      }
      out.push({ ...s, px });
    }
    res({ W, H, out });
  };
  img.src = dataUrl;
});

const probe = await page.evaluate(SAMPLE, [url, [{ x: 0, y: 0 }], 0]);
const { W, H } = probe;

const spots = [];
for (let r = rank0; r <= rank1; r++) {
  for (let f = 0; f <= 7; f++) {
    const p = project(squareCentre(f, r), W, H);
    // (file + rank) odd is a light square — isLightSquare in core/constants.ts.
    spots.push({ ...p, file: f, rank: r, cream: (f + r) % 2 === 1 });
  }
}

const { out } = await page.evaluate(SAMPLE, [url, spots, PATCH]);
await browser.close();

// --- report --------------------------------------------------------------------------------

const lum = ([r, g, bl]) => (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
const pct = (sorted, p) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;

function describe(rows) {
  const px = rows.flatMap((s) => s.px);
  if (!px.length) return null;
  const l = px.map(lum).sort((a, b) => a - b);
  const chan = [0, 1, 2].map((i) => px.map((p) => p[i]).sort((a, b) => a - b));
  return {
    squares: rows.length,
    pixels: px.length,
    medianRGB: chan.map((c) => pct(c, 0.5)),
    medianLuminance: +pct(l, 0.5).toFixed(4),
    p95: +pct(l, 0.95).toFixed(4),
    p99: +pct(l, 0.99).toFixed(4),
    peak: +l[l.length - 1].toFixed(4),
    // The metric the film grade is judged on, applied to the board alone.
    fracOver92: +(l.filter((v) => v > 0.92).length / l.length).toFixed(5),
    fracOver80: +(l.filter((v) => v > 0.80).length / l.length).toFixed(5),
  };
}

const inFrame = out.filter((s) => s.px.length > 0);
const cream = inFrame.filter((s) => s.cream);
const navy = inFrame.filter((s) => !s.cream);

const report = {
  image: file,
  size: `${W}x${H}`,
  ranksSampled: `${rank0}-${rank1}`,
  squaresProjectedInFrame: `${inFrame.length}/${out.length}`,
  cream: describe(cream),
  navy: describe(navy),
};
if (report.cream && report.navy) {
  report.chequerSeparation = +(report.cream.medianLuminance - report.navy.medianLuminance).toFixed(4);
}
console.log(JSON.stringify(report, null, 2));
