import type { Env } from '../../server/env';
import { fail, json } from '../../server/http';
import { COMMIT_FIELDS, errorResponseFields, gitHub, toRows, type GqlCommit } from '../../server/github';
import { readInt, readTarget } from '../../server/params';
import { sign } from '../../server/sign';
import { bucketEdges, BUCKETS, type BucketHeader, type BucketsHeader, type CommitRow, type RawAuthor } from '../../shared/pieces';

export const BUCKETS_PER_CALL = 5;
const SAMPLE = 20;

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
}

interface Counted {
  totalCount: number;
  nodes: GqlCommit[];
}

// For long histories: how many commits fall in each time bucket, plus the newest few as a sample.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const target = readTarget(url);
  const first = readInt(url, 'first', 0, 2 ** 32);
  const last = readInt(url, 'last', 0, 2 ** 32);
  const from = readInt(url, 'from', 0, BUCKETS - 1);
  const to = readInt(url, 'to', 1, BUCKETS);
  if (!target || first === null || last === null || from === null || to === null) return fail('bad_request');
  if (to <= from || to - from > BUCKETS_PER_CALL) return fail('bad_request');

  const edges = bucketEdges(first, last, BUCKETS);
  const vars: Record<string, unknown> = { owner: target.owner, name: target.name, oid: target.head };
  const decl: string[] = [];
  const fields: string[] = [];
  for (let i = from; i < to; i++) {
    // The first and last slices have no start and no end, so commits dated before the first one or
    // after the latest one (wrong clocks, imported history) still count and the slices add up to the
    // total. A far-off date doesn't work for this: GitHub finds nothing until the year 2999.
    const args = [`first: ${SAMPLE}`];
    if (i > 0) {
      vars[`s${i}`] = iso(edges[i]);
      decl.push(`$s${i}: GitTimestamp!`);
      args.push(`since: $s${i}`);
    }
    if (i < BUCKETS - 1) {
      vars[`u${i}`] = iso(edges[i + 1] - 1);
      decl.push(`$u${i}: GitTimestamp!`);
      args.push(`until: $u${i}`);
    }
    fields.push(`b${i}: history(${args.join(', ')}) { totalCount nodes { ${COMMIT_FIELDS} } }`);
  }
  const query = `query Buckets(${['$owner: String!', '$name: String!', '$oid: GitObjectID!', ...decl].join(', ')}) {
  repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit { ${fields.join('\n')} } } }
}`;

  try {
    const gh = gitHub(env.GITHUB_TOKEN);
    const data = await gh.graphql<{ repository: { object: Record<string, Counted> | null } | null }>(query, vars);
    const object = data.repository?.object;
    if (!object) return fail('not_found');
    const buckets: BucketHeader[] = [];
    const authors: RawAuthor[] = [];
    const index = new Map<string, number>();
    const samples: CommitRow[][] = [];
    for (let i = from; i < to; i++) {
      const b = object[`b${i}`];
      if (!b) return fail('upstream');
      const { shas, rows } = toRows(b.nodes, authors, index);
      buckets.push({ since: edges[i], until: edges[i + 1] - 1, count: b.totalCount, shas });
      samples.push(rows);
    }
    const header: BucketsHeader = { kind: 'buckets', key: target.key, from, buckets };
    return json({ piece: await sign(env.GITHUB_TOKEN!, header, { authors, samples }) });
  } catch (err) {
    const f = errorResponseFields(err);
    return fail(f.error, f.retryAt ? { retryAt: f.retryAt } : {});
  }
};
