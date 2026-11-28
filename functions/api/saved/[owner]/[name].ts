import type { Env } from '../../../../server/env';
import { bundleResponse, fail } from '../../../../server/http';
import { savedReplay } from '../../../../server/saved';
import { isOwner, isRepoName } from '../../../../shared/names';

// The newest saved replay of a repo, straight from storage: the home page's example plays from this,
// so showing it never spends any of the GitHub allowance.

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const owner = String(params.owner);
  const name = String(params.name);
  if (!isOwner(owner) || !isRepoName(name)) return fail('bad_request');
  try {
    const saved = await savedReplay(env, owner, name);
    return saved ? bundleResponse(saved.text, false, 'public, max-age=600') : fail('not_found');
  } catch {
    return fail('not_found');
  }
};
