import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeGitHub, memoryKV, type FakeRepo } from './fakeGitHub';
import { apiFor } from './app';
import { loadReplay, loadSaved } from '../src/lib/build';
import { readPng } from './png';
import { withMeta } from '../server/share';
import type { Env } from '../server/env';

const DAY = 86400;
const NOW = Math.floor(Date.parse('2026-11-20T12:00:00Z') / 1000);
const repos: FakeRepo[] = [
  { owner: 'Acme', name: 'Widget', commits: 3000, files: 1800, firstAt: NOW - 1500 * DAY, headAt: NOW, people: 40 },
  { owner: 'big', name: 'kernel', commits: 250_000, files: 900, firstAt: NOW - 7000 * DAY, headAt: NOW, people: 300 },
];
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let env: Env;

beforeEach(() => {
  const gh = fakeGitHub(repos);
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => gh.fetch(String(input), init));
  env = {
    GITHUB_TOKEN: 'test-token',
    REPLAYS: memoryKV().kv,
    ASSETS: { fetch: async () => new Response(indexHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }) } as unknown as Fetcher,
  };
});
afterEach(() => vi.unstubAllGlobals());

const meta = (html: string, key: string) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html)?.[1];

it('gives a replay link the repo’s own title, description and picture', async () => {
  const { replay } = await loadReplay({ owner: 'Acme', name: 'Widget' }, { api: apiFor(env) });
  const res = await apiFor(env)('/Acme/Widget');
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).toContain('<title>Acme/Widget · repo-replay</title>');
  expect(meta(html, 'og:title')).toBe('How Acme/Widget grew');
  const files = replay.snapshots.at(-1)!.files.toLocaleString('en-US');
  expect(meta(html, 'og:description')).toBe(`${files} files and 3,000 commits since ${new Date(replay.repo.firstAt * 1000).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}. A short replay of how it grew, with the big moments marked.`);
  expect(meta(html, 'description')).toBe(meta(html, 'og:description'));
  expect(meta(html, 'og:image')).toBe(`https://repo-replay.test/api/og/Acme/Widget.png?v=${replay.repo.head.slice(0, 12)}`);
  expect(meta(html, 'twitter:card')).toBe('summary_large_image');
  // every tag replaced in place, none added twice
  expect(html.match(/<meta /g)?.length).toBe(indexHtml.match(/<meta /g)?.length);
  expect(html).toContain('<script type="module"');
}, 30_000);

it('shows the site’s picture for a repo nobody has replayed yet', async () => {
  const html = await (await apiFor(env)('/someone/unknown')).text();
  expect(meta(html, 'og:title')).toBe('How someone/unknown grew');
  expect(meta(html, 'og:image')).toBe('https://repo-replay.test/preview.png');
  expect(html).toContain('<title>someone/unknown · repo-replay</title>');
});

it('leaves other two-part paths to the static files', async () => {
  expect(await (await apiFor(env)('/api/replay')).text()).toBe('static');
  expect(await (await apiFor(env)('/bad..owner/x')).text()).toBe('static');
});

it('escapes whatever goes into the page head', () => {
  const html = withMeta(indexHtml, { title: 'a</title><script>', ogTitle: '"><script>', description: 'x" onload="y', image: 'https://e/?a=1&b=2', imageAlt: '<b>' });
  expect(html).not.toContain('<script>');
  expect(html).toContain('content="x&quot; onload=&quot;y"');
  expect(html).toContain('content="https://e/?a=1&amp;b=2"');
});

it('draws the share picture for a saved replay, and keeps it for a week when the link names the build', async () => {
  for (const r of repos) {
    const { replay } = await loadReplay({ owner: r.owner, name: r.name }, { api: apiFor(env) });
    const v = replay.repo.head.slice(0, 12);
    const res = await apiFor(env)(`/api/og/${r.owner}/${r.name}.png?v=${v}`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800');
    const img = readPng(new Uint8Array(await res.arrayBuffer()));
    expect([img.w, img.h], r.name).toEqual([1200, 630]);
    expect(img.rows.length).toBe((1200 * 3 + 1) * 630);
    const old = await apiFor(env)(`/api/og/${r.owner}/${r.name}.png?v=000000000000`);
    expect(old.headers.get('cache-control')).toBe('public, max-age=3600');
  }
}, 60_000);

it('sends the site picture for repos without a replay, and refuses odd names', async () => {
  const res = await apiFor(env)('/api/og/someone/unknown.png');
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('https://repo-replay.test/preview.png');
  expect((await apiFor(env)('/api/og/someone/unknown.svg')).status).toBe(404);
  expect((await apiFor(env)('/api/og/-bad/x.png')).status).toBe(404);
});

it('hands out saved replays without asking GitHub, as text the network can compress', async () => {
  const { replay } = await loadReplay({ owner: 'Acme', name: 'Widget' }, { api: apiFor(env) });
  const log: string[] = [];
  const calls = vi.fn();
  vi.stubGlobal('fetch', calls);
  const again = await loadSaved({ owner: 'Acme', name: 'Widget' }, { api: apiFor(env, log) });
  expect(calls).not.toHaveBeenCalled();
  expect(again?.repo).toEqual(replay.repo);
  expect(again?.snapshots).toEqual(replay.snapshots);
  const res = await apiFor(env)('/api/saved/Acme/Widget');
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(await loadSaved({ owner: 'someone', name: 'unknown' }, { api: apiFor(env) })).toBeNull();
}, 30_000);

it('sends a saved copy from the start endpoint as compressible text too', async () => {
  await loadReplay({ owner: 'Acme', name: 'Widget' }, { api: apiFor(env) });
  const res = await apiFor(env)('/api/replay/Acme/Widget');
  expect(res.headers.get('x-replay-bundle')).toBe('1');
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  const loaded = await loadReplay({ owner: 'Acme', name: 'Widget' }, { api: apiFor(env) });
  expect(loaded.cached).toBe(true);
}, 30_000);
