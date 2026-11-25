import type { Env } from '../../server/env';
import { fail, json } from '../../server/http';
import { errorResponseFields, gitHub } from '../../server/github';
import { readInt, readTarget } from '../../server/params';
import { countDepths, parseTree, partText, pickDepth, rollup, scanTree } from '../../server/rollup';
import { sign } from '../../server/sign';
import { isSha } from '../../shared/names';
import { DEPTH_LIMIT } from '../../shared/depth';
import type { Signed, TreeHeader } from '../../shared/pieces';
import type { TreePartResponse, TreesResponse } from '../../shared/api';

export const TREES_PER_CALL = 10;
export const MAX_PARTS = 64;
// Above this a file list is too big to parse inside the CPU budget, so it is read in parts.
export const WHOLE_BYTES = 700_000;
export const PART_BYTES = 500_000;

// The file list at a few commits. Without ?depth the first tree decides how deep to look,
// and the page passes that depth on so every snapshot is grouped the same way.
// With ?part=k&parts=n it reads one part of a single big file list.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const target = readTarget(url);
  const shas = (url.searchParams.get('shas') ?? '').split(',').filter(Boolean);
  const given = url.searchParams.has('depth') ? readInt(url, 'depth', 0, DEPTH_LIMIT) : undefined;
  const parted = url.searchParams.has('part');
  const part = parted ? readInt(url, 'part', 0, MAX_PARTS - 1) : 0;
  const parts = parted ? readInt(url, 'parts', 2, MAX_PARTS) : 1;
  if (!target || given === null || shas.length === 0 || shas.length > TREES_PER_CALL || !shas.every(isSha)) {
    return fail('bad_request');
  }
  if (part === null || parts === null || part >= parts || (parted && shas.length !== 1)) return fail('bad_request');

  try {
    const gh = gitHub(env.GITHUB_TOKEN);
    const path = (sha: string) => `/repos/${target.owner}/${target.name}/git/trees/${sha}?recursive=1`;

    if (parted) {
      const bytes = await gh.restBytes(path(shas[0]));
      const { text, from, to } = partText(bytes, part, parts);
      const tree = scanTree(text, from, to);
      if (given === undefined) return json({ counts: countDepths(tree) } satisfies TreePartResponse);
      const { entries, files, bytes: size } = rollup(tree, given);
      const header: TreeHeader = {
        kind: 'tree', key: target.key, sha: shas[0], depth: given, files, bytes: size, truncated: tree.truncated, part, parts,
      };
      return json({ piece: await sign(env.GITHUB_TOKEN!, header, { entries }) } satisfies TreePartResponse);
    }

    const all = await Promise.all(shas.map((sha) => gh.restBytes(path(sha))));
    let depth = given;
    const pieces: Signed[] = [];
    const split: TreesResponse['split'] = [];
    const decoder = new TextDecoder();
    for (let i = 0; i < all.length; i++) {
      if (all[i].byteLength > WHOLE_BYTES) {
        split.push({ sha: shas[i], parts: Math.min(MAX_PARTS, Math.ceil(all[i].byteLength / PART_BYTES)) });
        continue;
      }
      const tree = parseTree(decoder.decode(all[i]));
      depth ??= pickDepth(tree);
      const { entries, files, bytes } = rollup(tree, depth);
      const header: TreeHeader = {
        kind: 'tree', key: target.key, sha: shas[i], depth, files, bytes, truncated: tree.truncated, part: 0, parts: 1,
      };
      pieces.push(await sign(env.GITHUB_TOKEN!, header, { entries }));
    }
    return json({ pieces, depth: depth ?? null, split } satisfies TreesResponse);
  } catch (err) {
    const f = errorResponseFields(err);
    return fail(f.error, f.retryAt ? { retryAt: f.retryAt } : {});
  }
};
