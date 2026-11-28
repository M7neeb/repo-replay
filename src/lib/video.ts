import { fmt, layout, monthYear, rowAt, THEMES, type ChartModel, type Layout, type ThemeName } from '../../shared/chart';
import { captionAt, captionParts } from './playback';

// One frame of the saved video: a square that reads well on a phone, drawn straight onto a canvas from
// the same chart layout the page and the README card use. The chart is laid out at half size and drawn
// at twice the scale, so its labels come out big enough to read in a chat.

export const VIDEO_SIZE = 1080;
const S = 2;
const PAD = 72;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`;
const CHART_Y = 440;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Frame {
  model: ChartModel;
  layout: Layout;
  commits: number;
  theme: ThemeName;
}

export function videoFrame(model: ChartModel, commits: number, theme: ThemeName): Frame {
  return { model, commits, theme, layout: layout(model, { width: (VIDEO_SIZE - PAD * 2) / S, top: 0, height: 150, gutter: 12, left: 40 }) };
}

const pts = (s: string) => s.split(' ').map((p) => p.split(',').map(Number) as [number, number]);

function path(ctx: Ctx, points: [number, number][], close: boolean) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(PAD + x * S, CHART_Y + y * S) : ctx.moveTo(PAD + x * S, CHART_Y + y * S)));
  if (close) ctx.closePath();
}

/** The text in at most `size` px, smaller if it would not fit `width`. */
function fitFont(ctx: Ctx, text: string, weight: number, size: number, width: number): number {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  return w > width ? Math.floor((size * width) / w) : size;
}

/** Draws the replay as it stands at `progress` (0 to 1). */
export function drawFrame(ctx: Ctx, f: Frame, progress: number) {
  const { model, layout: L } = f;
  const th = THEMES[f.theme];
  const colour = (k: number) => (k === model.series.length ? th.other : th.series[k]);
  const p = Math.min(1, Math.max(0, progress));
  const t = model.t0 + p * (model.t1 - model.t0);
  const row = rowAt(model, t);
  const W = VIDEO_SIZE;

  ctx.fillStyle = th.surface;
  ctx.fillRect(0, 0, W, W);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // the site's mark and name
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD + 3, 70);
  ctx.lineTo(PAD + 30, 70);
  ctx.stroke();
  ctx.strokeStyle = th.series[0];
  ctx.lineWidth = 3.3;
  ctx.beginPath();
  [[4.5, 65.5], [10.5, 58], [16.5, 61], [22.5, 52], [28.5, 46]].forEach(([x, y], i) => (i ? ctx.lineTo(PAD + x, y) : ctx.moveTo(PAD + x, y)));
  ctx.stroke();
  ctx.font = `600 28px ${FONT}`;
  ctx.fillStyle = th.muted;
  ctx.fillText('repo-replay', PAD + 44, 72);

  // repo, span, count
  const title = `${model.owner}/${model.name}`;
  const size = fitFont(ctx, title, 700, 56, W - PAD * 2);
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.fillStyle = th.muted;
  ctx.fillText(`${model.owner}/`, PAD, 150);
  const ownerW = ctx.measureText(`${model.owner}/`).width;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.fillStyle = th.ink;
  ctx.fillText(model.name, PAD + ownerW, 150);
  ctx.font = `400 30px ${FONT}`;
  ctx.fillStyle = th.muted;
  ctx.fillText(`${monthYear(model.t0)} to ${monthYear(model.t1)} · ${fmt(f.commits)} ${f.commits === 1 ? 'commit' : 'commits'}`, PAD, 198);

  const count = `${fmt(row.files)} ${row.files === 1 ? 'file' : 'files'}`;
  ctx.font = `700 100px ${FONT}`;
  ctx.fillStyle = th.ink;
  ctx.fillText(count, PAD, 318);
  const countW = ctx.measureText(count).width;
  ctx.font = `400 36px ${FONT}`;
  ctx.fillStyle = th.muted;
  ctx.fillText(`in ${monthYear(row.at)}`, PAD + countW + 22, 318);

  drawCaption(ctx, captionAt(model, t), th);

  // grid and axis
  ctx.lineWidth = 2;
  ctx.textAlign = 'right';
  for (const g of L.grid) {
    ctx.strokeStyle = th.grid;
    ctx.beginPath();
    ctx.moveTo(PAD + L.plot.x * S, CHART_Y + g.y * S);
    ctx.lineTo(PAD + (L.plot.x + L.plot.w) * S, CHART_Y + g.y * S);
    ctx.stroke();
    ctx.font = `400 26px ${FONT}`;
    ctx.fillStyle = th.muted;
    ctx.fillText(g.label, PAD + (L.plot.x - 8) * S, CHART_Y + (g.y + 5) * S);
  }
  const base = CHART_Y + (L.plot.y + L.plot.h) * S;
  ctx.strokeStyle = th.faint;
  ctx.beginPath();
  ctx.moveTo(PAD + L.plot.x * S, base + 1);
  ctx.lineTo(PAD + (L.plot.x + L.plot.w) * S, base + 1);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = `400 28px ${FONT}`;
  ctx.fillStyle = th.muted;
  for (const y of L.years) {
    ctx.beginPath();
    ctx.moveTo(PAD + y.x * S, base);
    ctx.lineTo(PAD + y.x * S, base + 8);
    ctx.stroke();
    ctx.fillText(y.label, PAD + y.x * S, base + 44);
  }

  // the data, revealed up to now
  const x = PAD + L.X(t) * S;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, x, W);
  ctx.clip();
  for (const b of L.bands) {
    path(ctx, pts(b.points), true);
    ctx.globalAlpha = th.fill;
    ctx.fillStyle = colour(b.key);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const e of L.edges) {
    const line = pts(e.points);
    path(ctx, line, false);
    ctx.strokeStyle = th.surface;
    ctx.lineWidth = 4 * S;
    ctx.stroke();
    path(ctx, line, false);
    ctx.strokeStyle = colour(e.key);
    ctx.lineWidth = 2 * S;
    ctx.stroke();
  }
  ctx.restore();

  // milestones that have happened, and the playhead
  ctx.textAlign = 'left';
  for (const m of L.flags) {
    if (m.at > t) continue;
    ctx.strokeStyle = th.muted;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD + m.x * S, CHART_Y + (m.ly + 5) * S);
    ctx.lineTo(PAD + m.x * S, CHART_Y + (m.y - 5) * S);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.surface;
    ctx.beginPath();
    ctx.arc(PAD + m.x * S, CHART_Y + m.y * S, 5.5 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.ink;
    ctx.beginPath();
    ctx.arc(PAD + m.x * S, CHART_Y + m.y * S, 3.5 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 30px ${FONT}`;
    ctx.textAlign = m.anchor === 'end' ? 'right' : 'left';
    ctx.fillText(m.when, PAD + (m.anchor === 'end' ? m.x - 5 : m.x + 5) * S, CHART_Y + m.ly * S);
  }
  if (p < 1) {
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, CHART_Y + (L.plot.y - 2) * S);
    ctx.lineTo(x, base);
    ctx.stroke();
  }

  drawLegend(ctx, model, colour, th);
}

