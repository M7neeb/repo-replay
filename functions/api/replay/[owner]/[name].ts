import type { Env } from '../../../../server/env';
import { bundleResponse, fail, json } from '../../../../server/http';
import { errorResponseFields, gitHub, GitHubError, toSeconds } from '../../../../server/github';
import { sign } from '../../../../server/sign';
import { firstRelease } from '../../../../server/release';
import { BUILD, type BundleMeta } from '../../../../shared/bundle';
import { isOwner, isRepoName } from '../../../../shared/names';
import { MAX_FULL_COMMITS, MAX_SNAPSHOTS, pieceKey, type RepoHeader } from '../../../../shared/pieces';
import { replayKey, replayPrefix, type RepoInfo } from '../../../../shared/replay';

const META = `query Meta($owner: String!, $name: String!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    name owner { login } description stargazerCount
    defaultBranchRef { name target { ... on Commit { oid committedDate history(first: 1) { totalCount } } } }
    releases(first: 1, orderBy: { field: CREATED_AT, direction: ASC }) { totalCount nodes { tagName createdAt } }
    refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: ASC }) {
      totalCount
      nodes { name target { ... on Commit { committedDate } ... on Tag { target { ... on Commit { committedDate } } } } }
    }
  }
}`;

// History cursors are "<sha> <index>", so the oldest commit is one step after index total - 2.
const FIRST = `query First($owner: String!, $name: String!, $oid: GitObjectID!, $after: String!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) { ... on Commit { history(first: 1, after: $after) { nodes { committedDate } } } }
  }
}`;

interface Meta {
  rateLimit: { remaining: number; resetAt: string } | null;
  repository: {
    name: string;
    owner: { login: string };
    description: string | null;
    stargazerCount: number;
    defaultBranchRef: {
      name: string;
      target: { oid?: string; committedDate?: string; history?: { totalCount: number } };
    } | null;
    releases?: { totalCount: number; nodes: { tagName: string; createdAt: string }[] };
    refs?: { totalCount: number; nodes: { name: string; target: { committedDate?: string; target?: { committedDate?: string } } }[] } | null;
  } | null;
}


interface First {
  repository: { object: { history?: { nodes: { committedDate: string }[] } } | null } | null;
}

interface RateLimits {
  resources: { core: { remaining: number; reset: number } };
}

async function storedReplay(env: Env, key: string): Promise<string | null> {
  if (!env.REPLAYS) return null;
  try {
    const { value, metadata } = await env.REPLAYS.getWithMetadata<BundleMeta>(key);
    return value && (metadata?.build ?? 1) >= BUILD ? value : null;
  } catch {
    return null;
  }
}

// When GitHub can't be asked for the latest commit, the newest saved replay is better than nothing.
async function newestStored(env: Env, owner: string, name: string): Promise<string | null> {
  if (!env.REPLAYS) return null;
  try {
    const list = await env.REPLAYS.list<BundleMeta>({ prefix: replayPrefix(owner, name) });
    const newest = list.keys.sort((a, b) => (b.metadata?.builtAt ?? '').localeCompare(a.metadata?.builtAt ?? ''))[0];
    return newest ? await env.REPLAYS.get(newest.name) : null;
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const owner = String(params.owner);
  const name = String(params.name);
  if (!isOwner(owner) || !isRepoName(name)) return fail('bad_request');

  try {
    const gh = gitHub(env.GITHUB_TOKEN);
    const [meta, limits] = await Promise.all([
      gh.graphql<Meta>(META, { owner, name }),
      gh.rest<RateLimits>('/rate_limit').catch(() => null),
    ]);
    const repo = meta.repository;
    if (!repo) return fail('not_found');
    const target = repo.defaultBranchRef?.target;
    const total = target?.history?.totalCount ?? 0;
    if (!repo.defaultBranchRef || !target?.oid || !target.committedDate || total < 2) return fail('empty');

    const info: RepoInfo = {
      owner: repo.owner.login,
      name: repo.name,
      description: repo.description,
      stars: repo.stargazerCount,
      branch: repo.defaultBranchRef.name,
      head: target.oid,
      headAt: toSeconds(target.committedDate),
      firstAt: 0,
      commits: total,
      sampled: total > MAX_FULL_COMMITS,
    };
    const release = firstRelease(repo);
    if (release) info.firstRelease = release;

    const stored = await storedReplay(env, replayKey(info));
    if (stored) return bundleResponse(stored, false);

    const graphqlNeeded = info.sampled ? 20 : Math.ceil(total / 100) + 5;
    const restNeeded = MAX_SNAPSHOTS + 5;
    const now = Math.floor(Date.now() / 1000);
    if (meta.rateLimit && meta.rateLimit.remaining < graphqlNeeded) {
      return fail('busy', { retryAt: Math.max(toSeconds(meta.rateLimit.resetAt), now + 60) });
    }
    if (limits && limits.resources.core.remaining < restNeeded) {
      return fail('busy', { retryAt: Math.max(limits.resources.core.reset, now + 60) });
    }

    const first = await gh.graphql<First>(FIRST, { owner, name, oid: info.head, after: `${info.head} ${total - 2}` });
    const oldest = first.repository?.object?.history?.nodes[0];
    info.firstAt = oldest ? Math.min(toSeconds(oldest.committedDate), info.headAt) : info.headAt;

    const piece: RepoHeader = { kind: 'repo', key: pieceKey(info.owner, info.name, info.head), repo: info };
    return json({ status: 'build', repo: info, piece: await sign(env.GITHUB_TOKEN!, piece) });
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'not_found') return fail('not_found');
    if (err instanceof GitHubError && err.kind === 'busy') {
      const stored = await newestStored(env, owner, name);
      if (stored) return bundleResponse(stored, true);
    }
    const fields = errorResponseFields(err);
    return fail(fields.error, fields.retryAt ? { retryAt: fields.retryAt } : {});
  }
};
