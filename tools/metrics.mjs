#!/usr/bin/env node
/**
 * Objective image statistics for a render (and, when present, its reference frame).
 * FROZEN — critics run this so their verdicts have numbers behind them, not vibes.
 *
 *   node tools/metrics.mjs refs/renders/wide-establishing.png [refs/frames/wide-establishing.jpg]
 *
 * Prints JSON. Decoding happens in a headless canvas so there is no image dependency.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: metrics.mjs <image> [reference]');
  process.exit(1);
}

const mime = (p) => (extname(p).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg');

async function toDataUrl(p) {
  const b = await readFile(resolve(p));
  return `data:${mime(p)};base64,${b.toString('base64')}`;
}

/**
 * Runs INSIDE the browser. Must be passed to page.evaluate as a real function —
 * passing it as a string makes Playwright treat it as an expression, which silently
 * yields undefined instead of results.
 */
const ANALYSE = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onerror = () => reject(new Error('decode failed'));
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const N = W * H;

    const lum = new Float32Array(N);
    const hist = new Uint32Array(256);
    let sumS = 0, litHueX = 0, litHueY = 0, litN = 0;

    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const r = d[p] / 255, gg = d[p+1] / 255, b = d[p+2] / 255;
      const L = 0.2126*r + 0.7152*gg + 0.0722*b;
      lum[i] = L;
      hist[Math.min(255, (L * 255) | 0)]++;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      sumS += sat;
      if (L > 0.25 && sat > 0.08) {
        let hue;
        const dl = mx - mn;
        if (dl === 0) hue = 0;
        else if (mx === r) hue = ((gg - b) / dl) % 6;
        else if (mx === gg) hue = (b - r) / dl + 2;
        else hue = (r - gg) / dl + 4;
        hue *= 60; if (hue < 0) hue += 360;
        const rad = hue * Math.PI / 180;
        litHueX += Math.cos(rad); litHueY += Math.sin(rad); litN++;
      }
    }

    let acc = 0, median = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= N / 2) { median = i / 255; break; } }
    let shadow = 0, deep = 0, blown = 0;
    for (let i = 0; i < 256; i++) {
      if (i / 255 < 0.04) deep += hist[i];
      if (i / 255 < 0.12) shadow += hist[i];
      if (i / 255 > 0.92) blown += hist[i];
    }

    // Entropy of the luminance histogram — flat/CG images score low.
    let H_ent = 0;
    for (let i = 0; i < 256; i++) { if (hist[i]) { const p2 = hist[i] / N; H_ent -= p2 * Math.log2(p2); } }

    // High-frequency energy per horizontal band (detail distribution top->bottom).
    const bands = 3, bandEnergy = new Array(bands).fill(0), bandCount = new Array(bands).fill(0);
    let totalHF = 0;
    for (let y = 1; y < H - 1; y++) {
      const band = Math.min(bands - 1, ((y / H) * bands) | 0);
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const lap = Math.abs(4*lum[i] - lum[i-1] - lum[i+1] - lum[i-W] - lum[i+W]);
        bandEnergy[band] += lap; bandCount[band]++; totalHF += lap;
      }
    }

    // Directional gradient anisotropy — motion blur reads as a strong axis preference.
    let gx2 = 0, gy2 = 0, gxy = 0;
    for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
      const i = y * W + x;
      const dx = lum[i+1] - lum[i-1], dy = lum[i+W] - lum[i-W];
      gx2 += dx*dx; gy2 += dy*dy; gxy += dx*dy;
    }
    const tr = gx2 + gy2, det = gx2*gy2 - gxy*gxy;
    const disc = Math.sqrt(Math.max(0, tr*tr/4 - det));
    const l1 = tr/2 + disc, l2 = tr/2 - disc;
    const anisotropy = l2 > 1e-9 ? l1 / l2 : 999;

    // Colour temperature split: fraction of lit pixels warm vs cool.
    let warm = 0, cool = 0;
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      if (lum[i] < 0.06) continue;
      if (d[p] > d[p+2] + 12) warm++;
      else if (d[p+2] > d[p] + 6) cool++;
    }

    resolve({
      width: W, height: H,
      medianLuminance: +median.toFixed(4),
      meanSaturation: +(sumS / N).toFixed(4),
      fracDeepShadow: +(deep / N).toFixed(4),
      fracShadow: +(shadow / N).toFixed(4),
      fracBlown: +(blown / N).toFixed(5),
      histogramEntropy: +H_ent.toFixed(3),
      meanLitHueDeg: litN ? +(((Math.atan2(litHueY, litHueX) * 180 / Math.PI) + 360) % 360).toFixed(1) : null,
      detailByBand: bandEnergy.map((e, i) => +(e / Math.max(1, bandCount[i])).toFixed(5)),
      detailTotal: +(totalHF / N).toFixed(5),
      gradientAnisotropy: +anisotropy.toFixed(3),
      warmFraction: +(warm / N).toFixed(4),
      coolFraction: +(cool / N).toFixed(4),
    });
  };
  img.src = url;
});

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const out = {};
for (const [i, f] of files.entries()) {
  if (!existsSync(f)) { out[i === 0 ? 'render' : 'reference'] = { error: 'missing: ' + f }; continue; }
  out[i === 0 ? 'render' : 'reference'] = await page.evaluate(ANALYSE, await toDataUrl(f));
}
await browser.close();

if (out.render && out.reference && !out.reference.error) {
  const d = {};
  for (const k of Object.keys(out.render)) {
    const a = out.render[k], b = out.reference[k];
    if (typeof a === 'number' && typeof b === 'number') d[k] = +(a - b).toFixed(4);
  }
  out.delta = d;
}
console.log(JSON.stringify(out, null, 2));
