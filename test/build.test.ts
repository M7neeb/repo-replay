import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGitHub, memoryKV, type FakeRepo } from './fakeGitHub';
import { apiFor } from './app';
import { loadReplay, LoadError, snapshotLimit } from '../src/lib/build';
import { BUCKETS, MAX_ENTRIES, MAX_PIECES, MAX_SNAPSHOTS } from '../shared/pieces';
import { MAX_PARTS } from '../functions/api/trees';
import type { Env } from '../server/env';
import { BUILD } from '../shared/bundle';

const DAY = 24 * 3600;
const NOW = Math.floor(Date.parse('2026-11-20T12:00:00Z') / 1000);

const tiny: FakeRepo = { owner: 'ana', name: 'notes', commits: 3, files: 2, firstAt: NOW - 20 * DAY, headAt: NOW - DAY };
const medium: FakeRepo = { owner: 'Acme', name: 'Widget', commits: 3000, files: 1800, firstAt: NOW - 1500 * DAY, headAt: NOW, people: 40 };
const huge: FakeRepo = { owner: 'big', name: 'kernel', commits: 250_000, files: 900, firstAt: NOW - 7000 * DAY, headAt: NOW, people: 300, strayDates: 40, futureDates: 25 };
const wide: FakeRepo = { owner: 'wide', name: 'mono', commits: 400, files: 12_000, firstAt: NOW - 900 * DAY, headAt: NOW };
const empty: FakeRepo = { owner: 'ana', name: 'empty', commits: 0, files: 0, firstAt: NOW, headAt: NOW };
const single: FakeRepo = { owner: 'ana', name: 'hello', commits: 1, files: 1, firstAt: NOW, headAt: NOW };

let gh: ReturnType<typeof fakeGitHub>;

function setup(options?: Parameters<typeof fakeGitHub>[1], withKv = true) {
  gh = fakeGitHub([tiny, medium, huge, wide, empty, single], options);
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => gh.fetch(String(input), init));
  const kv = memoryKV();
  const env: Env = { GITHUB_TOKEN: 'test-token', REPLAYS: withKv ? kv.kv : undefined };
  return { env, kv, api: apiFor(env) };
}

beforeEach(() => setup());
afterEach(() => vi.unstubAllGlobals());

