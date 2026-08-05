import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const files = process.argv.slice(2);
const PROBE = (url) => new Promise((res, rej) => {
  const img = new Image();
  img.onerror = () => rej(new Error('decode'));
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const buckets = new Array(12).fill(0);
    let litN = 0, satSum = 0, satN = 0;
    // saturation split by luminance decile
    const decSat = new Array(10).fill(0), decN = new Array(10).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255;
      const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const dec = Math.min(9, Math.floor(L * 10));
      decSat[dec] += sat; decN[dec]++;
      if (L > 0.25 && sat > 0.08) {
        const dl = mx - mn;
        let hue = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4;
        hue *= 60; if (hue < 0) hue += 360;
        buckets[Math.floor(hue / 30)]++; litN++;
      }
    }
    // named regions, mean sRGB 0-255
    const region = (x0, y0, x1, y1) => {
      let r = 0, gg = 0, b = 0, n = 0;
      for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
        for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
          const p = (y * W + x) * 4; r += d[p]; gg += d[p + 1]; b += d[p + 2]; n++;
        }
      return [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
    };
    res({
      litPixels: litN,
      hueBuckets: buckets.map((v, i) => [i * 30, +(v / Math.max(1, litN)).toFixed(3)]),
      satByDecile: decSat.map((v, i) => +(v / Math.max(1, decN[i])).toFixed(3)),
      pixByDecile: decN.map((v) => +(v / (W * H)).toFixed(3)),
      regions: {
        topVoid: region(0.35, 0.02, 0.65, 0.14),
        boardFar: region(0.42, 0.36, 0.58, 0.44),
        boardNear: region(0.42, 0.72, 0.58, 0.84),
        leftRanks: region(0.20, 0.45, 0.32, 0.70),
        rightRanks: region(0.68, 0.45, 0.80, 0.70),
        corner: region(0.01, 0.01, 0.10, 0.12),
      },
    });
  };
  img.src = url;
});

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
for (const f of files) {
  const b = await readFile(resolve(f));
  const mime = extname(f) === '.png' ? 'image/png' : extname(f) === '.webp' ? 'image/webp' : 'image/jpeg';
  const out = await page.evaluate(PROBE, `data:${mime};base64,${b.toString('base64')}`);
  console.log(f, JSON.stringify(out, null, 1));
}
await browser.close();
process.exit(0);
