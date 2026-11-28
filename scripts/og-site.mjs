// Makes public/og.png, the picture shown when the home page (or a repo nobody has replayed yet) is
// shared. It uses the live README card of sveltejs/svelte as the example, or a card saved to a file.
// Run: node scripts/og-site.mjs [card.svg]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const site = 'https://repo-replay.pages.dev';
const card = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(`${site}/api/card/sveltejs/svelte.svg`)).text();
if (!card.startsWith('<svg')) throw new Error('no card for sveltejs/svelte');

const font = (w) => readFileSync(new URL(`../node_modules/@fontsource/noto-sans/files/noto-sans-latin-${w}-normal.woff2`, import.meta.url)).toString('base64');
const html = `<!doctype html><html><head><style>
${[400, 600, 700].map((w) => `@font-face{font-family:'Noto Sans';font-weight:${w};src:url(data:font/woff2;base64,${font(w)})}`).join('')}
html,body{margin:0;width:1200px;height:630px;background:#fff;color:#1f2328;font-family:'Noto Sans';overflow:hidden}
.page{display:grid;grid-template-columns:430px 1fr;gap:40px;align-items:center;height:100%;padding:0 56px 0 64px;box-sizing:border-box}
.mark{display:flex;align-items:center;gap:12px;font-size:26px;color:#59636e}
h1{font-size:60px;line-height:1.06;letter-spacing:-0.025em;margin:28px 0 22px;font-weight:700}
p{font-size:25px;line-height:1.4;color:#59636e;margin:0}
.card{border:1.5px solid #d1d9e0;border-radius:12px;overflow:hidden;line-height:0}
.card svg{width:100%;height:auto}
.card text{font-family:'Noto Sans'!important}
</style></head><body><div class="page">
<div>
  <div class="mark"><svg width="34" height="34" viewBox="0 0 22 22"><path d="M2 19h18" stroke="#1f2328" stroke-width="2" stroke-linecap="round"/><path d="M3 16l4-5 4 2 4-6 4-4" fill="none" stroke="#257de0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>repo-replay</div>
  <h1>See how any GitHub project grew.</h1>
  <p>Paste a link to a public repo and watch it grow from the first commit to today.</p>
</div>
<div class="card">${card.replace(/^<svg /, '<svg style="font-family:Noto Sans" ')}</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await browser.close();
console.log('public/og.png written');
