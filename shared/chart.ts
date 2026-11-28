import type { Moment, Replay, RepoInfo } from './replay';

// The growth chart: files in the project over time, stacked by top-level folder, with milestones.
// One layout feeds both the README card (a self-contained SVG) and the player on the site.

export const SERIES_MAX = 6;

/** Validated categorical slots (adjacent pairs pass colour-blind checks on GitHub's light and dark). */
export const THEMES = {
  light: {
    surface: '#ffffff', ink: '#1f2328', muted: '#59636e', faint: '#d1d9e0', grid: '#eef1f4',
    series: ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17'], other: '#9aa4ae', fill: 0.24,
  },
  dark: {
    surface: '#0d1117', ink: '#e6edf3', muted: '#9198a1', faint: '#3d444d', grid: '#1b2129',
    series: ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23'], other: '#6e7681', fill: 0.15,
  },
} as const;
export type ThemeName = keyof typeof THEMES;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthYear = (t: number) => {
  const d = new Date(t * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Captions mark folder names with backticks; a chart label shows them plainly. */
export const plain = (s: string) => s.replace(/`/g, '');

/** "packages" for packages/svelte/src/, "(files)" for a file at the top level or the overflow entry. */
export function topFolder(path: string): string {
  const slash = path.indexOf('/');
  return slash > 0 ? path.slice(0, slash) : '(files)';
}

/** Files per top-level folder in each snapshot. */
export function folderCounts(replay: Replay): Map<string, number>[] {
  return replay.snapshots.map((s) => {
    const m = new Map<string, number>();
    for (const [i, , files] of s.entries) {
      const k = topFolder(replay.paths[i]);
      m.set(k, (m.get(k) ?? 0) + files);
    }
    return m;
  });
}

/** What the chart and the milestones need from one snapshot. */
export interface LightSnapshot {
  at: number;
  files: number;
  truncated: boolean;
  counts: Map<string, number>;
}

export function lightSnapshots(replay: Replay): LightSnapshot[] {
  const counts = folderCounts(replay);
  return replay.snapshots.map((s, i) => ({ at: s.at, files: s.files, truncated: s.truncated, counts: counts[i] }));
}

export interface ChartRow {
  at: number;
  files: number;
  /** files per series, then "other" last */
  v: number[];
}

export interface ChartModel {
  owner: string;
  name: string;
  t0: number;
  t1: number;
  series: string[];
  rows: ChartRow[];
  maxFiles: number;
  moments: Moment[];
}

export function chartModel(replay: Replay, moments: Moment[] = replay.moments): ChartModel {
  return chartModelFrom(replay.repo, lightSnapshots(replay), moments);
}

export function chartModelFrom(repo: RepoInfo, snapshots: LightSnapshot[], moments: Moment[]): ChartModel {
  const counts = snapshots.map((s) => s.counts);
  const t0 = repo.firstAt;
  const t1 = Math.max(repo.headAt, t0 + 1);
  // the folders that held the most files for the longest (files x time) get the colours
  const weight = new Map<string, number>();
  snapshots.forEach((s, i) => {
    const dt = s.at - (i ? snapshots[i - 1].at : t0);
    for (const [k, n] of counts[i]) if (k !== '(files)' && !k.startsWith('.')) weight.set(k, (weight.get(k) ?? 0) + n * Math.max(dt, 1));
  });
  const series = [...weight].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, SERIES_MAX).map(([k]) => k);
  // the chart starts from nothing at the first commit, unless a snapshot of the first commit exists
  const rows: ChartRow[] = snapshots[0]?.at <= t0 ? [] : [{ at: t0, files: 0, v: new Array(series.length + 1).fill(0) }];
  snapshots.forEach((s, i) => {
    const v = series.map((k) => counts[i].get(k) ?? 0);
    v.push(s.files - v.reduce((a, b) => a + b, 0));
    // two snapshots can share a time when commits carry the same date; keep the later one
    if (rows.length > 0 && rows[rows.length - 1].at === Math.max(s.at, t0) && rows[rows.length - 1].files > 0) rows.pop();
    rows.push({ at: Math.max(s.at, t0), files: s.files, v });
  });
  return {
    owner: repo.owner,
    name: repo.name,
    t0,
    t1,
    series,
    rows,
    maxFiles: Math.max(1, ...rows.map((r) => r.files)),
    moments: moments.filter((m) => m.at >= t0 && m.at <= t1),
  };
}

export function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const shortNum = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));

/** The row in force at time t: the latest snapshot at or before it. */
export function rowAt(model: ChartModel, t: number): ChartRow {
  let r = model.rows[0];
  for (const row of model.rows) if (row.at <= t) r = row;
  return r;
}

export interface Layout {
  width: number;
  plot: { x: number; y: number; w: number; h: number };
  yMax: number;
  X: (t: number) => number;
  Y: (v: number) => number;
  bands: { key: number; points: string }[];
  edges: { key: number; points: string }[];
  grid: { y: number; label: string }[];
  years: { x: number; label: string }[];
  flags: { at: number; x: number; y: number; ly: number; anchor: 'start' | 'end'; when: string; text: string }[];
  ends: { key: number; y: number; label: string; value: number }[];
}

/**
 * Geometry for a chart `width` wide. `top` is where the milestone strip starts; `gutter` is the room on the
 * right for the end labels. Narrow charts label milestones with their year only.
 */
export function layout(model: ChartModel, opts: { width: number; top: number; height: number; gutter: number; left?: number }): Layout {
  const left = opts.left ?? 66;
  const plot = { x: left, y: opts.top + 70, w: Math.max(80, opts.width - left - opts.gutter), h: opts.height };
  const yMax = niceMax(model.maxFiles * 1.08);
  const X = (t: number) => plot.x + ((t - model.t0) / (model.t1 - model.t0)) * plot.w;
  const Y = (v: number) => plot.y + plot.h - (v / yMax) * plot.h;
  const pt = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

  const bands: Layout['bands'] = [];
  const edges: Layout['edges'] = [];
  const base = model.rows.map(() => 0);
  const keys = model.series.length + 1;
  for (let k = 0; k < keys; k++) {
    const tops = model.rows.map((r, i) => base[i] + r.v[k]);
    if (model.rows.every((r) => r.v[k] === 0)) continue;
    const up = model.rows.map((r, i) => pt(X(r.at), Y(tops[i])));
    const down = model.rows.map((r, i) => pt(X(r.at), Y(base[i]))).reverse();
    bands.push({ key: k, points: `${up.join(' ')} ${down.join(' ')}` });
    // the top edge only where the folder has files, so an absent folder leaves no line on the baseline
    let seg: string[] = [];
    model.rows.forEach((r, i) => {
      const live = r.v[k] > 0 || (model.rows[i - 1]?.v[k] ?? 0) > 0 || (model.rows[i + 1]?.v[k] ?? 0) > 0;
      if (live) seg.push(up[i]);
      else {
        if (seg.length > 1) edges.push({ key: k, points: seg.join(' ') });
        seg = [];
      }
    });
    if (seg.length > 1) edges.push({ key: k, points: seg.join(' ') });
    tops.forEach((v, i) => (base[i] = v));
  }

  const grid: Layout['grid'] = [];
  const step = niceMax(model.maxFiles / 2.2);
  for (let g = step; g <= yMax; g += step) grid.push({ y: Y(g), label: shortNum(g) });

  const years: Layout['years'] = [];
  const y0 = new Date(model.t0 * 1000).getUTCFullYear();
  const y1 = new Date(model.t1 * 1000).getUTCFullYear();
  const span = y1 - y0;
  // about 46 px per year label; skip years until they fit
  const every = [1, 2, 4, 5, 10, 20].find((e) => (span / e) * 46 <= plot.w) ?? 20;
  for (let y = y0 + 1; y <= y1; y += every) years.push({ x: X(Date.UTC(y, 0, 1) / 1000), label: String(y) });
  if (years.length === 0) {
    // a history inside one calendar year gets its first and last month instead
    years.push({ x: X(model.t0), label: monthYear(model.t0) }, { x: X(model.t1), label: monthYear(model.t1) });
  }

  // milestone labels sit in up to three rows above the plot. A placement works when no two labels in a row
  // touch, no guide line runs through a label in a lower row, and no line from above crosses one. With at
  // most a handful of milestones every arrangement can be tried; keep the one showing the most, lowest first.
  const compact = opts.width < 600;
  const rowsY = [plot.y - 14, plot.y - 36, plot.y - 58];
  const cands = model.moments.map((m) => {
    const x = X(m.at);
    const when = String(new Date(m.at * 1000).getUTCFullYear());
    // the chart names the first half of a long milestone; the caption on the page says all of it
    const text = compact ? '' : plain(m.label ?? m.caption.split(' and ')[0]);
    const width = (when.length + text.length + 1) * 8.4;
    const anchor: 'start' | 'end' = x + width > opts.width - 8 ? 'end' : 'start';
    return { at: m.at, x, y: Y(rowAt(model, m.at).files), when, text, anchor, l: anchor === 'end' ? x - width : x - 2, r: anchor === 'end' ? x + 2 : x + width };
  });
  const clash = (a: (typeof cands)[number], ra: number, b: (typeof cands)[number], rb: number) => {
    if (ra === rb) return !(a.r + 14 < b.l || a.l - 14 > b.r);
    const [hi, lo] = ra > rb ? [a, b] : [b, a];
    return hi.x >= lo.l - 6 && hi.x <= lo.r + 6;
  };
  let best: number[] = cands.map(() => -1);
  let bestScore = -1;
  const pick: number[] = [];
  const walk = (i: number) => {
    if (i === cands.length) {
      const shown = pick.filter((r) => r >= 0).length;
      const score = shown * 100 - pick.reduce((n, r) => n + Math.max(r, 0), 0);
      if (score > bestScore) [bestScore, best] = [score, [...pick]];
      return;
    }
    for (const r of [0, 1, 2, -1]) {
      if (r >= 0 && pick.some((pr, j) => pr >= 0 && clash(cands[i], r, cands[j], pr))) continue;
      pick.push(r);
      walk(i + 1);
      pick.pop();
    }
  };
  if (cands.length <= 8) walk(0);
  const flags: Layout['flags'] = cands
    .map((c, i) => ({ c, r: best[i] }))
    .filter(({ r }) => r >= 0)
    .map(({ c, r }) => ({ at: c.at, x: c.x, y: c.y, ly: rowsY[r], anchor: c.anchor, when: c.when, text: c.text }));

  const last = model.rows[model.rows.length - 1];
  const ends: Layout['ends'] = [];
  let cum = 0;
  last.v.forEach((v, k) => {
    if (v > 0 && v / last.files >= 0.015) ends.push({ key: k, y: Y(cum + v / 2), value: v, label: k === model.series.length ? 'other' : `${model.series[k]}/` });
    cum += v;
  });
  ends.sort((a, b) => b.y - a.y);
  for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < 40) ends[i].y = ends[i - 1].y - 40;

  return { width: opts.width, plot, yMax, X, Y, bands, edges, grid, years, flags, ends };
}

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;

/** The class that carries a series' colour; "o" is other. */
export const slot = (model: ChartModel, k: number) => (k === model.series.length ? 'o' : `s${k + 1}`);

function colours(theme: ThemeName) {
  const th = THEMES[theme];
  return (model: ChartModel, k: number) => (k === model.series.length ? th.other : th.series[k]);
}

/** Shared drawing of grid, bands, edges and milestones. `wrap(at, svg)` decides when a milestone shows. */
function drawChart(model: ChartModel, L: Layout, theme: ThemeName, wrap: (at: number, svg: string) => string, clip?: string): { base: string; flags: string } {
  const th = THEMES[theme];
  const col = colours(theme);
  let out = '';
  for (const g of L.grid) {
    out += `<line x1="${L.plot.x}" x2="${L.plot.x + L.plot.w}" y1="${g.y.toFixed(1)}" y2="${g.y.toFixed(1)}" class="gr" stroke="${th.grid}"/>`;
    out += `<text x="${L.plot.x - 10}" y="${(g.y + 5).toFixed(1)}" font-size="14" text-anchor="end" class="m">${g.label}</text>`;
  }
  const baseY = L.plot.y + L.plot.h + 0.5;
  out += `<line x1="${L.plot.x}" x2="${L.plot.x + L.plot.w}" y1="${baseY}" y2="${baseY}" class="ax" stroke="${th.faint}"/>`;
  for (const y of L.years) {
    out += `<line x1="${y.x.toFixed(1)}" x2="${y.x.toFixed(1)}" y1="${L.plot.y + L.plot.h}" y2="${L.plot.y + L.plot.h + 4}" class="ax" stroke="${th.faint}"/>`;
    out += `<text x="${y.x.toFixed(1)}" y="${L.plot.y + L.plot.h + 22}" font-size="15" text-anchor="middle" class="m">${y.label}</text>`;
  }
  let data = '';
  for (const b of L.bands) data += `<polygon points="${b.points}" class="band ${slot(model, b.key)}" fill="${col(model, b.key)}" fill-opacity="${th.fill}"/>`;
  for (const e of L.edges) {
    data += `<polyline points="${e.points}" class="gap" fill="none" stroke="${th.surface}" stroke-width="4" stroke-linejoin="round"/>`;
    data += `<polyline points="${e.points}" class="edge ${slot(model, e.key)}" fill="none" stroke="${col(model, e.key)}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  out += clip ? `<g clip-path="url(#${clip})">${data}</g>` : data;
  let lines = '', dots = '', labels = '';
  for (const f of L.flags) {
    lines += wrap(f.at, `<line x1="${f.x.toFixed(1)}" x2="${f.x.toFixed(1)}" y1="${f.ly + 5}" y2="${(f.y - 5).toFixed(1)}" class="lead" stroke="${th.muted}" stroke-opacity="0.7"/>`);
    dots += wrap(f.at, `<circle cx="${f.x.toFixed(1)}" cy="${f.y.toFixed(1)}" r="4.5" class="dot" fill="${th.ink}" stroke="${th.surface}" stroke-width="2"/>`);
    const tx = f.anchor === 'end' ? f.x - 6 : f.x + 6;
    labels += wrap(f.at, `<text x="${tx.toFixed(1)}" y="${f.ly}" font-size="16" text-anchor="${f.anchor}" class="i h"><tspan font-weight="600">${esc(f.when)}</tspan>${f.text ? `<tspan class="m"> ${esc(f.text)}</tspan>` : ''}</text>`);
  }
  return { base: out, flags: lines + dots + labels };
}

function baseCss(theme: ThemeName) {
  const th = THEMES[theme];
  return `text{font-family:${FONT}}.m{fill:${th.muted}}.i{fill:${th.ink}}.h{paint-order:stroke;stroke:${th.surface};stroke-width:5px;stroke-linejoin:round}`;
}

/** A loop fraction as a keyframe offset, the way the cards write them. */
export const keyPct = (x: number) => `${Math.min(100, Math.max(0, x * 100)).toFixed(2)}%`;

/**
 * Which snapshot counts get their own stretch of a card's loop, and when (loop fractions a to b; the last
 * runs to the end). Snapshots minutes apart can start in the same hundredth of a percent; their keyframes
 * then contradict each other and browsers fade the count in from the start of the loop, so two counts show
 * at once. Of snapshots that start at the same written offset only the last is kept.
 */
export function countTicks<T>(rows: T[], start: (row: T) => number): { row: T; a: number; b?: number }[] {
  const kept: { row: T; a: number }[] = [];
  rows.forEach((row, i) => {
    const a = i === 0 ? 0 : start(row);
    if (kept.length && keyPct(kept[kept.length - 1].a) === keyPct(a)) kept.pop();
    kept.push({ row, a });
  });
  return kept.map((k, i) => ({ ...k, b: kept[i + 1]?.a }));
}

const CARD_W = 800;
const CARD_H = 480;
const LOOP = 12;
const DRAW = 8.5;

/**
 * The README card: one SVG with no scripts or outside files, so GitHub's image proxy can serve it.
 * CSS animation draws the history left to right in 8.5 s and holds it, on a 12 s loop. `at` (0..1)
 * freezes one moment instead, for a still image.
 */
export function cardSvg(model: ChartModel, opts: { theme: ThemeName; at?: number }): string {
  const th = THEMES[opts.theme];
  const L = layout(model, { width: CARD_W, top: 102, height: 196, gutter: 188 });
  const frozen = opts.at !== undefined;
  const nowT = frozen ? model.t0 + (opts.at as number) * (model.t1 - model.t0) : model.t1;
  const frac = (t: number) => ((t - model.t0) / (model.t1 - model.t0)) * (DRAW / LOOP);
  let css = baseCss(opts.theme);
  let n = 0;
  // shown for only part of the loop; with motion turned off these must stay hidden
  const passing: string[] = ['ph'];
  const pct = (x: number) => `${Math.min(100, Math.max(0, x * 100)).toFixed(2)}%`;
  // visible from loop fraction a until b (to the end of the loop when b is undefined)
  const show = (a: number, b?: number) => {
    if (frozen) {
      const f = frac(nowT);
      return f >= a - 1e-9 && f < (b ?? 2) ? '' : ' opacity="0"';
    }
    const name = `w${n++}`;
    if (b !== undefined) passing.push(name);
    css += `@keyframes ${name}{0%,${pct(a - 0.0001)}{opacity:0}${pct(a)}{opacity:1}${b !== undefined ? `${pct(b - 0.0001)}{opacity:1}${pct(b)},100%{opacity:0}` : '100%{opacity:1}'}}.${name}{animation:${name} ${LOOP}s linear infinite}`;
    return ` class="${name}"`;
  };
  const wrap = (at: number, s: string) => `<g${show(frac(at))}>${s}</g>`;
  const drawn = drawChart(model, L, opts.theme, wrap);
  let body = drawn.base;

  const top = L.plot.y - 4, coverH = L.plot.h + 5, coverW = L.plot.w + 4;
  if (frozen) {
    const x = L.X(nowT);
    body += `<rect x="${x.toFixed(1)}" y="${top}" width="${(L.plot.x + L.plot.w - x + 4).toFixed(1)}" height="${coverH}" fill="${th.surface}"/>`;
    if ((opts.at as number) < 1) body += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${L.plot.y - 2}" y2="${L.plot.y + L.plot.h}" stroke="${th.ink}" stroke-width="1.5"/>`;
  } else {
    const d = pct(DRAW / LOOP);
    css += `@keyframes cv{0%{transform:translateX(0)}${d},100%{transform:translateX(${coverW}px)}}.cv{animation:cv ${LOOP}s linear infinite}`;
    css += `@keyframes ph{0%,${pct(DRAW / LOOP - 0.005)}{opacity:1}${d},100%{opacity:0}}.ph{animation:ph ${LOOP}s linear infinite}`;
    body += `<g class="cv"><rect x="${L.plot.x}" y="${top}" width="${coverW}" height="${coverH}" fill="${th.surface}"/><line class="ph" x1="${L.plot.x}" x2="${L.plot.x}" y1="${L.plot.y - 2}" y2="${L.plot.y + L.plot.h}" stroke="${th.ink}" stroke-width="1.5"/></g>`;
  }
  // milestones go above the cover, so it never hides a dot sitting right at the playhead
  body += drawn.flags;

  let head = `<text x="28" y="48" font-size="28" font-weight="600" class="i">${esc(model.owner)}/<tspan font-weight="700">${esc(model.name)}</tspan></text>`;
  head += `<text x="28" y="76" font-size="17" class="m">Files over time, ${monthYear(model.t0)} to ${monthYear(model.t1)}</text>`;
  for (const { row: r, a, b } of countTicks(model.rows.slice(1), (r) => frac(r.at))) {
    head += `<g${show(a, b)}><text x="${CARD_W - 28}" y="48" font-size="28" font-weight="600" class="i" text-anchor="end">${fmt(r.files)}</text><text x="${CARD_W - 28}" y="76" font-size="17" class="m" text-anchor="end">files in ${monthYear(r.at)}</text></g>`;
  }

  let ends = '';
  for (const e of L.ends) ends += `<text x="${L.plot.x + L.plot.w + 12}" y="${(e.y + 5).toFixed(1)}" font-size="16" class="i">${esc(e.label)}<tspan class="m" x="${L.plot.x + L.plot.w + 12}" dy="18">${fmt(e.value)}</tspan></text>`;
  ends = `<g${show(DRAW / LOOP - 0.001)}>${ends}</g>`;

  const col = colours(opts.theme);
  let legend = '';
  let lx = 28;
  for (let k = 0; k <= model.series.length; k++) {
    if (model.rows.every((r) => r.v[k] === 0)) continue;
    const label = k === model.series.length ? 'other' : `${model.series[k]}/`;
    const w = 18 + label.length * 8 + 18;
    if (lx + w > CARD_W - 130) break;
    legend += `<rect x="${lx}" y="${CARD_H - 41}" width="12" height="12" rx="3" fill="${col(model, k)}"/><text x="${lx + 18}" y="${CARD_H - 30}" font-size="15" class="m">${esc(label)}</text>`;
    lx += w;
  }
  legend += `<text x="${CARD_W - 28}" y="${CARD_H - 30}" font-size="15" class="m" text-anchor="end">repo-replay</text>`;

  css += `@media (prefers-reduced-motion:reduce){*{animation:none!important}.cv{transform:translateX(${coverW}px)}${passing.map((c) => `.${c}`).join(',')}{opacity:0}}`;
  const label = `${model.owner}/${model.name}: files in the project from ${monthYear(model.t0)} to ${monthYear(model.t1)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${css}</style><rect width="${CARD_W}" height="${CARD_H}" fill="${th.surface}"/>${body}${head}${ends}${legend}</svg>`;
}

/** The card for a repo nobody has replayed yet: same frame, one line saying how to make it. */
export function placeholderSvg(owner: string, name: string, theme: ThemeName, site: string): string {
  const th = THEMES[theme];
  const label = `${owner}/${name} on repo-replay`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${baseCss(theme)}</style><rect width="${CARD_W}" height="${CARD_H}" fill="${th.surface}"/>`
    + `<text x="28" y="48" font-size="28" font-weight="600" class="i">${esc(owner)}/<tspan font-weight="700">${esc(name)}</tspan></text>`
    + `<line x1="66" x2="${CARD_W - 28}" y1="368.5" y2="368.5" stroke="${th.faint}"/>`
    + `<text x="${CARD_W / 2}" y="230" font-size="20" text-anchor="middle" class="i">No replay of this project yet.</text>`
    + `<text x="${CARD_W / 2}" y="262" font-size="17" text-anchor="middle" class="m">Open ${esc(site)}/${esc(owner)}/${esc(name)} once to make it.</text>`
    + `<text x="${CARD_W - 28}" y="${CARD_H - 30}" font-size="15" class="m" text-anchor="end">repo-replay</text></svg>`;
}
