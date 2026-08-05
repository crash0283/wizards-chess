import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
const [src, out] = process.argv.slice(2);
const e = extname(src).toLowerCase();
const mime = e === '.png' ? 'image/png' : e === '.webp' ? 'image/webp' : 'image/jpeg';
const b = await readFile(resolve(src));
const url = `data:${mime};base64,${b.toString('base64')}`;
const br = await chromium.launch(); const p = await br.newPage();
const r = await p.evaluate(async (url) => {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  let min = 1, minAt = null;
  const bins = [0, 0, 0, 0, 0, 0];
  for (let i = 0, q = 0; q < d.data.length; i++, q += 4) {
    const L = (0.2126 * d.data[q] + 0.7152 * d.data[q + 1] + 0.0722 * d.data[q + 2]) / 255;
    if (L < min) { min = L; minAt = [i % c.width, (i / c.width) | 0]; }
    for (let k = 0; k < 6; k++) if (L < 0.02 * (k + 1)) bins[k]++;
    // paint mask: red where below 0.04
    if (L < 0.04) { d.data[q] = 255; d.data[q + 1] = 0; d.data[q + 2] = 0; }
  }
  g.putImageData(d, 0, 0);
  return { min, minAt, bins: bins.map((v) => +(v / (c.width * c.height)).toFixed(4)), url: c.toDataURL('image/png') };
}, url);
if (out) await writeFile(out, Buffer.from(r.url.split(',')[1], 'base64'));
console.log(src, 'min=', r.min.toFixed(5), 'at', r.minAt, 'cumfrac<0.02,0.04,...0.12:', r.bins.join(' '));
await br.close();
