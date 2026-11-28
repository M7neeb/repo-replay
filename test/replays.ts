import type { Replay } from '../shared/replay';

// Made-up replays built from a list of snapshots given as { 'folder/': files }.
export function makeReplay(
  shots: { at: string; folders: Record<string, number> }[],
  opts: { owner?: string; name?: string; first?: string; commits?: number } = {},
): Replay {
  const T = (iso: string) => Date.parse(iso) / 1000;
  const paths: string[] = [];
  const idx = (p: string) => {
    let i = paths.indexOf(p);
    if (i === -1) i = paths.push(p) - 1;
    return i;
  };
  const snapshots = shots.map((s, n) => {
    const entries = Object.entries(s.folders).filter(([, f]) => f > 0).map(([p, f]) => [idx(p), f * 100, f] as [number, number, number]);
    const files = entries.reduce((a, e) => a + e[2], 0);
    return { sha: String(n).padStart(40, '0'), at: T(s.at), files, bytes: files * 100, truncated: false, entries };
  });
  const firstAt = T(opts.first ?? shots[0].at);
  const headAt = snapshots[snapshots.length - 1].at;
  return {
    format: 1,
    builtAt: '2026-11-28T00:00:00.000Z',
    repo: { owner: opts.owner ?? 'acme', name: opts.name ?? 'widget', description: null, stars: 0, branch: 'main', head: snapshots[snapshots.length - 1].sha, headAt, firstAt, commits: opts.commits ?? 100, sampled: false },
    timeline: snapshots.map((s) => [s.at, 1, 1, 0, 1, -1]),
    authors: [],
    paths,
    snapshots,
    moments: [],
  };
}

/** Roughly svelte's real shape: tests early on, a website that comes and goes, a move into packages/. */
export function svelteLike(): Replay {
  return makeReplay([
    { at: '2017-01-13', folders: { 'test/': 471, 'src/': 80, 'README.md': 13 } },
    { at: '2018-01-16', folders: { 'test/': 1500, 'src/': 120, 'README.md': 13 } },
    { at: '2019-01-18', folders: { 'test/': 1900, 'src/': 150, 'site/': 360, 'README.md': 18 } },
    { at: '2021-05-20', folders: { 'test/': 3900, 'src/': 190, 'site/': 650, 'README.md': 18 } },
    { at: '2023-05-24', folders: { 'test/': 4597, 'src/': 231, 'site/': 659, '.github/': 8, 'README.md': 19 } },
    { at: '2023-11-23', folders: { 'packages/': 4810, 'documentation/': 703, 'sites/': 354, '.changeset/': 60, 'README.md': 16 } },
    { at: '2024-09-24', folders: { 'packages/': 6200, 'documentation/': 800, 'sites/': 1500, '.changeset/': 120, 'README.md': 16 } },
    { at: '2025-03-23', folders: { 'packages/': 7100, 'documentation/': 180, '.changeset/': 150, 'README.md': 18 } },
    { at: '2026-11-27', folders: { 'packages/': 10033, 'documentation/': 111, 'benchmarking/': 33, '.changeset/': 160, 'README.md': 18 } },
  ], { owner: 'sveltejs', name: 'svelte', first: '2016-11-16', commits: 11549 });
}
