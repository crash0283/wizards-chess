#!/usr/bin/env node
/**
 * Regenerate progress.html from state/progress.json.
 * FROZEN — builders and critics update the JSON; this renders it.
 *
 *   node tools/progress.mjs
 *
 * Renders are downscaled and inlined as data URIs so the page is one self-contained
 * file that can be opened or shared anywhere.
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const state = JSON.parse(await readFile(resolve(ROOT, 'state/progress.json'), 'utf8'));

const mime = (p) => ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(p).toLowerCase()] ?? 'image/jpeg';

const SHRINK = `async ([url, maxW]) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.74);
}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const cache = new Map();
async function inline(rel, maxW = 820) {
  if (!rel) return null;
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return null;
  const key = `${p}:${maxW}`;
  if (cache.has(key)) return cache.get(key);
  const raw = `data:${mime(p)};base64,${(await readFile(p)).toString('base64')}`;
  const small = await page.evaluate(SHRINK, [raw, maxW]);
  cache.set(key, small);
  return small;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_ORDER = { failing: 0, building: 1, critiqued: 2, improving: 3, passed: 4 };

let cards = '';
for (const p of state.pieces) {
  const renderImg = await inline(p.render);
  const refImg = await inline(p.reference);
  const rounds = (p.history ?? []).length;

  const verdictClass =
    p.verdict === 'indistinguishable' ? 'v-pass' : p.verdict === 'render' ? 'v-fail' : 'v-mid';

  const historyRows = (p.history ?? [])
    .slice()
    .reverse()
    .slice(0, 6)
    .map(
      (h) => `<tr><td class="rnd">r${esc(h.round)}</td><td class="vd ${
        h.verdict === 'indistinguishable' ? 'v-pass' : 'v-fail'
      }">${esc(h.verdict)}</td><td>${esc(h.gap)}</td></tr>`,
    )
    .join('');

  cards += `
  <section class="card" data-status="${esc(p.status)}">
    <header>
      <div class="titles">
        <h2>${esc(p.label)}</h2>
        <p class="sub">${esc(p.blurb ?? '')}</p>
      </div>
      <div class="badges">
        <span class="badge round">round ${esc(p.round ?? 0)}</span>
        <span class="badge status s-${esc(p.status)}">${esc(p.status)}</span>
      </div>
    </header>

    <div class="frames">
      <figure>
        <figcaption>our render &middot; ${esc(p.shot ?? '')}</figcaption>
        ${renderImg ? `<img src="${renderImg}" alt="render">` : `<div class="missing">no render yet</div>`}
      </figure>
      <figure>
        <figcaption>reference &middot; ${esc(p.shot ?? '')}</figcaption>
        ${
          refImg
            ? `<img src="${refImg}" alt="reference frame">`
            : `<div class="missing brief"><strong>reference frame unavailable</strong>
                 <span>All four frame sources are blocked by this session's egress policy (403 at the
                 gateway). Judged against the written brief for this shot in
                 <code>refs/SHOT_BRIEFS.md</code> instead. Drop a frame at
                 <code>refs/frames/${esc(p.shot ?? '')}.jpg</code> and the critic switches to blind A/B
                 automatically.</span></div>`
        }
      </figure>
    </div>

    <div class="critique ${verdictClass}">
      <div class="verdict-line">
        <span class="label">critic's call</span>
        <strong>${esc(p.verdict ?? '—')}</strong>
        ${p.confidence ? `<span class="conf">${esc(p.confidence)} confidence</span>` : ''}
      </div>
      <p class="gap"><span class="label">biggest remaining gap</span>${esc(p.biggestGap ?? '—')}</p>
      ${p.critiqueDetail ? `<p class="detail">${esc(p.critiqueDetail)}</p>` : ''}
      ${p.metrics ? `<pre class="metrics">${esc(p.metrics)}</pre>` : ''}
    </div>

    ${
      historyRows
        ? `<details class="history"><summary>${rounds} round${rounds === 1 ? '' : 's'} of critique</summary>
           <table>${historyRows}</table></details>`
        : ''
    }
  </section>`;
}

const passed = state.pieces.filter((p) => p.status === 'passed').length;
const total = state.pieces.length;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wizard's Chess — build progress</title>
<style>
  :root{--bg:#0d0c0b;--panel:#17150f;--panel2:#1e1b14;--line:#332c20;--ink:#e8ddc8;--dim:#9c8d74;
        --warm:#d9a05b;--pass:#7fb069;--fail:#c4644f;--mid:#c9a227;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;}
  .wrap{max-width:1180px;margin:0 auto;padding:40px 24px 96px}
  h1{font-size:30px;margin:0 0 6px;letter-spacing:-.015em;font-weight:650}
  .lede{color:var(--dim);margin:0 0 8px;max-width:76ch}
  .meta{color:var(--dim);font:12.5px/1.5 ui-monospace,Menlo,monospace;margin-bottom:26px}
  .banner{background:#2a1c14;border:1px solid #573career;border-color:#5a3a22;border-radius:10px;
          padding:14px 16px;margin:0 0 30px;color:#e6c9a8;font-size:14px}
  .banner strong{color:#f0b978}
  .tally{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 30px}
  .pill{background:var(--panel);border:1px solid var(--line);border-radius:999px;
        padding:5px 13px;font:12.5px ui-monospace,monospace;color:var(--dim)}
  .pill b{color:var(--ink)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;
        padding:22px;margin-bottom:22px}
  .card header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}
  h2{margin:0;font-size:19px;font-weight:620;letter-spacing:-.01em}
  .sub{margin:4px 0 0;color:var(--dim);font-size:13.5px;max-width:64ch}
  .badges{display:flex;gap:7px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
  .badge{font:11.5px ui-monospace,monospace;padding:4px 10px;border-radius:999px;
         border:1px solid var(--line);color:var(--dim);white-space:nowrap}
  .badge.round{background:#221e16}
  .s-passed{color:var(--pass);border-color:#3c5233}.s-building{color:var(--warm);border-color:#5a4526}
  .s-critiqued{color:var(--mid);border-color:#5a4d20}.s-failing{color:var(--fail);border-color:#5c3128}
  .s-improving{color:var(--warm);border-color:#5a4526}.s-pending{opacity:.7}
  .frames{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
  @media(max-width:820px){.frames{grid-template-columns:1fr}}
  figure{margin:0}
  figcaption{font:11.5px ui-monospace,monospace;color:var(--dim);margin-bottom:6px;letter-spacing:.04em}
  figure img{width:100%;display:block;border-radius:8px;border:1px solid var(--line);background:#000}
  .missing{border:1px dashed var(--line);border-radius:8px;padding:18px;color:var(--dim);
           font-size:13px;min-height:120px;display:flex;flex-direction:column;gap:8px;justify-content:center}
  .missing.brief strong{color:var(--warm);font-size:13px}
  .missing code{background:#241f17;padding:1px 5px;border-radius:4px;font-size:12px;color:#c3ad8a}
  .critique{background:var(--panel2);border:1px solid var(--line);border-left-width:3px;
            border-radius:9px;padding:14px 16px}
  .critique.v-pass{border-left-color:var(--pass)}
  .critique.v-fail{border-left-color:var(--fail)}
  .critique.v-mid{border-left-color:var(--mid)}
  .verdict-line{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .label{font:11px ui-monospace,monospace;color:var(--dim);text-transform:uppercase;letter-spacing:.09em}
  .verdict-line strong{font-size:15px}
  .v-pass strong{color:var(--pass)}.v-fail strong{color:var(--fail)}
  .conf{font:11.5px ui-monospace,monospace;color:var(--dim)}
  .gap{margin:0;font-size:14.5px}
  .gap .label{display:block;margin-bottom:3px}
  .detail{margin:10px 0 0;color:var(--dim);font-size:13.5px}
  .metrics{margin:10px 0 0;background:#12100c;border:1px solid var(--line);border-radius:6px;
           padding:9px 11px;font:11.5px/1.5 ui-monospace,monospace;color:#9db08d;overflow-x:auto}
  .history{margin-top:14px}
  .history summary{cursor:pointer;font:12px ui-monospace,monospace;color:var(--dim)}
  .history table{width:100%;border-collapse:collapse;margin-top:9px;font-size:13px}
  .history td{padding:5px 8px;border-top:1px solid var(--line);vertical-align:top}
  .history .rnd{font:11.5px ui-monospace,monospace;color:var(--dim);width:38px}
  .history .vd{width:132px;font:11.5px ui-monospace,monospace}
  .history .v-pass{color:var(--pass)}.history .v-fail{color:var(--fail)}
  footer{color:var(--dim);font-size:12.5px;margin-top:40px;border-top:1px solid var(--line);padding-top:18px}
</style></head><body><div class="wrap">
  <h1>Wizard's Chess — build progress</h1>
  <p class="lede">Each piece is built by one agent and judged by a separate one with fresh context.
     The critic runs the real app, captures the shot itself, and has to say whether it is looking at
     a film frame or a render. If it can tell, it names the single biggest gap and the piece goes
     back for another round.</p>
  <p class="meta">updated ${esc(state.updated)} &nbsp;·&nbsp; ${esc(state.note ?? '')}</p>

  <div class="banner"><strong>Reference frames could not be fetched.</strong>
    movie-screencaps.com, imgs.screencaps.us, i0.wp.com and external-preview.redd.it are all denied
    by this session's egress policy (HTTP 403 at the gateway, on both curl and the sanctioned fetch
    tool). Policy says not to route around a gateway denial, so the right-hand panel below shows the
    written shot brief instead of a frame. Drop any frame into
    <code>refs/frames/&lt;shot&gt;.jpg</code> and the critic harness switches to true blind A/B on the
    next round with no code change.</div>

  <div class="tally">
    <span class="pill"><b>${total}</b> pieces</span>
    <span class="pill"><b>${passed}</b> passed</span>
    <span class="pill"><b>${esc(state.totalRounds ?? 0)}</b> critique rounds run</span>
    <span class="pill">seed <b>${esc(state.seed ?? 20250811)}</b></span>
  </div>

  ${cards}

  <footer>Renders are captured deterministically: <code>npm run capture -- --shot=&lt;id&gt; --t=&lt;s&gt;</code>
  always produces the same pixels for a given seed, which is what makes round-to-round comparison
  mean anything.</footer>
</div></body></html>`;

await browser.close();
await writeFile(resolve(ROOT, 'progress.html'), html);
console.log(`progress.html written — ${total} pieces, ${passed} passed, ${state.totalRounds ?? 0} rounds`);
