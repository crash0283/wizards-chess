import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
// zc.mjs <src> <out> <x> <y> <w> <h> <scale> [gamma]
const [src, out, x, y, w, h, scale, gamma] = process.argv.slice(2);
const e = extname(src).toLowerCase();
const mime = e === '.png' ? 'image/png' : e === '.webp' ? 'image/webp' : 'image/jpeg';
const b = await readFile(resolve(src));
const url = `data:${mime};base64,${b.toString('base64')}`;
const br = await chromium.launch(); const p = await br.newPage();
const data = await p.evaluate(async ([url, x, y, w, h, s, gam]) => {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  if (gam && gam !== 1) {
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4)
      for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, 255 * Math.pow(d.data[i + k] / 255, 1 / gam));
    g.putImageData(d, 0, 0);
  }
  return c.toDataURL('image/png');
}, [url, +x, +y, +w, +h, +scale, gamma ? +gamma : 1]);
await writeFile(out, Buffer.from(data.split(',')[1], 'base64'));
await br.close();
console.log('wrote', out);
