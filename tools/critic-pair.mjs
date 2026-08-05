#!/usr/bin/env node
/**
 * Build the critic's viewing material for one shot.
 * FROZEN — critics run this, they do not hand-roll comparisons.
 *
 *   node tools/critic-pair.mjs --shot=wide-establishing --round=3
 *
 * If refs/frames/<shot>.(jpg|png) exists, this composites a BLIND side-by-side:
 * the render and the film frame are placed as panel A and panel B in a seeded random
 * order, letterboxed to a common size, and the answer is written to
 * .critic-keys/<shot>-r<round>.json — which the critic must NOT read until after it
 * has committed to a verdict.
 *
 * If no reference frame exists (the frame sources are blocked in this environment),
 * it emits the render alone plus a pointer to that shot's brief, and the critic judges
 * "film frame or render?" against the brief instead.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const shot = args.shot;
const round = Number(args.round ?? 1);
if (!shot) { console.error('need --shot'); process.exit(1); }

const render = resolve(ROOT, args.render ?? `refs/renders/${shot}.png`);
if (!existsSync(render)) { console.error(`no render at ${render} — run tools/capture.mjs first`); process.exit(2); }

const refCandidates = ['jpg', 'jpeg', 'png', 'webp'].map((e) => resolve(ROOT, `refs/frames/${shot}.${e}`));
const reference = refCandidates.find((p) => existsSync(p)) ?? null;

const mime = (p) => ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(p).toLowerCase()] ?? 'image/jpeg';
const dataUrl = async (p) => `data:${mime(p)};base64,${(await readFile(p)).toString('base64')}`;

if (!reference) {
  console.log(JSON.stringify({
    mode: 'brief-only',
    shot,
    round,
    render,
    brief: 'refs/SHOT_BRIEFS.md',
    note: 'No reference frame present (sources blocked by egress policy). Judge the render against '
        + `the "${shot}" section of refs/SHOT_BRIEFS.md and answer: film frame, or render?`,
  }, null, 2));
  process.exit(0);
}

// Seeded coin flip so a round is reproducible but the critic cannot predict the order.
let h = 2166136261 >>> 0;
for (const ch of `${shot}:${round}:pairing`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
const renderIsA = ((h >>> 0) % 2) === 0;

const COMPOSITE = `async ([aUrl, bUrl]) => {
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const [a, b] = await Promise.all([load(aUrl), load(bUrl)]);
  const PW = 1280, PH = Math.round(PW / (a.naturalWidth / a.naturalHeight));
  const GAP = 24, LABEL = 44;
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH * 2 + GAP + LABEL * 2;
  const g = c.getContext('2d');
  g.fillStyle = '#101010'; g.fillRect(0, 0, c.width, c.height);
  const fit = (img, y) => {
    const s = Math.min(PW / img.naturalWidth, PH / img.naturalHeight);
    const w = img.naturalWidth * s, hh = img.naturalHeight * s;
    g.drawImage(img, (PW - w) / 2, y + (PH - hh) / 2, w, hh);
  };
  g.font = '600 26px ui-monospace, monospace'; g.fillStyle = '#e8e8e8';
  g.fillText('A', 14, 32); fit(a, LABEL);
  g.fillText('B', 14, LABEL + PH + GAP + 32); fit(b, LABEL * 2 + PH + GAP);
  return c.toDataURL('image/png');
}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const [uA, uB] = renderIsA
  ? [await dataUrl(render), await dataUrl(reference)]
  : [await dataUrl(reference), await dataUrl(render)];
const out = await page.evaluate(COMPOSITE, [uA, uB]);
await browser.close();

await mkdir(resolve(ROOT, 'refs/pairs'), { recursive: true });
await mkdir(resolve(ROOT, '.critic-keys'), { recursive: true });
const pairPath = resolve(ROOT, `refs/pairs/${shot}-r${round}.png`);
await writeFile(pairPath, Buffer.from(out.split(',')[1], 'base64'));
await writeFile(
  resolve(ROOT, `.critic-keys/${shot}-r${round}.json`),
  JSON.stringify({ shot, round, movieIs: renderIsA ? 'B' : 'A', renderIs: renderIsA ? 'A' : 'B' }, null, 2),
);

console.log(JSON.stringify({
  mode: 'blind-pair',
  shot, round,
  pair: pairPath,
  instruction: 'One of A / B is a frame from the film; the other is our render. Decide which is the '
             + 'film, state your confidence, then name the single biggest tell. Do NOT open .critic-keys/.',
}, null, 2));