describe('building a replay', () => {
  it('reads a tiny repo commit by commit', async () => {
    const { api } = setup();
    const out = await loadReplay({ owner: 'ana', name: 'notes' }, { api });
    expect(out.cached).toBe(false);
    expect(out.saved).toBe(true);
    const r = out.replay;
    expect(r.repo.sampled).toBe(false);
    expect(r.repo.commits).toBe(3);
    expect(r.timeline).toHaveLength(3);
    expect(r.timeline.map((row) => row[0])).toEqual([...r.timeline.map((row) => row[0])].sort((a, b) => a - b));
    expect(r.repo.firstAt).toBe(tiny.firstAt);
    expect(r.snapshots).toHaveLength(3);
    expect(r.snapshots.at(-1)!.sha).toBe(r.repo.head);
    expect(r.snapshots.at(-1)!.files).toBe(2);
    expect(r.authors.map((a) => a.name).sort()).toEqual(['Person 0', 'Person 1', 'Person 2']);
  });

  it('reads a medium repo fully and keeps every snapshot grouped the same way', async () => {
    const { api } = setup();
    const progress: string[] = [];
    const out = await loadReplay({ owner: 'acme', name: 'widget' }, { api, onProgress: (p) => progress.push(p.stage) });
    const r = out.replay;
    expect(r.repo.owner).toBe('Acme');
    expect(r.repo.sampled).toBe(false);
    expect(r.timeline).toHaveLength(3000);
    expect(r.timeline.reduce((s, row) => s + row[1], 0)).toBe(3000);
    expect(r.authors).toHaveLength(40);
    expect(r.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(r.snapshots.at(-1)!.files).toBe(1800);
    for (const s of r.snapshots) expect(s.entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
    // 3,000 commits at 500 per call
    expect(gh.calls.filter((c) => c === 'graphql:History')).toHaveLength(30);
    expect(progress[0]).toBe('start');
    expect(progress).toContain('history');
    expect(progress).toContain('files');
    expect(progress.at(-1)).toBe('save');
  });

  it('samples a huge history by time instead of reading every commit', async () => {
    const { api } = setup();
    const out = await loadReplay({ owner: 'big', name: 'kernel' }, { api });
    const r = out.replay;
    expect(r.repo.sampled).toBe(true);
    expect(r.repo.commits).toBe(250_000);
    expect(r.timeline).toHaveLength(60);
    expect(r.timeline.reduce((s, row) => s + row[1], 0)).toBe(250_000);
    expect(gh.calls.filter((c) => c === 'graphql:History')).toHaveLength(0);
    expect(gh.calls.filter((c) => c === 'graphql:Buckets')).toHaveLength(12);
    expect(r.snapshots.length).toBeGreaterThan(50);
    expect(r.snapshots.length).toBeLessThanOrEqual(MAX_SNAPSHOTS);
    expect(r.snapshots.at(-1)!.sha).toBe(r.repo.head);
    expect(out.saved).toBe(true);
  });

  it('reads file lists too big for one call in parts and adds them up', async () => {
    const { api, kv } = setup();
    const log: string[] = [];
    const out = await loadReplay({ owner: 'wide', name: 'mono' }, { api: (path, init) => (log.push(path), api(path, init)) });
    const r = out.replay;
    const head = r.snapshots.at(-1)!;
    expect(head.sha).toBe(r.repo.head);
    expect(head.files).toBe(12_000);
    expect(head.entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
    for (const s of r.snapshots) expect(s.entries.reduce((n, e) => n + e[2], 0)).toBe(s.files);
    expect(log.some((p) => p.includes('part=1'))).toBe(true);
    expect(out.saved).toBe(true);
    // the saved copy opens to the same thing
    const again = await loadReplay({ owner: 'wide', name: 'mono' }, { api });
    expect(again.cached).toBe(true);
    expect(again.replay.snapshots).toEqual(r.snapshots);
    expect(kv.writes()).toBe(1);
  }, 60_000);

  it('never collects more pieces than the server accepts, however many parts a file list needs', () => {
    for (let parts = 1; parts <= MAX_PARTS; parts++) {
      const trees = snapshotLimit(parts) * parts;
      expect(1 + BUCKETS + trees, `${parts} parts`).toBeLessThanOrEqual(MAX_PIECES);
      expect(snapshotLimit(parts)).toBeGreaterThanOrEqual(4);
    }
  });

  it('asks for one time slice at a time when GitHub times out on five', async () => {
    const { api } = setup({ maxBucketsPerQuery: 1, flakyBuckets: [7] });
    const out = await loadReplay({ owner: 'big', name: 'kernel' }, { api });
    expect(out.replay.timeline).toHaveLength(60);
    expect(out.replay.timeline.reduce((s, row) => s + row[1], 0)).toBe(250_000);
    expect(out.saved).toBe(true);
  });

  it('gives up when one time slice keeps failing', async () => {
    const { api } = setup({ maxBucketsPerQuery: 1, flakyBuckets: [7, 7] });
    await expect(loadReplay({ owner: 'big', name: 'kernel' }, { api })).rejects.toMatchObject({ kind: 'upstream' });
  });

  it('opens from the saved copy the second time without reading the history again', async () => {
    const { api, kv } = setup();
    const first = await loadReplay({ owner: 'acme', name: 'widget' }, { api });
    const before = gh.calls.length;
    const second = await loadReplay({ owner: 'ACME', name: 'widget' }, { api });
    expect(second.cached).toBe(true);
    expect(second.replay.timeline).toEqual(first.replay.timeline);
    expect(second.replay.snapshots).toEqual(first.replay.snapshots);
    const after = gh.calls.slice(before);
    expect(after).toEqual(['graphql:Meta', 'rest:rate_limit']);
    expect(kv.writes()).toBe(1);
  });

  it('builds again over a copy saved by an older build, and only shows that copy while GitHub is busy', async () => {
    const { env, kv } = setup();
    await loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor(env) });
    const [key, entry] = [...kv.store][0];
    kv.store.set(key, { value: entry.value, metadata: { builtAt: '2026-11-25T00:00:00.000Z' } });
    const again = await loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor(env) });
    expect(again.cached).toBe(false);
    expect((kv.store.get(key)!.metadata as { build: number }).build).toBe(BUILD);
    kv.store.set(key, { value: entry.value, metadata: { builtAt: '2026-11-25T00:00:00.000Z' } });
    gh.state.graphqlLeft = 0;
    const busy = await loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor(env) });
    expect(busy.stale).toBe(true);
  });

  it('still builds when nothing can be saved', async () => {
    const { api } = setup(undefined, false);
    const out = await loadReplay({ owner: 'ana', name: 'notes' }, { api });
    expect(out.saved).toBe(false);
    expect(out.replay.timeline).toHaveLength(3);
  });
});

