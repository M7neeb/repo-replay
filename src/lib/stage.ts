import { niceMax, THEMES, type ChartModel, type ThemeName } from '../../shared/chart';
import type { Replay } from '../../shared/replay';

// The replay's picture, in two views: a live ticker (files over time, stacked by folder, with a camera
// that follows the playhead) and a graph (every folder a dot joined to the folder it sits in). The page
// and the saved video draw it the same way. Text around it (count, caption) is the caller's.

export type View = 'ticker' | 'graph';
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Theme = (typeof THEMES)[ThemeName];

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400;
const MAX_NODES = 400;
const MAX_DEPTH = 4;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)));
const hourOf = (t: number) => `${String(new Date(t * 1000).getUTCHours()).padStart(2, '0')}:00`;
const dayMonth = (t: number) => { const d = new Date(t * 1000); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const monthYear = (t: number) => { const d = new Date(t * 1000); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const yearOf = (t: number) => String(new Date(t * 1000).getUTCFullYear());

export interface GraphNode {
  path: string;
  /** index of the parent in the list, -1 for a top-level folder (its parent is the repo) */
  parent: number;
  depth: number;
  /** colour slot: a series index, or the series count for "other" */
  key: number;
  /** files in this folder at each snapshot */
  files: number[];
}

export interface StageData {
  model: ChartModel;
  /** commits per bin, from week0, bins of binLen seconds */
  bins: number[];
  week0: number;
  binLen: number;
  /** snapshot times for the graph, oldest first */
  ats: number[];
  nodes: GraphNode[];
}

/** Commits per bin: a week for long histories, a day or less for young ones. */
export function activityBins(replay: Replay, t0: number, t1: number): { bins: number[]; binLen: number } {
  const span = Math.max(t1 - t0, 1);
  const binLen = span > 180 * DAY ? 7 * DAY : span > 20 * DAY ? DAY : Math.max(600, Math.round(span / 100));
  const bins = new Array<number>(Math.floor(span / binLen) + 1).fill(0);
  for (const row of replay.timeline) {
    const i = Math.floor((row[0] - t0) / binLen);
    if (i >= 0 && i < bins.length) bins[i] += row[1];
  }
  return { bins, binLen };
}

/** Folders at each snapshot, up to four levels deep, keeping the biggest few hundred. */
export function graphNodes(replay: Replay, series: string[]): { ats: number[]; nodes: GraphNode[] } {
  const snaps = replay.snapshots;
  const totals = new Map<string, number[]>();
  snaps.forEach((s, i) => {
    for (const [p, , files] of s.entries) {
      const path = replay.paths[p];
      const parts = path.split('/');
      // "a/b/" is a folder rolled up whole and "a/b/c.ts" a file in a/b: either way two folders deep
      const folders = parts.length - 1;
      for (let d = 1; d <= Math.min(folders, MAX_DEPTH); d++) {
        const key = parts.slice(0, d).join('/');
        let row = totals.get(key);
        if (!row) totals.set(key, (row = new Array<number>(snaps.length).fill(0)));
        row[i] += files;
      }
    }
  });
  // a parent always holds at least as many files as its children, so it ranks ahead of them
  const kept = [...totals]
    .map(([path, files]) => ({ path, files, max: Math.max(...files), depth: path.split('/').length }))
    .sort((a, b) => b.max - a.max || a.depth - b.depth || (a.path < b.path ? -1 : 1))
    .slice(0, MAX_NODES)
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : 1));
  const index = new Map(kept.map((n, i) => [n.path, i]));
  const nodes = kept.map((n) => {
    const top = n.path.split('/')[0];
    const k = series.indexOf(top);
    return { path: n.path, parent: n.depth > 1 ? (index.get(n.path.slice(0, n.path.lastIndexOf('/'))) ?? -1) : -1, depth: n.depth, key: k >= 0 ? k : series.length, files: n.files };
  });
  return { ats: snaps.map((s) => s.at), nodes };
}

