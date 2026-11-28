import { expect, it } from 'vitest';
import { captionParts, clock, compact, durationFor, momentAt, readmeSnippet, standingCaption, timeAt } from './playback';
import { chartModel } from '../../shared/chart';
import { makeReplay } from '../../test/replays';

it('plays for 30 to 60 seconds whatever the size of the project', () => {
  expect(durationFor(3)).toBe(30);
  expect(durationFor(100)).toBeGreaterThan(30);
  expect(durationFor(11_549)).toBeLessThanOrEqual(60);
  expect(durationFor(1_509_040)).toBe(60);
});

it('moves evenly through the calendar and stays inside it', () => {
  const m = chartModel(makeReplay([{ at: '2020-01-01', folders: { 'a/': 1 } }, { at: '2022-01-01', folders: { 'a/': 2 } }]));
  expect(timeAt(m, 0)).toBe(m.t0);
  expect(timeAt(m, 1)).toBe(m.t1);
  expect(timeAt(m, 2)).toBe(m.t1);
  expect(timeAt(m, 0.5)).toBe((m.t0 + m.t1) / 2);
});

it('shows the latest milestone already reached', () => {
  const ms = [{ at: 10, kind: 'a', data: {}, caption: 'one' }, { at: 20, kind: 'b', data: {}, caption: 'two' }];
  expect(momentAt(ms, 5)).toBeNull();
  expect(momentAt(ms, 15)?.caption).toBe('one');
  expect(momentAt(ms, 20)?.caption).toBe('two');
});

it('lets a milestone go once it is old and says what is true instead', () => {
  const ms = [{ at: 0, kind: 'first-commit', data: {}, caption: 'First commit' }];
  expect(momentAt(ms, 5, 100)?.caption).toBe('First commit');
  expect(momentAt(ms, 50, 100)).toBeNull();
  const m = chartModel(makeReplay([{ at: '2020-01-01', folders: { 'src/': 10, 'docs/': 30 } }, { at: '2022-01-01', folders: { 'src/': 50, 'docs/': 30 } }]));
  expect(standingCaption(m, m.rows[0])).toBe('The biggest folder is `docs/`');
  expect(standingCaption(m, m.rows[1])).toBe('The biggest folder is `src/`');
  const news = { at: 0, kind: 'top-folder', data: { folder: 'src' }, caption: '`src/` becomes the biggest folder' };
  expect(standingCaption(m, m.rows[1], news)).toBe('`src/` is still the biggest folder');
  expect(standingCaption(m, m.rows[0], news)).toBe('The biggest folder is `docs/`');
});

it('shortens big counts for one line on a phone', () => {
  expect(compact(950)).toBe('950');
  expect(compact(89_863)).toBe('89.9k');
  expect(compact(256_910)).toBe('257k');
  expect(compact(1_509_040)).toBe('1.5M');
});

it('writes times and captions the way the page shows them', () => {
  expect(clock(0)).toBe('0:00');
  expect(clock(53.4)).toBe('0:53');
  expect(clock(60)).toBe('1:00');
  expect(captionParts('`packages/` arrives and `test/` is gone')).toEqual([
    { code: true, text: 'packages/' }, { code: false, text: ' arrives and ' }, { code: true, text: 'test/' }, { code: false, text: ' is gone' },
  ]);
});

it('gives a README line with both themes that links back to the replay', () => {
  const s = readmeSnippet('https://repo-replay.pages.dev', 'sveltejs', 'svelte');
  expect(s).toContain('href="https://repo-replay.pages.dev/sveltejs/svelte"');
  expect(s).toContain('srcset="https://repo-replay.pages.dev/api/card/sveltejs/svelte.svg?theme=dark"');
  expect(s).toContain('src="https://repo-replay.pages.dev/api/card/sveltejs/svelte.svg"');
  expect(s).toContain('(prefers-color-scheme: dark)');
});

it('gives the graph style its own line, written as valid HTML', () => {
  const s = readmeSnippet('https://repo-replay.pages.dev', 'sveltejs', 'svelte', 'graph');
  expect(s).toContain('srcset="https://repo-replay.pages.dev/api/card/sveltejs/svelte.svg?style=graph&amp;theme=dark"');
  expect(s).toContain('src="https://repo-replay.pages.dev/api/card/sveltejs/svelte.svg?style=graph"');
});
