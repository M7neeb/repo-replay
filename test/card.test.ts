import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeGitHub, memoryKV, type FakeRepo } from './fakeGitHub';
import { apiFor } from './app';
import { loadReplay } from '../src/lib/build';
import { lightSnapshots } from '../shared/chart';
import { cardInput } from '../shared/cardInput';
import { decodeBundle } from '../shared/bundle';
import { xmlProblems } from './xml';
import type { Env } from '../server/env';

const DAY = 86400;
const NOW = Math.floor(Date.parse('2026-11-20T12:00:00Z') / 1000);
const repos: FakeRepo[] = [
  { owner: 'ana', name: 'notes', commits: 3, files: 2, firstAt: NOW - 20 * DAY, headAt: NOW - DAY },
  { owner: 'Acme', name: 'Widget', commits: 3000, files: 1800, firstAt: NOW - 1500 * DAY, headAt: NOW, people: 40 },
  { owner: 'big', name: 'kernel', commits: 250_000, files: 900, firstAt: NOW - 7000 * DAY, headAt: NOW, people: 300 },
  { owner: 'wide', name: 'mono', commits: 400, files: 12_000, firstAt: NOW - 900 * DAY, headAt: NOW },
];
let env: Env;
let kv: ReturnType<typeof memoryKV>;

beforeEach(() => {
  const gh = fakeGitHub(repos);
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => gh.fetch(String(input), init));
  kv = memoryKV();
  env = { GITHUB_TOKEN: 'test-token', REPLAYS: kv.kv };
});
afterEach(() => vi.unstubAllGlobals());

const get = async (path: string) => {
  const res = await apiFor(env)(path);
  return { res, text: await res.text() };
};

it('draws the card from the saved replay, and its numbers match the full replay', async () => {
  for (const r of repos) {
    const { replay } = await loadReplay({ owner: r.owner, name: r.name }, { api: apiFor(env) });
    const stored = [...kv.store].find(([k]) => k.startsWith('replay:v1:' + r.owner.toLowerCase()))![1].value;
    const input = cardInput(decodeBundle(stored)!.pieces)!;
    const full = lightSnapshots(replay);
    expect(input.snapshots.map((s) => [s.at, s.files, Object.fromEntries(s.counts)]), r.name).toEqual(full.map((s) => [s.at, s.files, Object.fromEntries(s.counts)]));

    for (const theme of ['', '?theme=dark']) {
      const { res, text } = await get(`/api/card/${r.owner}/${r.name}.svg${theme}`);
      expect(res.headers.get('content-type')).toContain('image/svg+xml');
      expect(xmlProblems(text), r.name).toEqual([]);
      expect(text).toContain(`${r.owner}/`);
      expect(text).toContain('Files over time');
      expect(text).toContain(theme ? '#0d1117' : '#ffffff');
    }
  }
}, 60_000);

it('shows how to make the card for a repo nobody has replayed yet', async () => {
  const { res, text } = await get('/api/card/someone/unknown.svg');
  expect(res.status).toBe(200);
  expect(xmlProblems(text)).toEqual([]);
  expect(text).toContain('No replay of this project yet');
  expect(text).toContain('/someone/unknown once to make it');
});

it('does not draw a copy saved by an older build', async () => {
  await loadReplay({ owner: 'ana', name: 'notes' }, { api: apiFor(env) });
  for (const [k, v] of kv.store) if (k.startsWith('replay:')) kv.store.set(k, { value: v.value, metadata: { builtAt: 'x', build: 1 } });
  expect((await get('/api/card/ana/notes.svg')).text).toContain('No replay of this project yet');
});

it('only answers for .svg names and real repo names', async () => {
  expect((await get('/api/card/ana/notes')).res.status).toBe(404);
  expect((await get('/api/card/-bad-/notes.svg')).res.status).toBe(404);
});
