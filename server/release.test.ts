import { expect, it } from 'vitest';
import { firstRelease } from './release';

const iso = (d: string) => `${d}T00:00:00Z`;

it('takes the older of the first GitHub release and the oldest tag', () => {
  const both = {
    releases: { totalCount: 40, nodes: [{ tagName: 'svelte@4.0.0', createdAt: iso('2023-06-22') }] },
    refs: { totalCount: 800, nodes: [{ name: 'v0.1.0', target: { committedDate: iso('2016-11-26') } }] },
  };
  expect(firstRelease(both)).toMatchObject({ kind: 'tag', tag: 'v0.1.0' });
  const releaseFirst = { ...both, refs: { totalCount: 2, nodes: [{ name: 'later', target: { target: { committedDate: iso('2024-01-01') } } }] } };
  expect(firstRelease(releaseFirst)).toMatchObject({ kind: 'release', tag: 'svelte@4.0.0' });
});

it('reads an annotated tag through to its commit, and copes with neither', () => {
  expect(firstRelease({ releases: { totalCount: 0, nodes: [] }, refs: { totalCount: 1, nodes: [{ name: 'v1', target: { target: { committedDate: iso('2020-01-01') } } }] } }))
    .toMatchObject({ kind: 'tag', tag: 'v1', at: Date.parse('2020-01-01') / 1000 });
  expect(firstRelease({ releases: { totalCount: 0, nodes: [] }, refs: { totalCount: 0, nodes: [] } })).toBeUndefined();
});
