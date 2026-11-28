import { fmt, layout, monthYear, THEMES, type ChartModel } from '../shared/chart';
import { loadGlyphs, Raster, rgb, type RGB } from './raster';

// The picture shown when a replay link is shared (og:image): the finished README card, laid out for
// 1200 x 630. It is drawn on an 800 x 420 grid with the card's sizes and scaled by 1.5, so the chart
// layout and its label spacing are the ones the card already uses.

export const OG_W = 1200;
export const OG_H = 630;
const S = OG_W / 800;
const W = 800;
const H = 420;

const th = THEMES.light;
const C = {
  surface: rgb(th.surface),
  ink: rgb(th.ink),
  muted: rgb(th.muted),
  faint: rgb(th.faint),
  grid: rgb(th.grid),
  other: rgb(th.other),
  series: th.series.map(rgb),
};

const pts = (s: string): [number, number][] => s.split(' ').map((p) => {
  const [x, y] = p.split(',');
  return [Number(x) * S, Number(y) * S];
});

function mark(r: Raster, x: number, y: number) {
  // the site's logo: a baseline and a rising line, 22 units square
  const p = (u: number, v: number): [number, number] => [x + u * 1.5, y + v * 1.5];
  r.polyline([p(2, 19), p(20, 19)], 3, C.ink);
  r.polyline([p(3, 16), p(7, 11), p(11, 13), p(15, 7), p(19, 3)], 3.3, C.series[0]);
}

function brand(r: Raster) {
  const width = r.measure('repo-replay', 'r22');
  r.text('repo-replay', OG_W - 42, (H - 30) * S, 'r22', C.muted, 'end');
  mark(r, OG_W - 42 - width - 44, (H - 30) * S - 26);
}

export async function ogPng(model: ChartModel): Promise<Uint8Array> {
  const r = new Raster(OG_W, OG_H, C.surface, await loadGlyphs());
  const L = layout(model, { width: W, top: 90, height: 174, gutter: 150 });
  const col = (k: number): RGB => (k === model.series.length ? C.other : C.series[k]);
  const x0 = L.plot.x * S, x1 = (L.plot.x + L.plot.w) * S;

  for (const g of L.grid) {
    r.rect(x0, g.y * S - 0.75, x1, g.y * S + 0.75, C.grid);
    r.text(g.label, (L.plot.x - 10) * S, (g.y + 5) * S, 'r22', C.muted, 'end');
  }
  const baseY = (L.plot.y + L.plot.h) * S;
  r.rect(x0, baseY, x1, baseY + 1.5, C.faint);
  for (const y of L.years) {
    r.rect(y.x * S - 0.75, baseY, y.x * S + 0.75, baseY + 6, C.faint);
    r.text(y.label, y.x * S, (L.plot.y + L.plot.h + 22) * S, 'r22', C.muted, 'middle');
  }

  for (const b of L.bands) {
    const p = pts(b.points);
    const n = p.length / 2;
    const up = p.slice(0, n);
    const down = p.slice(n).reverse();
    r.band(up.map((q) => q[0]), up.map((q) => q[1]), down.map((q) => q[1]), col(b.key), th.fill);
  }
  for (const e of L.edges) {
    const p = pts(e.points);
    r.polyline(p, 4 * S, C.surface);
    r.polyline(p, 2 * S, col(e.key));
  }

  for (const f of L.flags) r.rect(f.x * S - 0.75, (f.ly + 5) * S, f.x * S + 0.75, (f.y - 5) * S, C.muted, 0.7);
  for (const f of L.flags) {
    r.disc(f.x * S, f.y * S, 5.5 * S, C.surface);
    r.disc(f.x * S, f.y * S, 3.5 * S, C.ink);
  }
  for (const f of L.flags) {
    const text = f.text ? ` ${f.text}` : '';
    const yearW = r.measure(f.when, 's24');
    const total = yearW + (text ? r.measure(text, 'r24') : 0);
    const start = f.anchor === 'end' ? (f.x - 6) * S - total : (f.x + 6) * S;
    r.text(f.when, start, f.ly * S, 's24', C.ink);
    if (text) r.text(text, start + yearW, f.ly * S, 'r24', C.muted);
  }

  const ownerW = r.text(`${model.owner}/`, 28 * S, 48 * S, 'b42', C.muted);
  r.text(model.name, 28 * S + ownerW, 48 * S, 'b42', C.ink);
  r.text(`Files over time, ${monthYear(model.t0)} to ${monthYear(model.t1)}`, 28 * S, 78 * S, 'r26', C.muted);
  const last = model.rows[model.rows.length - 1];
  r.text(fmt(last.files), (W - 28) * S, 48 * S, 'b42', C.ink, 'end');
  r.text(`${last.files === 1 ? 'file' : 'files'} in ${monthYear(last.at)}`, (W - 28) * S, 78 * S, 'r26', C.muted, 'end');

  for (const e of L.ends) {
    r.text(e.label, (L.plot.x + L.plot.w + 12) * S, (e.y + 5) * S, 'r24', C.ink);
    r.text(fmt(e.value), (L.plot.x + L.plot.w + 12) * S, (e.y + 23) * S, 'r24', C.muted);
  }

  let lx = 28 * S;
  for (let k = 0; k <= model.series.length; k++) {
    if (model.rows.every((row) => row.v[k] === 0)) continue;
    const label = k === model.series.length ? 'other' : `${model.series[k]}/`;
    const w = 18 * S + r.measure(label, 'r22') + 18 * S;
    if (lx + w > OG_W - 260) break;
    r.roundRect(lx, (H - 41) * S, 12 * S, 12 * S, 3 * S, col(k));
    r.text(label, lx + 18 * S, (H - 30) * S, 'r22', C.muted);
    lx += w;
  }
  brand(r);
  return r.png();
}