describe('when something is wrong', () => {
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return err as LoadError;
    }
    throw new Error('expected a failure');
  };

  it('says a missing or private repo was not found', async () => {
    const err = await failure(loadReplay({ owner: 'ana', name: 'secret' }, { api: apiFor(setup().env) }));
    expect(err.kind).toBe('not_found');
  });

  it('says an empty repo or a single commit has nothing to replay', async () => {
    const { api } = setup();
    expect((await failure(loadReplay({ owner: 'ana', name: 'empty' }, { api }))).kind).toBe('empty');
    expect((await failure(loadReplay({ owner: 'ana', name: 'hello' }, { api }))).kind).toBe('empty');
  });

  it('says when GitHub can be asked again once the hourly allowance is too low for a build', async () => {
    const resetAt = NOW + 3600;
    const { api } = setup({ graphqlLeft: 10, resetAt });
    const err = await failure(loadReplay({ owner: 'acme', name: 'widget' }, { api }));
    expect(err.kind).toBe('busy');
    expect(err.retryAt).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    expect(gh.calls.filter((c) => c === 'graphql:History')).toHaveLength(0);
  });

  it('says busy when the file allowance runs out', async () => {
    const { api } = setup({ coreLeft: 20 });
    expect((await failure(loadReplay({ owner: 'acme', name: 'widget' }, { api }))).kind).toBe('busy');
  });

  it('still opens a saved replay while GitHub is busy', async () => {
    const { env, kv } = setup();
    await loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor(env) });
    gh.state.graphqlLeft = 0;
    const out = await loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor(env) });
    expect(out.cached).toBe(true);
    expect(out.stale).toBe(true);
    expect(kv.store.size).toBe(1);
  });

  it('tells the page when the server has no GitHub token', async () => {
    const err = await failure(loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor({}) }));
    expect(err.kind).toBe('not_configured');
  });

  it('reports a lost connection as offline', async () => {
    const err = await failure(loadReplay({ owner: 'ana', name: 'notes' }, { api: () => Promise.reject(new TypeError('fetch failed')) }));
    expect(err.kind).toBe('offline');
  });

  it('stops when the visitor switches to another repo', async () => {
    const { api } = setup();
    const controller = new AbortController();
    const run = loadReplay({ owner: 'acme', name: 'widget' }, {
      api,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage === 'history' && p.done >= 500) controller.abort();
      },
    });
    await expect(run).rejects.toThrow();
    expect(gh.calls.filter((c) => c === 'graphql:History').length).toBeLessThan(30);
  });
});
