import { fmt, monthYear, rowAt, THEMES, type ChartModel, type ThemeName } from '../../shared/chart';
import type { Stage } from './stage';
import { captionAt, captionParts } from './playback';

// One frame of the saved video: a square that reads well on a phone, with the same picture as the page
// (live ticker or graph) under the repo's name, count and caption.

export const VIDEO_SIZE = 1080;
const S = 2;
const PAD = 72;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`;
const CHART_Y = 440;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Frame {
  model: ChartModel;
  stage: Stage;
  commits: number;
  theme: ThemeName;
  /** seconds the replay itself lasts, for the milestone pulse */
  duration: number;
}

/** The text in at most `size` px, smaller if it would not fit `width`. */
function fitFont(ctx: Ctx, text: string, weight: number, size: number, width: number): number {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  return w > width ? Math.floor((size * width) / w) : size;
}

/** Draws the replay as it stands at `progress` (0 to 1); `now` is the frame's time in ms. Frames go in order. */
export function drawFrame(ctx: Ctx, f: Frame, progress: number, now: number) {
  const { model } = f;
  const th = THEMES[f.theme];
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

  // the picture itself, from the same stage the page draws, at twice the scale so its labels read in a chat
  ctx.save();
  ctx.translate(PAD - 8, CHART_Y);
  ctx.scale(S, S);
  f.stage.draw(ctx, { x: 0, y: 0, w: (W - PAD * 2 + 16) / S, h: (W - CHART_Y - 28) / S }, t, now, { theme: f.theme, ending: p >= 1, duration: f.duration });
  ctx.restore();
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
