import type { Page, Route } from '@playwright/test';
import { bucketEdges, BUCKETS, encodePiece, pieceKey, type Header } from '../shared/pieces';
import { encodeBundle, encodePieces } from '../shared/bundle';
import type { RepoInfo } from '../shared/replay';

// Fake server answers for the page. Signatures are dummies: only the server checks them.
const DAY = 24 * 3600;
const headAt = Date.parse('2026-11-20T12:00:00Z') / 1000;
const firstAt = Date.parse('2016-11-26T09:00:00Z') / 1000;
const sha = (n: number) => n.toString(16).padStart(40, '0');

export function fakeRepo(owner = 'sveltejs', name = 'svelte'): { repo: RepoInfo; pieces: { header: Header; data: object }[] } {
  const head = sha(1);
  const repo: RepoInfo = { owner, name, description: 'Cybernetically enhanced web apps', stars: 81234, branch: 'main', head, headAt, firstAt, commits: 4, sampled: false };
  const key = pieceKey(owner, name, head);
  const authors = [{ name: 'Rich', login: 'rich', avatar: null }, { name: 'Simon', login: 'simon', avatar: null }];
  const commits = [
    [sha(1), headAt, 50, 10, 3, 1],
    [sha(2), headAt - 400 * DAY, 400, 20, 9, 0],
    [sha(3), firstAt + 30 * DAY, 120, 5, 4, 1],
    [sha(4), firstAt, 900, 0, 12, 0],
  ] as const;
  const tree = (s: string, files: number) => ({
    header: { kind: 'tree', key, sha: s, depth: 1, files, bytes: files * 100, truncated: false, part: 0, parts: 1 } as Header,
    data: { entries: [['README.md', 100, 1], ['src/', (files - 1) * 100, files - 1]] },
  });
  return {
    repo,
    pieces: [
      { header: { kind: 'repo', key, repo }, data: {} },
      {
        header: { kind: 'commits', key, after: null, next: null, shas: commits.map((c) => c[0]) },
        data: { authors, rows: commits.map(([, at, add, del, files, a]) => [at, add, del, files, a]) },
      },
      tree(sha(4), 12),
      tree(sha(2), 140),
      tree(sha(1), 212),
    ],
  };
}

const signed = (p: { header: Header; data: object }) => ({ body: encodePiece(p.header, p.data), sig: '0'.repeat(64) });

// A long history as the server samples it: 60 time slices with 100 commits each, and the latest files.
function sampledRepo(owner: string, name: string) {
  const { repo: base, pieces } = fakeRepo(owner, name);
  const repo: RepoInfo = { ...base, commits: BUCKETS * 100, sampled: true };
  const key = pieceKey(owner, name, repo.head);
  const edges = bucketEdges(repo.firstAt, repo.headAt, BUCKETS);
  const buckets = edges.slice(0, -1).map((since, i) => ({ since, until: edges[i + 1] - 1, count: 100, shas: i === BUCKETS - 1 ? [repo.head] : [] }));
  const samples = buckets.map((_, i) => (i === BUCKETS - 1 ? [[repo.headAt, 50, 10, 3, 0]] : []));
  return {
    pieces: [
      { header: { kind: 'repo', key, repo } as Header, data: {} },
      { header: { kind: 'buckets', key, from: 0, buckets } as Header, data: { authors: [{ name: 'Rich', login: 'rich', avatar: null }], samples } },
      pieces.at(-1)!,
    ],
  };
}

export async function serveSaved(page: Page, owner = 'sveltejs', name = 'svelte', opts: { sampled?: boolean } = {}) {
  const { pieces } = opts.sampled ? sampledRepo(owner, name) : fakeRepo(owner, name);
  await page.route(`**/api/replay/${owner}/${name}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'x-replay-bundle': '1' }, body: encodeBundle('2026-11-25T10:00:00.000Z', encodePieces(pieces.map(signed))) }),
  );
}

/** The saved replay the home page shows as its example. */
export async function serveShowcase(page: Page) {
  const { pieces } = fakeRepo();
  await page.route('**/api/saved/sveltejs/svelte', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'x-replay-bundle': '1' }, body: encodeBundle('2026-11-25T10:00:00.000Z', encodePieces(pieces.map(signed))) }),
  );
}

export async function serveBuild(page: Page, opts: { slow?: boolean } = {}) {
  const { repo, pieces } = fakeRepo();
  const [repoPiece, commits, ...trees] = pieces.map(signed);
  const wait = () => (opts.slow ? new Promise((r) => setTimeout(r, 400)) : Promise.resolve());
  await page.route('**/api/replay/sveltejs/svelte', async (route) => {
    await wait();
    await route.fulfill({ json: { status: 'build', repo, piece: repoPiece } });
  });
  await page.route('**/api/history?*', async (route) => {
    await wait();
    await route.fulfill({ json: { piece: commits } });
  });
  await page.route('**/api/trees?*', async (route: Route) => {
    await wait();
    const shas = new URL(route.request().url()).searchParams.get('shas')!.split(',');
    const out = trees.filter((t) => shas.some((s) => t.body.includes(`"sha":"${s}"`)));
    await route.fulfill({ json: { pieces: out, depth: 1, split: [] } });
  });
  await page.route('**/api/replay', (route) => route.fulfill({ json: { saved: true } }));
}

export async function serveError(page: Page, status: number, body: object) {
  await page.route('**/api/replay/*/*', (route) => route.fulfill({ status, json: body }));
}

/** Records anything the page's security rules block, as the browser reports it. */
export async function watchBlocked(page: Page) {
  await page.addInitScript(() => {
    const list: string[] = [];
    (window as unknown as { blocked: string[] }).blocked = list;
    document.addEventListener('securitypolicyviolation', (e) => list.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
}

export const blocked = (page: Page) => page.evaluate(() => (window as unknown as { blocked: string[] }).blocked);