export function stageData(replay: Replay, model: ChartModel): StageData {
  const { bins, binLen } = activityBins(replay, model.t0, model.t1);
  const { ats, nodes } = graphNodes(replay, model.series);
  return { model, bins, week0: model.t0, binLen, ats, nodes };
}

interface Box { x: number; y: number; w: number; h: number }

interface Sim {
  x: number; y: number; vx: number; vy: number; vis: number; r: number; glow: number; last: number; born: boolean;
}

/** Holds what moves smoothly from frame to frame (camera, scale, the graph layout) for one canvas. */
export class Stage {
  view: View = 'ticker';
  private win = 0;
  private yMax = 0;
  private year = '';
  private prevYear = '';
  private yearAt = 0;
  private lastSnap = -1;
  private pulseAt = 0;
  private sim: Sim[] | null = null;
  private root = { x: 0, y: 0, vx: 0, vy: 0, r: 7 };
  private cam = { x: 0, y: 0, s: 1, sx: 1 };
  private snap = -1;
  private callouts: { i: number; at: number }[] = [];
  private seed = 7;

  constructor(readonly data: StageData) {
    this.reset();
  }

  reset() {
    const span = this.data.model.t1 - this.data.model.t0;
    this.win = span * 0.05;
    this.yMax = 0;
    this.year = this.prevYear = '';
    this.lastSnap = -1;
    this.sim = null;
    this.snap = -1;
    this.callouts = [];
    this.seed = 7;
    this.cam = { x: 0, y: 0, s: 1, sx: 1 };
    this.root = { x: 0, y: 0, vx: 0, vy: 0, r: 7 };
  }

  /**
   * Draws the picture at time t into box. `now` is a clock in ms for the short animations; `ending` is
   * true once playback has finished, when the ticker pulls back to the whole history.
   * `card` leaves out the axis labels and the commit strip, for small sizes.
   */
  draw(ctx: Ctx, box: Box, t: number, now: number, opts: { theme: ThemeName; ending?: boolean; speed?: number; duration?: number; card?: boolean }) {
    const th = THEMES[opts.theme];
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.textBaseline = 'alphabetic';
    if (this.view === 'graph') this.drawGraph(ctx, box, t, now, th, opts);
    else this.drawTicker(ctx, box, t, now, th, opts);
    ctx.restore();
  }

  // ---- shared bits -------------------------------------------------------------------------------

  private get m() {
    return this.data.model;
  }

  private colour(th: Theme, k: number): string {
    return k >= this.m.series.length ? th.other : th.series[k];
  }

