// A stand-in for api.github.com that serves made-up repos, so the whole build can be
// tested without a token or a network. It answers the exact queries the server sends.

export interface FakeRepo {
  owner: string;
  name: string;
  commits: number;
  /** Files in the project at the latest commit. */
  files: number;
  firstAt: number;
  headAt: number;
  people?: number;
  /** This many commits (from the second oldest on) carry dates years before the first commit, as some old imported histories do. */
  strayDates?: number;
}

interface FakeCommit {
  oid: string;
  at: number;
  index: number;
}

function sha(seed: string): string {
  let h1 = 0x811c9dc5;
  let out = '';
  for (let round = 0; round < 5; round++) {
    for (const ch of `${seed}:${round}`) h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += h1.toString(16).padStart(8, '0');
  }
  return out;
}

class Built {
  readonly newestFirst: FakeCommit[];
  readonly byOid = new Map<string, FakeCommit>();
  constructor(readonly spec: FakeRepo) {
    const list: FakeCommit[] = [];
    const span = spec.headAt - spec.firstAt;
    for (let i = 0; i < spec.commits; i++) {
      const at = spec.commits === 1 ? spec.headAt : spec.firstAt + Math.round((span * i) / (spec.commits - 1));
      const stray = i > 0 && i <= (spec.strayDates ?? 0);
      list.push({ oid: sha(`${spec.owner}/${spec.name}#${i}`), at: stray ? spec.firstAt - 10 * 365 * 86400 : at, index: i });
    }
    for (const c of list) this.byOid.set(c.oid, c);
    this.newestFirst = list.reverse();
  }
  node(c: FakeCommit) {
    const people = this.spec.people ?? 5;
    const p = c.index % people;
    return {
      oid: c.oid,
      committedDate: new Date(c.at * 1000).toISOString(),
      additions: 10 + (c.index % 7),
      deletions: c.index % 3,
      changedFilesIfAvailable: 1 + (c.index % 4),
      author: { name: `Person ${p}`, user: p === 0 ? null : { login: `person${p}`, avatarUrl: `https://avatars.example/${p}` } },
    };
  }
  tree(c: FakeCommit) {
    const n = Math.max(1, Math.round((this.spec.files * (c.index + 1)) / this.spec.commits));
    const tree = [];
    for (let j = 0; j < n; j++) {
      const path = j < 3 ? `file${j}.md` : `src/part${j % 12}/deep${j % 5}/f${j}.ts`;
      const blobSha = sha(`blob${j}`);
      tree.push({ path, mode: '100644', type: 'blob', sha: blobSha, size: 100 + j, url: `https://api.github.com/repos/${this.spec.owner}/${this.spec.name}/git/blobs/${blobSha}` });
    }
    const folders = new Set(tree.map((t) => t.path.split('/').slice(0, -1)).flatMap((parts) => parts.map((_, i) => parts.slice(0, i + 1).join('/'))));
    for (const path of folders) tree.push({ path, mode: '040000', type: 'tree', sha: sha(path), size: undefined as unknown as number, url: 'https://api.github.com/x' });
    return { sha: c.oid, url: `https://api.github.com/repos/${this.spec.owner}/${this.spec.name}/git/trees/${c.oid}`, tree, truncated: false };
  }
}

export interface FakeOptions {
  graphqlLeft?: number;
  coreLeft?: number;
  resetAt?: number;
  /** Queries asking for more time buckets than this time out, the way GitHub does on very long histories. */
  maxBucketsPerQuery?: number;
  /** Bucket queries that time out once before they work, by first bucket index. */
  flakyBuckets?: number[];
}