function drawCaption(ctx: Ctx, caption: string, th: (typeof THEMES)[ThemeName]) {
  if (!caption) return;
  const size = 40;
  const width = VIDEO_SIZE - PAD * 2;
  const words = captionParts(caption).flatMap((part) => part.text.split(/(?<= )/).filter(Boolean).map((text) => ({ text, code: part.code })));
  const lines: { text: string; code: boolean; w: number }[][] = [[]];
  let used = 0;
  for (const word of words) {
    ctx.font = word.code ? `600 ${size * 0.9}px ${MONO}` : `500 ${size}px ${FONT}`;
    const w = ctx.measureText(word.text.trimEnd()).width + (word.code ? 20 : 0);
    const gap = word.text.endsWith(' ') ? ctx.measureText(' ').width : 0;
    if (used + w > width && lines[lines.length - 1].length) {
      if (lines.length === 2) break;
      lines.push([]);
      used = 0;
    }
    lines[lines.length - 1].push({ text: word.text.trimEnd(), code: word.code, w });
    used += w + gap;
  }
  lines.forEach((line, i) => {
    let x = PAD;
    const y = 384 + i * 52;
    for (const word of line) {
      if (word.code) {
        ctx.fillStyle = th.grid;
        ctx.strokeStyle = th.faint;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y - size * 0.86, word.w, size * 1.12, 8);
        ctx.fill();
        ctx.stroke();
        ctx.font = `600 ${size * 0.9}px ${MONO}`;
        ctx.fillStyle = th.ink;
        ctx.fillText(word.text, x + 10, y);
      } else {
        ctx.font = `500 ${size}px ${FONT}`;
        ctx.fillStyle = th.ink;
        ctx.fillText(word.text, x, y);
      }
      ctx.font = `500 ${size}px ${FONT}`;
      x += word.w + ctx.measureText(' ').width;
    }
  });
}

function drawLegend(ctx: Ctx, model: ChartModel, colour: (k: number) => string, th: (typeof THEMES)[ThemeName]) {
  ctx.font = `400 28px ${FONT}`;
  ctx.textAlign = 'left';
  let x = PAD;
  let y = 1000;
  for (let k = 0; k <= model.series.length; k++) {
    if (model.rows.every((r) => r.v[k] === 0)) continue;
    const label = k === model.series.length ? 'other' : `${model.series[k]}/`;
    const w = 34 + ctx.measureText(label).width + 30;
    if (x + w > VIDEO_SIZE - PAD + 30) {
      if (y > 1000) break;
      x = PAD;
      y += 44;
    }
    ctx.fillStyle = colour(k);
    ctx.beginPath();
    ctx.roundRect(x, y - 22, 24, 24, 5);
    ctx.fill();
    ctx.fillStyle = th.muted;
    ctx.fillText(label, x + 34, y);
    x += w;
  }
}
