import type { CommitRow, RawAuthor } from '../shared/pieces';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHubError extends Error {
  constructor(
    readonly kind: 'not_found' | 'busy' | 'upstream' | 'not_configured',
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

const API = 'https://api.github.com';

function headers(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'repo-replay',
    'x-github-api-version': '2022-11-28',
  };
}

function retryAtFrom(res: Response): number {
  const now = Math.floor(Date.now() / 1000);
  const after = Number(res.headers.get('retry-after'));
  if (after > 0) return now + after;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  return reset > now ? reset : now + 60;
}

function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  return res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'));
}

async function send(fetcher: Fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch {
    throw new GitHubError('upstream', 'Could not reach GitHub');
  }
  if (res.status === 401) throw new GitHubError('not_configured', 'GitHub refused the token');
  if (isRateLimited(res)) throw new GitHubError('busy', 'GitHub allowance used up', retryAtFrom(res));
  return res;
}

export interface GitHub {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  rest<T>(path: string): Promise<T>;
  restBytes(path: string): Promise<Uint8Array>;
}

export function gitHub(token: string | undefined, fetcher: Fetch = fetch): GitHub {
  if (!token) throw new GitHubError('not_configured', 'GITHUB_TOKEN is not set');
  const restResponse = async (path: string) => {
    const res = await send(fetcher, `${API}${path}`, { headers: headers(token) });
    if (res.status === 404 || res.status === 409) throw new GitHubError('not_found', `Nothing at ${path}`);
    if (!res.ok) throw new GitHubError('upstream', `GitHub answered ${res.status}`);
    return res;
  };
  return {
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const res = await send(fetcher, `${API}/graphql`, {
        method: 'POST',
        headers: { ...headers(token), 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new GitHubError('upstream', `GitHub answered ${res.status}`);
      const out = (await res.json()) as { data?: T; errors?: { type?: string; message?: string }[] };
      if (out.errors?.length) {
        const types = out.errors.map((e) => e.type);
        if (types.includes('RATE_LIMITED')) throw new GitHubError('busy', 'GitHub allowance used up', retryAtFrom(res));
        if (types.includes('NOT_FOUND')) throw new GitHubError('not_found', out.errors[0].message ?? 'Not found');
        throw new GitHubError('upstream', out.errors[0].message ?? 'GitHub query failed');
      }
      if (!out.data) throw new GitHubError('upstream', 'GitHub sent no data');
      return out.data;
    },
    async rest<T>(path: string): Promise<T> {
      return (await (await restResponse(path)).json()) as T;
    },
    async restBytes(path: string): Promise<Uint8Array> {
      return new Uint8Array(await (await restResponse(path)).arrayBuffer());
    },
  };
}

export const COMMIT_FIELDS = `oid committedDate additions deletions changedFilesIfAvailable parents { totalCount } author { name user { login avatarUrl(size: 64) } }`;

export interface GqlCommit {
  oid: string;
  committedDate: string;
  additions: number;
  deletions: number;
  changedFilesIfAvailable: number | null;
  parents?: { totalCount: number };
  author: { name: string | null; user: { login: string; avatarUrl: string } | null } | null;
}

export function toSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Turns GitHub commits into compact rows, collecting their authors into one list per piece. */
export function toRows(commits: GqlCommit[], authors: RawAuthor[], index: Map<string, number>): { shas: string[]; rows: CommitRow[] } {
  const shas: string[] = [];
  const rows: CommitRow[] = [];
  for (const c of commits) {
    const user = c.author?.user ?? null;
    const name = c.author?.name?.trim() || user?.login || '';
    let a = -1;
    if (name) {
      const k = user ? `@${user.login}` : name;
      a = index.get(k) ?? -1;
      if (a === -1) {
        a = authors.length;
        authors.push({ name, login: user?.login ?? null, avatar: user?.avatarUrl ?? null });
        index.set(k, a);
      }
    }
    shas.push(c.oid);
    // GitHub counts a merge's lines against its first parent, so they include everything on the
    // merged branch, whose own commits are counted already.
    const merge = (c.parents?.totalCount ?? 1) > 1;
    rows.push(merge ? [toSeconds(c.committedDate), 0, 0, 0, a] : [toSeconds(c.committedDate), c.additions ?? 0, c.deletions ?? 0, c.changedFilesIfAvailable ?? 0, a]);
  }
  return { shas, rows };
}

export function errorResponseFields(err: unknown): { error: 'not_found' | 'busy' | 'upstream' | 'not_configured'; retryAt?: number } {
  if (err instanceof GitHubError) return err.retryAt ? { error: err.kind, retryAt: err.retryAt } : { error: err.kind };
  return { error: 'upstream' };
}
