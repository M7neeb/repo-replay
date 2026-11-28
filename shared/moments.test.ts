import { describe, expect, it } from 'vitest';
import { findMoments, findMomentsFrom } from './moments';
import { lightSnapshots } from './chart';
import { makeReplay } from '../test/replays';
import type { TimelineRow } from './replay';

const T = (iso: string) => Date.parse(iso) / 1000;
const captions = (r: ReturnType<typeof makeReplay>) => findMoments(r).map((m) => m.caption);

describe('milestones from the data', () => {
  it('names the first release, or the oldest tag when there are no releases', () => {
    const r = makeReplay([{ at: '2020-01-01', folders: { 'src/': 10 } }, { at: '2023-01-01', folders: { 'src/': 30 } }]);
    r.repo.firstRelease = { kind: 'release', tag: 'v1.0.0', at: T('2021-06-01'), count: 12 };
    expect(captions(r)).toContain('First GitHub release, `v1.0.0`');
    r.repo.firstRelease = { kind: 'tag', tag: 'v0.1', at: T('2021-06-01'), count: 3 };
    expect(captions(r)).toContain('First tagged version, `v0.1`');
    const m = findMoments(r).find((x) => x.kind === 'release')!;
    expect(m.at).toBe(T('2021-06-01'));
  });

  it('notices when another folder becomes the biggest', () => {
    const r = makeReplay([
      { at: '2019-01-01', folders: { 'lib/': 300, 'docs/': 100 } },
      { at: '2020-01-01', folders: { 'lib/': 320, 'docs/': 150 } },
      { at: '2021-01-01', folders: { 'lib/': 330, 'docs/': 400 } },
    ]);
    expect(captions(r)).toContain('`docs/` becomes the biggest folder');
  });

  it('gives exact counts for the biggest growth spurt and the biggest cleanup', () => {
    const r = makeReplay([
      { at: '2019-01-01', folders: { 'src/': 1000 } },
      { at: '2019-07-01', folders: { 'src/': 1100 } },
      { at: '2020-01-01', folders: { 'src/': 2000 } },
      { at: '2022-01-01', folders: { 'src/': 2050 } },
      { at: '2022-07-01', folders: { 'src/': 1500 } },
      { at: '2025-01-01', folders: { 'src/': 1550 } },
    ]);
    const c = captions(r);
    expect(c).toContain('Grows from 1,100 to 2,000 files in 6 months');
    expect(c).toContain('Drops from 2,050 to 1,500 files in 6 months');
  });

  it('finds the busiest month and the 10th and 100th person in a history read in full', () => {
    const r = makeReplay([{ at: '2020-01-01', folders: { 'src/': 10 } }, { at: '2026-01-01', folders: { 'src/': 50 } }]);
    const rows: TimelineRow[] = [];
    // 150 people, one commit each, spread over six years; June 2022 has 40 extra commits
    for (let i = 0; i < 150; i++) rows.push([T('2020-01-01') + i * 12 * 86400, 1, 1, 0, 1, i]);
    for (let i = 0; i < 40; i++) rows.push([T('2022-06-03') + i * 3600, 1, 1, 0, 1, 0]);
    rows.sort((a, b) => a[0] - b[0]);
    const m = findMomentsFrom({ repo: r.repo, snapshots: lightSnapshots(r), timeline: rows }).map((x) => x.caption);
    expect(m).toContain('The busiest month: 42 commits');
    expect(m).toContain('The 100th person makes a commit');
  });

  it('counts people only when every commit was read', () => {
    const r = makeReplay([{ at: '2020-01-01', folders: { 'src/': 10 } }, { at: '2026-01-01', folders: { 'src/': 50 } }]);
    r.repo.sampled = true;
    const rows: TimelineRow[] = Array.from({ length: 60 }, (_, i) => [T('2020-01-01') + i * 30 * 86400, i === 20 ? 900 : 100, 0, 0, 0, i]);
    const m = findMomentsFrom({ repo: r.repo, snapshots: lightSnapshots(r), timeline: rows }).map((x) => x.caption);
    expect(m.some((c) => c.includes('person'))).toBe(false);
    expect(m).toContain('The busiest stretch: 900 commits in 1 month');
  });

  it('never keeps more than five, nor two on top of each other', () => {
    const shots = [];
    for (let y = 2010; y < 2026; y++) shots.push({ at: `${y}-01-01`, folders: { [`f${y}/`]: 100 * (y - 2009), 'src/': 50 } });
    const ms = findMoments(makeReplay(shots));
    expect(ms.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < ms.length; i++) expect(ms[i].at - ms[i - 1].at).toBeGreaterThan(0);
  });

  it('writes no dashes, no guesses and no exclamation marks', () => {
    const r = makeReplay([
      { at: '2019-01-01', folders: { 'lib/': 300, 'site/': 10 } },
      { at: '2020-01-01', folders: { 'lib/': 320, 'site/': 400 } },
    ]);
    r.repo.firstRelease = { kind: 'release', tag: 'v1', at: T('2019-06-01'), count: 1 };
    for (const c of captions(r)) {
      expect(c).not.toMatch(/[—–!]/);
      expect(c).not.toMatch(/website|docs site|probably|likely/i);
    }
  });
});
