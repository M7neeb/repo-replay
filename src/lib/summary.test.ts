import { expect, it } from 'vitest';
import { formatDate, plural, summarize } from './summary';
import type { Replay } from '../../shared/replay';

const t = (iso: string) => Date.parse(iso) / 1000;

function replay(firstIso: string, headIso: string, rows: Replay['timeline'], snapshots: [string, number][]): Replay {
  return {
    format: 1,
    builtAt: '',
    repo: { owner: 'a', name: 'b', description: null, stars: 0, branch: 'main', head: 'h', headAt: t(headIso), firstAt: t(firstIso), commits: rows.reduce((s, r) => s + r[1], 0), sampled: false },
    timeline: rows,
    authors: [{ name: 'x', login: null, avatar: null }, { name: 'y', login: null, avatar: null }],
    paths: [],
    snapshots: snapshots.map(([iso, files]) => ({ sha: iso, at: t(iso), files, bytes: 0, truncated: false, entries: [] })),
    moments: [],
  };
}

it('groups a long history by year', () => {
  const s = summarize(replay('2019-03-01', '2024-06-01', [
    [t('2019-03-01'), 1, 10, 0, 1, 0],
    [t('2019-09-01'), 1, 5, 2, 1, 1],
    [t('2024-06-01'), 1, 1, 1, 1, 0],
  ], [['2019-09-01', 4], ['2024-06-01', 9]]));
  expect(s.byMonth).toBe(false);
  expect(s.periods).toEqual([
    { label: '2019', commits: 2, added: 15, deleted: 2, files: 4, newPeople: 2 },
    { label: '2024', commits: 1, added: 1, deleted: 1, files: 9, newPeople: 0 },
  ]);
  expect(s.files).toBe(9);
});

it('groups a young project by month', () => {
  const s = summarize(replay('2026-01-10', '2026-03-02', [
    [t('2026-01-10'), 1, 1, 0, 1, 0],
    [t('2026-03-02'), 1, 1, 0, 1, 0],
  ], [['2026-03-02', 2]]));
  expect(s.byMonth).toBe(true);
  expect(s.periods.map((p) => p.label)).toEqual(['Jan 2026', 'Mar 2026']);
});

it('writes dates and counts the way people read them', () => {
  expect(formatDate(t('2016-11-26T10:00:00Z'))).toBe('26 Nov 2016');
  expect(plural(1, 'commit', 'commits')).toBe('1 commit');
  expect(plural(3412, 'commit', 'commits')).toBe('3,412 commits');
});
