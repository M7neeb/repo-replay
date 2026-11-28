import { describe, expect, it } from 'vitest';
import { cardSvg, chartModel, layout, liveChartSvg, rowAt, topFolder } from './chart';
import { findMoments } from './moments';
import { makeReplay, svelteLike } from '../test/replays';
import { xmlProblems } from '../test/xml';

describe('the chart model', () => {
  it('stacks files by top folder and keeps every file counted', () => {
    const r = svelteLike();
    const m = chartModel(r);
    expect(m.series[0]).toBe('packages');
    expect(m.series).toContain('test');
    expect(m.series).not.toContain('(files)');
    for (const row of m.rows.slice(1)) expect(row.v.reduce((a, b) => a + b, 0)).toBe(row.files);
    expect(m.rows[0]).toMatchObject({ at: r.repo.firstAt, files: 0 });
  });

  it('starts at the files of the first commit when that snapshot exists', () => {
    const r = makeReplay([{ at: '2020-01-01', folders: { 'src/': 12 } }, { at: '2021-01-01', folders: { 'src/': 40 } }]);
    const m = chartModel(r);
    expect(m.rows).toHaveLength(2);
    expect(rowAt(m, m.t0).files).toBe(12);
  });

  it('names top folders the way the chart uses them', () => {
    expect(topFolder('packages/svelte/src/')).toBe('packages');
    expect(topFolder('README.md')).toBe('(files)');
    expect(topFolder('/')).toBe('(files)');
  });

  it('finds the snapshot in force at any moment', () => {
    const m = chartModel(svelteLike());
    expect(rowAt(m, Date.parse('2023-12-01') / 1000).files).toBe(5943);
    expect(rowAt(m, m.t0).files).toBe(0);
  });
});

describe('milestones', () => {
  it('finds the real turning points and states only what the data shows', () => {
    const moments = findMoments(svelteLike());
    const captions = moments.map((m) => m.caption);
    expect(captions[0]).toBe('First commit');
    expect(captions).toContain('`site/` arrives');
    expect(captions).toContain('`packages/` arrives and `test/` is gone');
    expect(captions).toContain('`sites/` is removed');
    expect(moments.length).toBeLessThanOrEqual(5);
    expect(moments.map((m) => m.at)).toEqual([...moments.map((m) => m.at)].sort((a, b) => a - b));
  });

  it('ignores tooling folders and tiny folders', () => {
    const r = makeReplay([
      { at: '2020-01-01', folders: { 'src/': 500 } },
      { at: '2021-01-01', folders: { 'src/': 600, '.github/': 40, 'docs/': 3 } },
    ]);
    expect(findMoments(r).map((m) => m.caption)).toEqual(['First commit']);
  });

  it('claims nothing from a file list GitHub cut short', () => {
    const r = makeReplay([
      { at: '2020-01-01', folders: { 'include/': 900, 'drivers/': 900 } },
      { at: '2021-01-01', folders: { 'drivers/': 1500, 'arch/': 400 } },
    ]);
    r.snapshots[1].truncated = true;
    expect(findMoments(r).map((m) => m.caption)).toEqual(['First commit']);
  });

  it('marks passing 1,000 files', () => {
    const r = makeReplay([
      { at: '2020-01-01', folders: { 'src/': 900 } },
      { at: '2022-01-01', folders: { 'src/': 1200 } },
    ]);
    expect(findMoments(r).map((m) => m.caption)).toContain('Passes 1,000 files');
  });
});

describe('the README card', () => {
  const model = chartModel(svelteLike(), findMoments(svelteLike()));

  it('is valid SVG in every form GitHub might be sent', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const at of [undefined, 0, 0.4, 1]) expect(xmlProblems(cardSvg(model, { theme, at })), `${theme} ${at}`).toEqual([]);
    }
  });

  it('carries no scripts or outside files, so the image proxy can serve it', () => {
    const svg = cardSvg(model, { theme: 'dark' });
    expect(svg).not.toMatch(/<script|href=|url\(http|@import|<foreignObject/i);
    expect(svg).toContain('#0d1117');
    expect(svg).toContain('sveltejs/');
  });

  it('stops moving for people who ask for less motion', () => {
    expect(cardSvg(model, { theme: 'light' })).toContain('prefers-reduced-motion');
  });

  it('never places two milestone labels on top of each other', () => {
    for (const width of [360, 440, 800, 1000]) {
      const L = layout(model, { width, top: 0, height: 200, gutter: 16 });
      const boxes = L.flags.map((f) => {
        const w = (f.when.length + f.text.length + 1) * 8.4;
        return { ly: f.ly, l: f.anchor === 'end' ? f.x - w : f.x, r: f.anchor === 'end' ? f.x : f.x + w };
      });
      for (const a of boxes) for (const b of boxes) if (a !== b && a.ly === b.ly) expect(a.r < b.l || b.r < a.l, `width ${width}`).toBe(true);
    }
  });

  it('labels milestones with only the year on narrow charts', () => {
    const L = layout(model, { width: 360, top: 0, height: 170, gutter: 16 });
    expect(L.flags.every((f) => f.text === '')).toBe(true);
  });
});

describe('the player chart', () => {
  it('is valid SVG with the hooks the player moves', () => {
    const { svg } = liveChartSvg(chartModel(svelteLike(), findMoments(svelteLike())), 380, 'c1');
    expect(xmlProblems(svg)).toEqual([]);
    expect(svg).toContain('data-reveal');
    expect(svg).toContain('data-playhead');
    expect(svg).toContain('data-at=');
  });

  it('copes with a history of one day', () => {
    const r = makeReplay([{ at: '2026-11-01T10:00:00Z', folders: { 'src/': 3 } }, { at: '2026-11-01T12:00:00Z', folders: { 'src/': 4 } }]);
    expect(xmlProblems(cardSvg(chartModel(r, findMoments(r)), { theme: 'light' }))).toEqual([]);
  });
});

describe('folder names from a repo are untrusted', () => {
  it('cannot inject markup into the chart or the card', () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const r = makeReplay([
      { at: '2020-01-01', folders: { 'src/': 100 } },
      { at: '2021-01-01', folders: { 'src/': 100, [`${evil}/`]: 400 } },
    ], { owner: 'a', name: 'b' });
    const model = chartModel(r, findMoments(r));
    expect(model.moments.some((m) => m.caption.includes(evil))).toBe(true);
    for (const svg of [liveChartSvg(model, 900, 'x').svg, cardSvg(model, { theme: 'light' }), cardSvg(model, { theme: 'dark', at: 1 })]) {
      expect(svg).not.toContain('<img');
      expect(xmlProblems(svg)).toEqual([]);
    }
  });
});
