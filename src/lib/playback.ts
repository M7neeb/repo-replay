import { rowAt, type ChartModel, type ChartRow } from '../../shared/chart';
import type { Moment } from '../../shared/replay';

/** 30 s for a small project, up to 60 s for a very long history, so people watch to the end. */
export function durationFor(commits: number): number {
  const scale = Math.min(1, Math.max(0, Math.log10(Math.max(commits, 10)) - 1) / 4);
  return Math.round(30 + 30 * scale);
}

/** Playback runs at an even pace through calendar time. */
export function timeAt(model: ChartModel, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return model.t0 + p * (model.t1 - model.t0);
}

/** The latest milestone already reached at time t, while it is still recent (a tenth of the history). */
export function momentAt(moments: Moment[], t: number, span = Infinity): Moment | null {
  let found: Moment | null = null;
  for (const m of moments) if (m.at <= t) found = m;
  return found && t - found.at <= span / 10 ? found : null;
}

/**
 * What to say when no milestone is recent: the biggest folder at that point, straight from the counts.
 * When the last milestone already named it, say it is still the biggest rather than repeat the news.
 */
export function standingCaption(model: ChartModel, row: ChartRow, last: Moment | null = null): string {
  let best = -1;
  model.series.forEach((_, k) => {
    if (row.v[k] > 0 && (best === -1 || row.v[k] > row.v[best])) best = k;
  });
  if (best === -1) return '';
  const name = model.series[best];
  if (last?.kind === 'top-folder' && last.data.folder === name) return `\`${name}/\` is still the biggest folder`;
  return `The biggest folder is \`${name}/\``;
}

/** 89863 -> 89.9k, so a line of stats fits a phone. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${+(n / 1000).toFixed(n < 10_000 ? 1 : n < 100_000 ? 1 : 0)}k`;
  return `${+(n / 1_000_000).toFixed(1)}M`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Splits a caption into plain text and `folder/` names so the page can set names in code type. */
export function captionParts(caption: string): { code: boolean; text: string }[] {
  return caption.split('`').map((text, i) => ({ code: i % 2 === 1, text })).filter((p) => p.text);
}

/** Where a README card lives, in either style and theme. */
export function cardUrl(origin: string, owner: string, name: string, style: 'ticker' | 'graph', dark: boolean): string {
  const q = [style === 'graph' && 'style=graph', dark && 'theme=dark'].filter(Boolean).join('&');
  return `${origin}/api/card/${owner}/${name}.svg${q ? `?${q}` : ''}`;
}

/** The README snippet: the card in GitHub's light and dark themes, linking back to the replay. */
export function readmeSnippet(origin: string, owner: string, name: string, style: 'ticker' | 'graph' = 'ticker'): string {
  // & is written as &amp; so the line is valid HTML wherever it's pasted
  const url = (dark: boolean) => cardUrl(origin, owner, name, style, dark).replace(/&/g, '&amp;');
  return `<a href="${origin}/${owner}/${name}"><picture><source media="(prefers-color-scheme: dark)" srcset="${url(true)}"><img alt="How ${owner}/${name} grew" src="${url(false)}"></picture></a>`;
}

/** The caption at time t: a recent milestone, else what stands out in the counts. The player and the video share it. */
export function captionAt(model: ChartModel, t: number): string {
  const recent = momentAt(model.moments, t, model.t1 - model.t0);
  return recent?.caption ?? standingCaption(model, rowAt(model, t), momentAt(model.moments, t));
}
