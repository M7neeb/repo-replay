import { expect, it } from 'vitest';
import { bucketEdges } from './pieces';

it('splits the history into equal buckets that cover the head commit', () => {
  const edges = bucketEdges(1000, 7000, 60);
  expect(edges).toHaveLength(61);
  expect(edges[0]).toBe(1000);
  expect(edges[60]).toBe(7001);
  for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
});

it('still gives distinct buckets when all commits are on the same second', () => {
  const edges = bucketEdges(5000, 5000, 60);
  expect(new Set(edges).size).toBe(61);
});
