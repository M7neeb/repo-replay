import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeGitHub, memoryKV } from './fakeGitHub';
import { apiFor } from './app';
import type { Env } from '../server/env';
import { decodeHeader, decodePiece, type Signed, type TreeHeader } from '../shared/pieces';
import { decodeBundle, encodePieces } from '../shared/bundle';
import type { StartResponse, TreesResponse, PieceResponse } from '../shared/api';
import { assemble } from '../shared/assemble';
import { sign } from '../server/sign';

const NOW = Math.floor(Date.parse('2026-11-20T12:00:00Z') / 1000);
let env: Env;
let kv: ReturnType<typeof memoryKV>;

beforeEach(() => {
  const gh = fakeGitHub([
    { owner: 'ana', name: 'notes', commits: 3, files: 2, firstAt: NOW - 1000, headAt: NOW },
    { owner: 'bob', name: 'other', commits: 3, files: 2, firstAt: NOW - 1000, headAt: NOW },
  ]);
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => gh.fetch(String(input), init));
  kv = memoryKV();
  env = { GITHUB_TOKEN: 'test-token', REPLAYS: kv.kv };
});
afterEach(() => vi.unstubAllGlobals());

async function collect(owner: string, name: string): Promise<Signed[]> {
  const api = apiFor(env);
  const start = (await (await api(`/api/replay/${owner}/${name}`)).json()) as StartResponse;
  const q = `repo=${start.repo.owner}/${start.repo.name}&head=${start.repo.head}`;
  const page = (await (await api(`/api/history?${q}`)).json()) as PieceResponse;
  const tree = (await (await api(`/api/trees?${q}&shas=${start.repo.head}`)).json()) as TreesResponse;
  return [start.piece, page.piece, ...tree.pieces];
}

async function post(pieces: Signed[]) {
  const res = await apiFor(env)('/api/replay', { method: 'POST', body: encodePieces(pieces) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

it('stores a replay made only of pieces it handed out', async () => {
  const res = await post(await collect('ana', 'notes'));
  expect(res).toEqual({ status: 200, body: { saved: true } });
  const [key, { value }] = [...kv.store][0];
  expect(key).toMatch(/^replay:v1:ana\/notes@[0-9a-f]{40}$/);
  const bundle = decodeBundle(value)!;
  const replay = assemble(bundle.pieces.map((s) => decodePiece(s.body)), bundle.builtAt);
  expect(replay.timeline).toHaveLength(3);
});

it('refuses a piece that was changed on the way back', async () => {
  const pieces = await collect('ana', 'notes');
  pieces[2] = { body: pieces[2].body.replace('"files":2', '"files":999999'), sig: pieces[2].sig };
  expect(pieces[2].body).toContain('999999');
  expect((await post(pieces)).body).toMatchObject({ error: 'rejected', message: 'bad signature' });
  expect(kv.store.size).toBe(0);
});

it('refuses a piece signed with a different key', async () => {
  const pieces = await collect('ana', 'notes');
  pieces[2] = await sign('someone-elses-token', decodeHeader(pieces[2].body) as TreeHeader, { entries: [] });
  expect((await post(pieces)).body).toMatchObject({ error: 'rejected' });
});

it('refuses pieces from two different repos', async () => {
  const mine = await collect('ana', 'notes');
  const theirs = await collect('bob', 'other');
  expect((await post([mine[0], mine[1], theirs[2]])).body).toMatchObject({ error: 'rejected', message: 'pieces from another repo or commit' });
});

it('refuses a build with part of the history left out', async () => {
  const pieces = await collect('ana', 'notes');
  expect((await post([pieces[0], pieces[2]])).body).toMatchObject({ error: 'rejected', message: 'history is incomplete' });
});

it('refuses rubbish', async () => {
  const res = await apiFor(env)('/api/replay', { method: 'POST', body: 'not\nthree lines' });
  expect(res.status).toBe(400);
  expect((await post([])).status).toBe(400);
  const pieces = await collect('ana', 'notes');
  pieces[0] = { sig: pieces[0].sig, body: 'nonsense\n{}' };
  expect((await post(pieces)).status).toBe(422);
});

it('rejects malformed step requests before calling GitHub', async () => {
  const api = apiFor(env);
  for (const path of [
    '/api/history?repo=ana/notes&head=nothex',
    '/api/history?repo=ana&head=' + 'a'.repeat(40),
    '/api/trees?repo=ana/notes&head=' + 'a'.repeat(40) + '&shas=',
    '/api/trees?repo=ana/notes&head=' + 'a'.repeat(40) + '&shas=' + Array(11).fill('a'.repeat(40)).join(','),
    '/api/buckets?repo=ana/notes&head=' + 'a'.repeat(40) + '&first=1&last=2&from=5&to=5',
    '/api/replay/-bad-/notes',
  ]) {
    expect((await api(path)).status, path).toBe(400);
  }
});