  private interp(t: number): { files: number; v: number[] } {
    const r = this.m.rows;
    if (t <= r[0].at) return { files: r[0].files, v: r[0].v.slice() };
    let lo = 0, hi = r.length - 1;
    if (t >= r[hi].at) return { files: r[hi].files, v: r[hi].v.slice() };
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r[mid].at < t) lo = mid; else hi = mid; }
    const a = r[lo], b = r[hi], f = (t - a.at) / Math.max(b.at - a.at, 1);
    return { files: a.files + (b.files - a.files) * f, v: a.v.map((x, k) => x + (b.v[k] - x) * f) };
  }

  private snapIndex(t: number, ats: number[] = this.m.rows.map((r) => r.at)): number {
    let lo = 0, hi = ats.length - 1;
    if (t >= ats[hi]) return hi;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ats[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  private span() {
    return Math.max(this.m.t1 - this.m.t0, 1);
  }

  private dateAt(t: number) {
    const s = this.span();
    return s < 5 * DAY ? `${dayMonth(t)}, ${hourOf(t)}` : s < 120 * DAY ? dayMonth(t) : monthYear(t);
  }

  private markOf(t: number) {
    return this.span() < 120 * DAY ? dayMonth(t) : yearOf(t);
  }

  private text(ctx: Ctx, s: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = 'left'): number {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  private measure(ctx: Ctx, s: string, size: number, weight: number) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    return ctx.measureText(s).width;
  }

  /** A smooth line through points whose x only moves one way, without overshooting. */
  private trace(ctx: Ctx, pts: [number, number][], move: boolean) {
    const n = pts.length;
    if (!n) return;
    if (move) ctx.moveTo(pts[0][0], pts[0][1]);
    else ctx.lineTo(pts[0][0], pts[0][1]);
    if (n < 3) { for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]); return; }
    const d: number[] = [], m: number[] = [];
    for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0]; d.push(dx ? (pts[i + 1][1] - pts[i][1]) / dx : 0); }
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (!d[i]) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3;
      ctx.bezierCurveTo(x0 + h, y0 + m[i] * h, x1 - h, y1 - m[i + 1] * h, x1, y1);
    }
  }

  /** The year (or day) large and faint behind the picture, so time passing is felt and not only read. */
  private watermark(ctx: Ctx, th: Theme, now: number, t: number, x: number, y: number, size: number, room: number) {
    const label = this.markOf(t);
    if (label !== this.year) { this.prevYear = this.year; this.year = label; this.yearAt = now; }
    size = Math.min(size, (room / Math.max(1, this.measure(ctx, label, 100, 800))) * 100);
    const k = ease((now - this.yearAt) / 500);
    ctx.save();
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = th.ink;
    if (this.prevYear && k < 1) { ctx.globalAlpha = 0.06 * (1 - k); ctx.fillText(this.prevYear, x, y - size * 0.12 * k); }
    ctx.globalAlpha = 0.06 * k;
    ctx.fillText(this.year, x, y + size * 0.12 * (1 - k));
    ctx.restore();
  }

  private activity(ctx: Ctx, th: Theme, x0: number, x1: number, y0: number, h: number, left: number, right: number, t: number, X: (a: number) => number) {
    const { bins, week0, binLen } = this.data;
    const i0 = Math.max(0, Math.floor((left - week0) / binLen)), i1 = Math.min(bins.length - 1, Math.floor((right - week0) / binLen));
    let max = 1;
    for (let i = i0; i <= i1; i++) max = Math.max(max, bins[i]);
    const bw = Math.max(1, X(week0 + binLen) - X(week0) - (i1 - i0 > 200 ? 0 : 1));
    for (let i = i0; i <= i1; i++) {
      const a = week0 + i * binLen;
      if (a > t) break;
      const x = X(a), hh = Math.max(1, (bins[i] / max) * h);
      if (x < x0 - bw || x > x1) continue;
      const current = a + binLen > t;
      ctx.fillStyle = current ? th.ink : th.muted;
      ctx.globalAlpha = current ? 1 : 0.45;
      ctx.fillRect(x, y0 + h - hh, bw, hh);
    }
    ctx.globalAlpha = 1;
    const unit = binLen >= 7 * DAY ? 'per week' : binLen >= DAY ? 'per day' : 'over time';
    this.text(ctx, `commits ${unit}`, x0, y0 + h + 14, 10.5, 500, th.muted);
  }

  // ---- the live ticker ---------------------------------------------------------------------------

  private drawTicker(ctx: Ctx, box: Box, t: number, now: number, th: Theme, opts: { ending?: boolean; speed?: number; duration?: number; card?: boolean }) {
    const m = this.m, card = !!opts.card, ending = !!opts.ending;
    const strip = card ? 0 : 52;
    const x0 = box.x, x1 = box.x + box.w - Math.min(118, box.w * 0.3);
    const yTop = box.y + 4, yBase = box.y + box.h - strip - (card ? 4 : 26);
    const span = this.span();
    // the camera follows the playhead, then pulls back to the whole history at the end
    const want = ending ? span : Math.min(span * 0.42, Math.max(span * 0.05, (t - m.t0) * 1.35));
    this.win += (want - this.win) * (ending ? 0.06 : 0.25);
    const right = ending ? m.t1 : Math.min(m.t1, Math.max(m.t0 + this.win, t + this.win * 0.04));
    const left = Math.max(m.t0, right - this.win);
    const X = (a: number) => x0 + ((a - left) / Math.max(right - left, 1)) * (x1 - x0);
    let peak = 1;
    for (const r of m.rows) if (r.at >= left && r.at <= t) peak = Math.max(peak, r.files);
    const s = this.interp(t);
    peak = Math.max(peak, s.files);
    this.yMax = this.yMax ? this.yMax + (niceMax(peak * 1.12) - this.yMax) * 0.08 : niceMax(peak * 1.12);
    const Y = (v: number) => yBase - (v / this.yMax) * (yBase - yTop - 22);

    if (!card) {
      const size = Math.min(96, (yBase - yTop) * 0.34);
      this.watermark(ctx, th, now, t, x1 - 6, yTop + 46 + size * 0.75, size, (x1 - x0) * 0.6);
    }
    // grid
    const step = niceMax(this.yMax / 3);
    ctx.lineWidth = 1;
    for (let g = step; g < this.yMax; g += step) {
      const y = Math.round(Y(g)) + 0.5;
      ctx.strokeStyle = th.grid;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (!card) this.text(ctx, short(g), x0 + 2, y - 5, 11, 500, th.muted);
    }
    ctx.strokeStyle = th.faint;
    ctx.beginPath(); ctx.moveTo(x0, yBase + 0.5); ctx.lineTo(x1, yBase + 0.5); ctx.stroke();

    const xp = X(t);
    if (!card) {
      const showPill = !ending;
      this.axis(ctx, th, x0, x1, yBase, left, right, X, showPill ? xp : -1e9);
      if (showPill) {
        // the date rides the playhead along the axis
        const d = this.dateAt(t), dw = this.measure(ctx, d, 11.5, 700) + 14;
        const px = clamp(xp - dw / 2, x0, x1 - dw);
        ctx.fillStyle = th.ink;
        ctx.beginPath(); ctx.roundRect(px, yBase + 4, dw, 19, 9.5); ctx.fill();
        this.text(ctx, d, px + dw / 2, yBase + 17.5, 11.5, 700, th.surface, 'center');
      }
    }

    // stacked bands through every real snapshot between the window's left edge and now
    const keys = m.rows[0].v.map((_, k) => k);
    const ats = [left];
    for (const r of m.rows) if (r.at > left && r.at < t) ats.push(r.at);
    ats.push(Math.max(t, left));
    const vals = ats.map((a) => this.interp(a).v);
    const stacks = vals.map((v) => { let acc = 0; return keys.map((k) => (acc += v[k])); });
    const edge = (j: number) => ats.map((a, i): [number, number] => [X(a), Y(j < 0 ? 0 : stacks[i][j])]);
    keys.forEach((k, j) => {
      ctx.beginPath();
      this.trace(ctx, edge(j), true);
      this.trace(ctx, edge(j - 1).reverse(), false);
      ctx.closePath();
      ctx.globalAlpha = th.fill * 1.5;
      ctx.fillStyle = this.colour(th, k);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.lineJoin = 'round';
    keys.forEach((k, j) => {
      const pts = edge(j), runs: [number, number][][] = [];
      let run: [number, number][] | null = null;
      pts.forEach((p, i) => {
        const live = vals[i][k] > 0.5 || (vals[i - 1]?.[k] ?? 0) > 0.5 || (vals[i + 1]?.[k] ?? 0) > 0.5;
        if (live) { if (!run) runs.push((run = [])); run.push(p); } else run = null;
      });
      for (const [w, c] of [[4.5, th.surface], [2.25, this.colour(th, k)]] as const) {
        ctx.beginPath();
        runs.forEach((r) => this.trace(ctx, r, true));
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.stroke();
      }
    });

    this.flags(ctx, th, left, t, X, Y, yTop, card || box.w < 600, opts);
    if (left > m.t0) {
      const g = ctx.createLinearGradient(x0, 0, x0 + 46, 0);
      g.addColorStop(0, th.surface);
      g.addColorStop(1, `${th.surface}00`);
      ctx.fillStyle = g;
      ctx.fillRect(x0 - 1, yTop, 47, yBase - yTop);
    }

    if (!ending) {
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xp, yTop + 18); ctx.lineTo(xp, yBase); ctx.stroke();
      // the tip of the stack, with a ring each time a new snapshot lands
      const si = this.snapIndex(t);
      if (si !== this.lastSnap) { this.lastSnap = si; this.pulseAt = now; }
      const yt = Y(s.files), k = (now - this.pulseAt) / 600;
      if (k < 1) {
        ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.5 * (1 - k); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(xp, yt, 4 + k * 10, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = th.surface; ctx.beginPath(); ctx.arc(xp, yt, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(xp, yt, 3.2, 0, Math.PI * 2); ctx.fill();
    }

    // folder labels riding at the playhead
    const lx = ending ? x1 : xp;
    const top = stacks[stacks.length - 1];
    const labels: { k: number; y: number; v: number }[] = [];
    let acc = 0;
    keys.forEach((k, j) => {
      const lo = acc;
      acc = top[j];
      if (s.v[k] / Math.max(s.files, 1) >= 0.03) labels.push({ k, y: Y((lo + acc) / 2), v: s.v[k] });
    });
    labels.sort((a, b) => b.y - a.y);
    const gap = card ? 24 : 30;
    for (let i = 1; i < labels.length; i++) if (labels[i - 1].y - labels[i].y < gap) labels[i].y = labels[i - 1].y - gap;
    // pushed up past the milestone row, they come back down as a block instead
    const ceiling = yTop + (card ? 14 : 62);
    if (labels.length && labels[labels.length - 1].y < ceiling) {
      labels[labels.length - 1].y = ceiling;
      for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.max(labels[i].y, labels[i + 1].y + gap);
    }
    const size = card ? 11 : 12.5;
    for (const l of labels) {
      if (l.y > yBase + 6) continue;
      ctx.fillStyle = this.colour(th, l.k);
      ctx.beginPath(); ctx.roundRect(lx + 8, l.y - 10, 4, 20, 2); ctx.fill();
      let name = l.k < m.series.length ? `${m.series[l.k]}/` : 'other';
      const room = box.x + box.w - lx - 20;
      while (name.length > 4 && this.measure(ctx, name, size, 700) > room) name = `${name.slice(0, -2)}…`;
      this.text(ctx, name, lx + 17, l.y - 1, size, 700, th.ink);
      this.text(ctx, fmt(l.v), lx + 17, l.y + (card ? 11 : 13), card ? 10.5 : 11.5, 500, th.muted);
    }
    if (!card) this.activity(ctx, th, x0, x1, box.y + box.h - 44, 28, left, right, t, X);
  }

  private axis(ctx: Ctx, th: Theme, x0: number, x1: number, yBase: number, left: number, right: number, X: (a: number) => number, skip: number) {
    const put = (s: string, x: number) => {
      if (Math.abs(x - skip) > 44 && x >= x0 && x <= x1) this.text(ctx, s, x, yBase + 17, 11.5, 500, th.muted, 'center');
    };
    if (right - left < 2 * DAY) {
      const step = [1, 2, 3, 6, 12].map((h) => h * 3600).find((h) => ((right - left) / h) * 48 <= x1 - x0) ?? 12 * 3600;
      for (let a = Math.ceil(left / step) * step; a <= right; a += step) put(hourOf(a), X(a));
      return;
    }
    if (right - left < 120 * DAY) {
      const step = [1, 2, 7, 14, 30].map((d) => d * DAY).find((d) => ((right - left) / d) * 56 <= x1 - x0) ?? 30 * DAY;
      for (let a = Math.ceil(left / step) * step; a <= right; a += step) put(dayMonth(a), X(a));
      return;
    }
    const y0 = new Date(left * 1000).getUTCFullYear() + 1, y1 = new Date(right * 1000).getUTCFullYear();
    const every = [1, 2, 4, 5, 10].find((e) => ((y1 - y0 + 1) / e) * 46 <= x1 - x0) ?? 10;
    for (let y = y0; y <= y1; y += every) put(String(y), X(Date.UTC(y, 0, 1) / 1000));
  }

  /** Milestone flags; labels that would collide step down a row. */
  private flags(ctx: Ctx, th: Theme, left: number, t: number, X: (a: number) => number, Y: (v: number) => number, yTop: number, compact: boolean, opts: { speed?: number; duration?: number }) {
    const rowsEnd: number[] = [];
    const perSecond = this.span() / ((opts.duration ?? 40) * (opts.speed ?? 1));
    for (const mo of this.m.moments) {
      if (mo.at > t || mo.at < left - 1) continue;
      const x = X(mo.at), y = Y(this.interp(mo.at).files);
      const label = compact ? this.markOf(mo.at) : (mo.label ?? mo.caption).replace(/`/g, '');
      const lw = this.measure(ctx, label, 11.5, 700);
      let row = rowsEnd.findIndex((e) => e < x - 2);
      if (row < 0) row = rowsEnd.length;
      if (row > 2) continue;
      rowsEnd[row] = x + 6 + lw + 8;
      const ly = yTop + 14 + row * 16;
      ctx.strokeStyle = th.muted; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, ly - 10); ctx.lineTo(x + 0.5, y - 6); ctx.stroke();
      ctx.globalAlpha = 1;
      const age = (t - mo.at) / perSecond;
      if (age < 1.2) {
        const k = age / 1.2;
        ctx.strokeStyle = th.ink; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 6 + k * 26, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = th.surface; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x, y, 3.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.surface; ctx.globalAlpha = 0.85; ctx.fillRect(x + 3, ly - 11, lw + 6, 15); ctx.globalAlpha = 1;
      this.text(ctx, label, x + 6, ly, 11.5, 700, th.ink);
    }
  }

  // ---- the graph ---------------------------------------------------------------------------------

  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private step(t: number, now: number) {
    const { nodes, ats } = this.data;
    if (!this.sim) this.sim = nodes.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, vis: 0, r: 0, glow: 0, last: 0, born: false }));
    const S = this.sim, root = this.root;
    const si = ats.length ? this.snapIndex(t, ats) : -1;
    const from = this.snap;
    const changed = si !== from;
    this.snap = si;
    const at = (i: number) => (i < 0 ? root : S[i]);
    nodes.forEach((n, i) => {
      const s = S[i];
      const v = si >= 0 && ats[si] <= t ? n.files[si] : 0;
      if (v > 0 && !s.born) {
        // a new folder starts at its parent and drifts out
        const p = at(n.parent);
        const ang = this.rnd() * Math.PI * 2;
        s.x = p.x + Math.cos(ang) * 8; s.y = p.y + Math.sin(ang) * 8; s.vx = s.vy = 0; s.born = true;
        if (from >= 0 && (n.depth === 1 || v >= 20) && this.callouts.length < 2) this.callouts.push({ i, at: now });
      }
      if (changed && s.last && v > s.last) s.glow = 1;
      s.last = v;
      s.vis += ((v > 0 ? 1 : 0) - s.vis) * 0.12;
      if (s.vis < 0.02 && !v) s.born = false;
      s.r = 1.5 + Math.pow(v, 0.33) * 1.3;
      s.glow *= 0.94;
    });
    // repulsion between nearby dots, bucketed so big trees stay cheap
    const live: (Sim | typeof root)[] = [root, ...S.filter((s) => s.vis > 0.05)];
    const CELL = 140, cells = new Map<string, (Sim | typeof root)[]>();
    for (const n of live) {
      const key = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = []));
      c.push(n);
    }
    for (const a of live) {
      const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const b of cells.get(`${gx},${gy}`) ?? []) {
          if (b === a) continue;
          let dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          if (d2 > CELL * CELL) continue;
          const d = Math.sqrt(d2);
          let f = (60 / d2) * (1 + a.r * b.r * 0.05);
          const overlap = a.r + b.r + 3 - d;
          if (overlap > 0) f += overlap * 0.08;
          dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f;
        }
      }
    }
    nodes.forEach((n, i) => {
      const s = S[i];
      if (s.vis <= 0.05) return;
      const p = at(n.parent);
      const dx = s.x - p.x, dy = s.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - ((n.depth === 1 ? 46 : 18) + s.r + p.r)) * 0.04;
      s.vx -= (dx / d) * f; s.vy -= (dy / d) * f;
      p.vx += (dx / d) * f * 0.3; p.vy += (dy / d) * f * 0.3;
    });
    for (const n of [root, ...S]) {
      n.vx -= n.x * 0.0025; n.vy -= n.y * 0.0025;
      n.vx *= 0.8; n.vy *= 0.8;
      n.x += clamp(n.vx, -6, 6); n.y += clamp(n.vy, -6, 6);
    }
    root.x *= 0.9; root.y *= 0.9;
  }

  private drawGraph(ctx: Ctx, box: Box, t: number, now: number, th: Theme, opts: { card?: boolean }) {
    const card = !!opts.card;
    this.step(t, now);
    const { nodes } = this.data;
    const S = this.sim!, root = this.root, m = this.m;
    const top = box.y + 4, bottom = box.y + box.h - (card ? 4 : 92);
    if (!card) this.watermark(ctx, th, now, t, box.x + box.w, bottom - 6, Math.min(96, box.w * 0.22), box.w * 0.5);
    // the camera keeps the whole graph in view as it grows; a wide card stretches it sideways
    let x0 = root.x - root.r, x1 = root.x + root.r, y0 = root.y - root.r, y1 = root.y + root.r;
    S.forEach((s) => { if (s.vis > 0.3) { x0 = Math.min(x0, s.x - s.r); x1 = Math.max(x1, s.x + s.r); y0 = Math.min(y0, s.y - s.r); y1 = Math.max(y1, s.y + s.r); } });
    const sy = Math.min((bottom - top - (card ? 14 : 30)) / Math.max(y1 - y0, 120), 3);
    const sx = Math.min((box.w - 60) / Math.max(x1 - x0, 120), card ? sy * 1.8 : sy);
    const cam = this.cam;
    cam.s += (Math.min(sx, sy) - cam.s) * 0.06;
    cam.sx += (sx - cam.sx) * 0.06;
    cam.x += ((x0 + x1) / 2 - cam.x) * 0.06;
    cam.y += ((y0 + y1) / 2 - cam.y) * 0.06;
    const cxm = box.x + box.w / 2, cym = (top + bottom) / 2;
    const X = (x: number) => cxm + (x - cam.x) * (card ? cam.sx : cam.s);
    const Y = (y: number) => cym + (y - cam.y) * cam.s;
    const R = (r: number) => Math.max(1.2, r * cam.s * 0.9);
    const pos = (i: number) => (i < 0 ? root : S[i]);

    ctx.lineWidth = 1;
    nodes.forEach((n, i) => {
      const s = S[i];
      if (s.vis < 0.03) return;
      const p = pos(n.parent);
      ctx.strokeStyle = th.faint;
      ctx.lineWidth = 1;
      ctx.globalAlpha = s.vis * 0.9;
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(s.x), Y(s.y)); ctx.stroke();
      if (s.glow > 0.15) { ctx.strokeStyle = this.colour(th, n.key); ctx.lineWidth = 1.5; ctx.globalAlpha = s.glow * 0.8 * s.vis; ctx.stroke(); }
    });
    for (let i = nodes.length - 1; i >= 0; i--) {
      const s = S[i];
      if (s.vis < 0.03) continue;
      const c = this.colour(th, nodes[i].key), r = R(s.r);
      if (s.glow > 0.05) { ctx.globalAlpha = s.glow * 0.35 * s.vis; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), r + 7 * s.glow, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = s.vis;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.ink;
    ctx.beginPath(); ctx.arc(X(root.x), Y(root.y), R(root.r), 0, Math.PI * 2); ctx.fill();

    // labels: the repo, its top-level folders and the biggest folders below; none on top of another
    const boxes: number[][] = [];
    const labelled = new Set<number>();
    const label = (i: number, size: number, weight: number, color: string, alpha: number) => {
      const p = pos(i);
      const name = i < 0 ? m.name : `${nodes[i].path.split('/').pop()}/`;
      const y = Y(p.y) + R(i < 0 ? root.r : S[i].r) + size + 2;
      const w = this.measure(ctx, name, size, weight);
      const b = [X(p.x) - w / 2 - 3, y - size, X(p.x) + w / 2 + 3, y + 4];
      if (boxes.some((o) => o[0] < b[2] && b[0] < o[2] && o[1] < b[3] && b[1] < o[3])) return;
      boxes.push(b);
      ctx.fillStyle = th.surface;
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      ctx.globalAlpha = alpha;
      this.text(ctx, name, X(p.x), y, size, weight, color, 'center');
      ctx.globalAlpha = 1;
      labelled.add(i);
    };
    label(-1, card ? 11.5 : 13, 700, th.ink, 1);
    const firsts = nodes.map((n, i) => i).filter((i) => nodes[i].depth === 1 && S[i].vis > 0.5 && S[i].last >= (card ? 1 : 8) && R(S[i].r) > (card ? 2 : 0)).sort((a, b) => S[b].last - S[a].last);
    for (const i of firsts) label(i, card ? 10.5 : 12, 700, th.ink, S[i].vis);
    if (!card) {
      const deep = nodes.map((n, i) => i).filter((i) => nodes[i].depth === 2 && S[i].vis > 0.6 && S[i].last >= 30).sort((a, b) => S[b].last - S[a].last).slice(0, 4);
      for (const i of deep) label(i, 11, 500, th.muted, S[i].vis * 0.9);
      // a new folder is named for a moment as it appears
      this.callouts = this.callouts.filter((c) => now - c.at < 1800);
      for (const c of this.callouts) {
        if (labelled.has(c.i)) continue;
        const k = (now - c.at) / 1800, a = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        label(c.i, 11, 600, th.ink, a * S[c.i].vis);
      }
      this.legend(ctx, th, t, box.x, box.x + box.w, box.y + box.h - 72);
      const X2 = (a: number) => box.x + ((a - m.t0) / this.span()) * box.w;
      this.activity(ctx, th, box.x, box.x + box.w, box.y + box.h - 44, 22, m.t0, m.t1, t, X2);
      const xp = X2(t);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xp, box.y + box.h - 48); ctx.lineTo(xp, box.y + box.h - 20); ctx.stroke();
    }
  }

  /** The colour key under the graph, with live counts. */
  private legend(ctx: Ctx, th: Theme, t: number, xl: number, xr: number, y: number) {
    const s = this.interp(t), m = this.m;
    let x = xl, yy = y;
    for (let k = 0; k < s.v.length; k++) {
      if (s.v[k] < 0.5) continue;
      const name = k < m.series.length ? `${m.series[k]}/` : 'other', v = fmt(s.v[k]);
      const w = 14 + this.measure(ctx, name, 12, 700) + 6 + this.measure(ctx, v, 12, 500) + 16;
      if (x + w > xr && x > xl) { x = xl; yy += 18; }
      if (yy > y + 18) break;
      ctx.fillStyle = this.colour(th, k);
      ctx.beginPath(); ctx.arc(x + 4, yy - 4, 4, 0, Math.PI * 2); ctx.fill();
      const nw = this.text(ctx, name, x + 14, yy, 12, 700, th.ink);
      this.text(ctx, v, x + 14 + nw + 6, yy, 12, 500, th.muted);
      x += w;
    }
  }
}
