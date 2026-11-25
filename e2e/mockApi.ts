import type { Page, Route } from '@playwright/test';
import { encodePiece, pieceKey, type Header } from '../shared/pieces';
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

export async function serveSaved(page: Page, owner = 'sveltejs', name = 'svelte') {
  const { pieces } = fakeRepo(owner, name);
  await page.route(`**/api/replay/${owner}/${name}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/x-repo-replay', body: encodeBundle('2026-11-25T10:00:00.000Z', encodePieces(pieces.map(signed))) }),
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