export function fakeGitHub(repos: FakeRepo[], options: FakeOptions = {}) {
  const built = new Map(repos.map((r) => [`${r.owner}/${r.name}`.toLowerCase(), new Built(r)]));
  const calls: string[] = [];
  const state = { graphqlLeft: options.graphqlLeft ?? 5000, coreLeft: options.coreLeft ?? 5000 };
  const resetAt = options.resetAt ?? Math.floor(Date.now() / 1000) + 1800;
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const u = new URL(url);
    if (u.pathname === '/graphql') {
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
      const op = /query (\w+)/.exec(query)![1];
      calls.push(`graphql:${op}`);
      if (state.graphqlLeft <= 0) {
        return json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }, 200, { 'x-ratelimit-reset': String(resetAt) });
      }
      state.graphqlLeft--;
      const repo = built.get(`${variables.owner}/${variables.name}`.toLowerCase());
      if (!repo) {
        return json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
      }
      const head = repo.newestFirst[0];
      if (op === 'Meta') {
        return json({
          data: {
            rateLimit: { remaining: state.graphqlLeft, resetAt: new Date(resetAt * 1000).toISOString() },
            repository: {
              name: repo.spec.name,
              owner: { login: repo.spec.owner },
              description: `The ${repo.spec.name} project`,
              stargazerCount: 42,
              defaultBranchRef: head
                ? { name: 'main', target: { oid: head.oid, committedDate: new Date(head.at * 1000).toISOString(), history: { totalCount: repo.spec.commits } } }
                : null,
            },
          },
        });
      }
      const from = repo.byOid.get(variables.oid);
      if (!from) return json({ data: { repository: { object: null } } });
      const reachable = repo.newestFirst.slice(repo.newestFirst.indexOf(from));
      const offset = (cursor: string | null) => (cursor ? Number(cursor.split(' ')[1]) + 1 : 0);
      if (op === 'First' || op === 'History') {
        const start = offset(variables.after);
        const size = op === 'First' ? 1 : 100;
        const page = reachable.slice(start, start + size);
        const end = start + page.length - 1;
        return json({
          data: {
            repository: {
              object: {
                history: {
                  pageInfo: { hasNextPage: end < reachable.length - 1, endCursor: page.length ? `${from.oid} ${end}` : null },
                  nodes: page.map((c) => repo.node(c)),
                },
              },
            },
          },
        });
      }
      if (op === 'Buckets') {
        const asked = Object.keys(variables).filter((k) => /^s\d+$/.test(k));
        const first = Number(asked[0].slice(1));
        const flaky = options.flakyBuckets?.indexOf(first) ?? -1;
        if (asked.length > (options.maxBucketsPerQuery ?? Infinity) || flaky !== -1) {
          if (flaky !== -1) options.flakyBuckets!.splice(flaky, 1);
          return json({ data: null, errors: [{ message: 'Something went wrong while executing your query. This may be the result of a timeout.' }] });
        }
        const object: Record<string, unknown> = {};
        for (const key of Object.keys(variables)) {
          const m = /^s(\d+)$/.exec(key);
          if (!m) continue;
          const since = Date.parse(variables[`s${m[1]}`]) / 1000;
          const until = Date.parse(variables[`u${m[1]}`]) / 1000;
          const inside = reachable.filter((c) => c.at >= since && c.at <= until);
          object[`b${m[1]}`] = { totalCount: inside.length, nodes: inside.slice(0, 20).map((c) => repo.node(c)) };
        }
        return json({ data: { repository: { object } } });
      }
      throw new Error(`fake GitHub does not know query ${op}`);
    }

    if (u.pathname === '/rate_limit') {
      calls.push('rest:rate_limit');
      return json({ resources: { core: { remaining: state.coreLeft, reset: resetAt } } });
    }
    const tree = /^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([0-9a-f]{40})$/.exec(u.pathname);
    if (tree) {
      calls.push('rest:tree');
      if (state.coreLeft <= 0) return json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
      state.coreLeft--;
      const repo = built.get(`${tree[1]}/${tree[2]}`.toLowerCase());
      const c = repo?.byOid.get(tree[3]);
      if (!repo || !c) return json({ message: 'Not Found' }, 404);
      return json(repo.tree(c));
    }
    return json({ message: 'Not Found' }, 404);
  }

  return { fetch: handle, calls, state, built };
}

export function memoryKV() {
  const store = new Map<string, { value: string; metadata: unknown }>();
  let writes = 0;
  const kv = {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      writes++;
      store.set(key, { value, metadata: opts?.metadata });
    },
    async list(opts: { prefix?: string }) {
      const keys = [...store].filter(([k]) => k.startsWith(opts.prefix ?? '')).map(([name, v]) => ({ name, metadata: v.metadata }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  };
  return { kv: kv as unknown as KVNamespace, store, writes: () => writes };
}
