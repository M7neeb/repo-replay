import { countTicks, fmt, keyPct as pct, monthYear, THEMES, type ChartModel, type LightSnapshot, type ThemeName } from './chart';

// The README card in its graph style: the repo in the middle, each top-level folder a dot joined to it,
// and the folders inside the biggest ones around them, like a note graph. Dots grow with their folder's
// files as the loop plays. Like the chart card it is one SVG with CSS animation and nothing else, and it
// is laid out without a simulation (angles by size) so the server can draw it in a millisecond or two.

const W = 800;
const H = 480;
const LOOP = 12;
const DRAW = 8.5;
const KEYS = 24;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MAX_TOP = 36;
const MAX_INNER = 90;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const radius = (files: number) => 2.5 + Math.pow(Math.max(files, 0), 0.33) * 1.7;

/** Files per folder two levels down ("packages/svelte"), from the newest snapshot's file list. */
export function innerFolders(paths: string[], entries: [number | string, number, number][]): [string, number][] {
  const m = new Map<string, number>();
  for (const [p, , files] of entries) {
    const path = typeof p === 'number' ? paths[p] : p;
    const parts = path.split('/');
    if (parts.length < 3) continue;
    const key = `${parts[0]}/${parts[1]}`;
    m.set(key, (m.get(key) ?? 0) + files);
  }
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export function graphCardSvg(model: ChartModel, snapshots: LightSnapshot[], inner: [string, number][], opts: { theme: ThemeName }): string {
  const th = THEMES[opts.theme];
  const span = Math.max(model.t1 - model.t0, 1);
  const frac = (t: number) => ((t - model.t0) / span) * (DRAW / LOOP);
  const colour = (top: string) => {
    const k = model.series.indexOf(top);
    return k >= 0 ? th.series[k] : th.other;
  };
  let css = `text{font-family:${FONT}}.m{fill:${th.muted}}.i{fill:${th.ink}}.h{paint-order:stroke;stroke:${th.surface};stroke-width:4px;stroke-linejoin:round}.g{transform-box:fill-box;transform-origin:center}`;
  let n = 0;
  const passing: string[] = [];
  let still = '';

  // every top-level folder that ever held files, with when it appeared and how big it got
  const tops = new Map<string, { first: number; max: number; last: number; series: number[] }>();
  snapshots.forEach((s, i) => {
    for (const [k, v] of s.counts) {
      if (k === '(files)' || v <= 0) continue;
      let e = tops.get(k);
      if (!e) tops.set(k, (e = { first: s.at, max: 0, last: 0, series: new Array(snapshots.length).fill(0) }));
      e.max = Math.max(e.max, v);
      e.series[i] = v;
    }
  });
  const finalOf = (k: string) => snapshots.at(-1)?.counts.get(k) ?? 0;
  const list = [...tops].map(([name, e]) => ({ name, ...e, last: finalOf(name) }))
    .sort((a, b) => b.max - a.max || (a.name < b.name ? -1 : 1)).slice(0, MAX_TOP);
  // around the ring big, small, big, small, so the small ones sit between the big ones instead of in a clump;
  // each gets an even share of the ring plus a share by size
  const total = list.reduce((s, f) => s + Math.sqrt(f.max), 0) || 1;
  const order: typeof list = [];
  for (let i = 0, j = list.length - 1; i <= j; i++, j--) {
    order.push(list[i]);
    if (j !== i) order.push(list[j]);
  }
  const cx = W / 2, cy = 268, rx = 230, ry = 112;
  let angle = -Math.PI / 2;
  const at = new Map<string, { x: number; y: number; a: number }>();
  for (const f of order) {
    const share = ((Math.sqrt(f.max) / total) * 0.6 + (1 / list.length) * 0.4) * Math.PI * 2;
    const a = angle + share / 2;
    angle += share;
    at.set(f.name, { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a });
  }

  // grows through the snapshots: a few keyframes of scale for each dot
  const sample = Array.from({ length: KEYS + 1 }, (_, i) => model.t0 + (span * i) / KEYS);
  const valueAt = (series: number[], t: number) => {
    let v = 0;
    snapshots.forEach((s, i) => { if (s.at <= t) v = series[i]; });
    return v;
  };
  const grow = (series: number[], max: number, first: number) => {
    const name = `d${n++}`;
    const R = radius(max);
    let frames = `0%,${pct(frac(first) - 0.0001)}{transform:scale(0);opacity:0}`;
    for (const t of sample) {
      if (t < first) continue;
      const v = valueAt(series, t);
      frames += `${pct(frac(t))}{transform:scale(${(radius(v) / R).toFixed(3)});opacity:${v > 0 ? 1 : 0}}`;
    }
    const end = `transform:scale(${(radius(series.at(-1) ?? 0) / R).toFixed(3)});opacity:${(series.at(-1) ?? 0) > 0 ? 1 : 0}`;
    css += `@keyframes ${name}{${frames}100%{${end}}}.${name}{animation:${name} ${LOOP}s linear infinite}`;
    still += `.${name}{${end}}`;
    return name;
  };
  // shown while the folder holds files: it can empty out and come back
  const present = (series: number[], first: number) => {
    const name = `p${n++}`;
    let frames = `0%,${pct(frac(first) - 0.0001)}{opacity:0}`;
    snapshots.forEach((s, i) => { if (s.at >= first) frames += `${pct(frac(s.at))}{opacity:${series[i] > 0 ? 1 : 0}}`; });
    const end = (series.at(-1) ?? 0) > 0 ? 1 : 0;
    css += `@keyframes ${name}{${frames}100%{opacity:${end}}}.${name}{animation:${name} ${LOOP}s step-end infinite}`;
    still += `.${name}{opacity:${end}}`;
    return name;
  };
  const appear = (first: number) => {
    const name = `a${n++}`;
    css += `@keyframes ${name}{0%,${pct(frac(first) - 0.0001)}{opacity:0}${pct(frac(first) + 0.02)},100%{opacity:1}}.${name}{animation:${name} ${LOOP}s linear infinite}`;
    return name;
  };

  let edges = '', dots = '', labels = '';
  const innerByTop = new Map<string, [string, number][]>();
  for (const [path, files] of inner.slice(0, MAX_INNER)) {
    const top = path.split('/')[0];
    if (!at.has(top)) continue;
    let l = innerByTop.get(top);
    if (!l) innerByTop.set(top, (l = []));
    l.push([path, files]);
  }
  for (const f of list) {
    const p = at.get(f.name)!;
    const show = present(f.series, f.first);
    edges += `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${th.faint}" class="${show}"/>`;
    // the folders inside fan out beyond their parent, away from the middle
    const kids = innerByTop.get(f.name) ?? [];
    kids.forEach(([path, files], j) => {
      const spread = Math.min(1.4, 0.24 * kids.length);
      const a = p.a + (kids.length > 1 ? (j / (kids.length - 1) - 0.5) * spread : 0);
      const d = 30 + radius(f.max) + (j % 2) * 14;
      const kx = p.x + Math.cos(a) * d * 1.5, ky = p.y + Math.sin(a) * d;
      const kidShow = f.last > 0 ? appear(f.first + (model.t1 - f.first) * 0.15) : present(f.series, f.first);
      edges += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${kx.toFixed(1)}" y2="${ky.toFixed(1)}" stroke="${th.faint}" class="${kidShow}"/>`;
      dots += `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="${(radius(files) * 0.8).toFixed(1)}" fill="${colour(f.name)}" class="${kidShow}"><title>${esc(path)}/: ${fmt(files)} files</title></circle>`;
    });
    dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radius(f.max).toFixed(1)}" fill="${colour(f.name)}" class="g ${grow(f.series, f.max, f.first)}"><title>${esc(f.name)}/: ${fmt(f.last)} files</title></circle>`;
  }
  // names for the biggest folders, under their dots, skipping any that would sit on another
  const taken: number[][] = [];
  for (const f of [...list].sort((a, b) => b.last - a.last).slice(0, 10)) {
    if (f.last <= 0) continue;
    const p = at.get(f.name)!;
    const w = (f.name.length + 1) * 8.2, y = p.y + radius(f.max) + 17;
    const box = [p.x - w / 2, y - 13, p.x + w / 2, y + 4];
    if (taken.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
    taken.push(box);
    labels += `<text x="${p.x.toFixed(1)}" y="${(p.y + radius(f.max) + 17).toFixed(1)}" font-size="14" font-weight="600" text-anchor="middle" class="i h ${appear(f.first)}">${esc(f.name)}/</text>`;
  }
  const root = `<circle cx="${cx}" cy="${cy}" r="8" fill="${th.ink}"/><text x="${cx}" y="${cy + 26}" font-size="15" font-weight="700" text-anchor="middle" class="i h">${esc(model.name)}</text>`;

  // the count and date in the corner, changing with each snapshot, as on the chart card
  let head = `<text x="28" y="48" font-size="28" font-weight="600" class="i">${esc(model.owner)}/<tspan font-weight="700">${esc(model.name)}</tspan></text>`;
  head += `<text x="28" y="76" font-size="17" class="m">Its folders, ${monthYear(model.t0)} to ${monthYear(model.t1)}</text>`;
  for (const { row: r, a, b } of countTicks(model.rows.slice(1), (r) => frac(r.at))) {
    const name = `t${n++}`;
    if (b !== undefined) {
      passing.push(name);
      css += `@keyframes ${name}{0%,${pct(a - 0.0001)}{opacity:0}${pct(a)}{opacity:1}${pct(b - 0.0001)}{opacity:1}${pct(b)},100%{opacity:0}}`;
    } else css += `@keyframes ${name}{0%,${pct(a - 0.0001)}{opacity:0}${pct(a)},100%{opacity:1}}`;
    css += `.${name}{animation:${name} ${LOOP}s linear infinite}`;
    head += `<g class="${name}"><text x="${W - 28}" y="48" font-size="28" font-weight="600" class="i" text-anchor="end">${fmt(r.files)}</text><text x="${W - 28}" y="76" font-size="17" class="m" text-anchor="end">files in ${monthYear(r.at)}</text></g>`;
  }

  let legend = '';
  let lx = 28;
  for (let k = 0; k < model.series.length; k++) {
    const label = `${model.series[k]}/`;
    const w = 18 + label.length * 8 + 18;
    if (lx + w > W - 130) break;
    legend += `<circle cx="${lx + 6}" cy="${H - 35}" r="6" fill="${th.series[k]}"/><text x="${lx + 18}" y="${H - 30}" font-size="15" class="m">${esc(label)}</text>`;
    lx += w;
  }
  legend += `<text x="${W - 28}" y="${H - 30}" font-size="15" class="m" text-anchor="end">repo-replay</text>`;

  // with motion turned off: the finished graph and the latest count
  css += `@media (prefers-reduced-motion:reduce){*{animation:none!important}${still}${passing.length ? `${passing.map((c) => `.${c}`).join(',')}{opacity:0}` : ''}}`;
  const label = `${model.owner}/${model.name}: its folders as a graph, ${monthYear(model.t0)} to ${monthYear(model.t1)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${css}</style><rect width="${W}" height="${H}" fill="${th.surface}"/><g stroke-width="1">${edges}</g>${dots}${root}${labels}${head}${legend}</svg>`;
}
