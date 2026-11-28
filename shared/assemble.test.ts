import { expect, it } from 'vitest';
import { assemble, median, typical } from './assemble';
import { bucketEdges, BUCKETS, pieceKey, type Piece } from './pieces';

it('takes the middle value', () => {
  expect(median([])).toBe(0);
  expect(median([5])).toBe(5);
  expect(median([1, 100, 3])).toBe(3);
  expect(median([1, 2, 3, 1000])).toBe(2.5);
});

it('averages a sample without its biggest and smallest tenth', () => {
  const twenty = [...Array.from({ length: 18 }, (_, i) => 10 + i), 5_000_000, 0];
  // drops 0, 10 and 27, 5,000,000; keeps 11..26
  expect(typical(twenty)).toBe(18.5);
  expect(typical([1, 100, 3])).toBe(3);
});

it('estimates a sampled period from its typical commit, so one huge commit cannot blow it up', () => {
  const head = 'a'.repeat(40);
  const key = pieceKey('o', 'r', head);
  const edges = bucketEdges(0, 6000, BUCKETS);
  const pieces: Piece[] = [
    { kind: 'repo', key, repo: { owner: 'o', name: 'r', description: null, stars: 0, branch: 'main', head, headAt: 6000, firstAt: 0, commits: 60_000, sampled: true } },
    {
      kind: 'buckets', key, from: 0,
      buckets: Array.from({ length: BUCKETS }, (_, i) => ({ since: edges[i], until: edges[i + 1] - 1, count: 1000, shas: i === 59 ? [head, 'b'.repeat(40), 'c'.repeat(40)] : [] })),
      authors: [],
      samples: Array.from({ length: BUCKETS }, (_, i) => (i === 59 ? [[6000, 10, 2, 1, -1], [5990, 5_000_000, 0, 900, -1], [5980, 20, 4, 3, -1]] : [])),
    },
    { kind: 'tree', key, sha: head, depth: 0, files: 1, bytes: 1, truncated: false, part: 0, parts: 1, entries: [['a', 1, 1]] },
  ];
  const last = assemble(pieces, 'now').timeline.at(-1)!;
  expect(last.slice(1, 5)).toEqual([1000, 20_000, 2000, 3000]);
});
