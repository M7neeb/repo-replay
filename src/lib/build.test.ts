import { expect, it } from 'vitest';
import { pickSnapshots } from './build';
import { MAX_SNAPSHOTS } from '../../shared/pieces';

const commits = (n: number) => Array.from({ length: n }, (_, i) => ({ sha: `c${i}`, at: i }));

it('takes every commit when there are few', () => {
  expect(pickSnapshots(commits(4), 'c3')).toEqual(['c0', 'c1', 'c2', 'c3']);
});

it('spreads the most snapshots allowed from the first commit to the head', () => {
  const picked = pickSnapshots(commits(1000), 'c999');
  expect(picked).toHaveLength(MAX_SNAPSHOTS);
  expect(picked[0]).toBe('c0');
  expect(picked.at(-1)).toBe('c999');
  expect(new Set(picked).size).toBe(MAX_SNAPSHOTS);
});
