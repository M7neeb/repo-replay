import type { Env } from '../../server/env';
import { fail, json } from '../../server/http';
import { COMMIT_FIELDS, errorResponseFields, gitHub, toRows, type GqlCommit } from '../../server/github';
import { readTarget } from '../../server/params';
import { sign } from '../../server/sign';
import type { CommitsHeader, RawAuthor } from '../../shared/pieces';

const HISTORY = `query History($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) { ... on Commit {
      history(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} } }
    } }
  }
}`;

interface History {
  repository: {
    object: { history?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlCommit[] } } | null;
  } | null;
}

// Five pages per call keeps a 5,000-commit history to ten calls and well under the 50-subrequest limit.
export const PAGES_PER_CALL = 5;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const target = readTarget(url);
  const after = url.searchParams.get('after');
  if (!target || (after !== null && !/^[A-Za-z0-9 +/=_:-]{1,200}$/.test(after))) return fail('bad_request');

  try {
    const gh = gitHub(env.GITHUB_TOKEN);
    const nodes: GqlCommit[] = [];
    let cursor: string | null = after;
    let next: string | null = null;
    for (let page = 0; page < PAGES_PER_CALL; page++) {
      const data: History = await gh.graphql<History>(HISTORY, { owner: target.owner, name: target.name, oid: target.head, after: cursor });
      const history = data.repository?.object?.history;
      if (!history) return fail('not_found');
      nodes.push(...history.nodes);
      next = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
      if (!next) break;
      cursor = next;
    }
    const authors: RawAuthor[] = [];
    const { shas, rows } = toRows(nodes, authors, new Map());
    const header: CommitsHeader = { kind: 'commits', key: target.key, after, next, shas };
    return json({ piece: await sign(env.GITHUB_TOKEN!, header, { authors, rows }) });
  } catch (err) {
    const fields = errorResponseFields(err);
    return fail(fields.error, fields.retryAt ? { retryAt: fields.retryAt } : {});
  }
};
