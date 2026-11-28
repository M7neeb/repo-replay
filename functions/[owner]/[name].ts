import type { Env } from '../../server/env';
import { savedReplay } from '../../server/saved';
import { replayMeta, shareFacts, unbuiltMeta, withMeta } from '../../server/share';
import { isOwner, isRepoName } from '../../shared/names';

// A replay link (/<owner>/<repo>) is the app's page, with the title and preview picture of that repo
// filled in, so a link pasted into a chat shows the project's own chart.

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env, next }) => {
  const owner = String(params.owner);
  const name = String(params.name);
  if (owner === 'api' || !isOwner(owner) || !isRepoName(name) || !env.ASSETS) return next();

  const page = await env.ASSETS.fetch(new URL('/', request.url));
  if (!page.ok) return page;
  const origin = new URL(request.url).origin;
  let meta = unbuiltMeta(owner, name, origin);
  try {
    const saved = await savedReplay(env, owner, name);
    const facts = saved && shareFacts(saved.pieces);
    if (facts) meta = replayMeta(facts, origin);
  } catch {
    // the page still works without its preview
  }
  // the static page's headers, security rules included, carry over to the filled-in copy
  const headers = new Headers(page.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-cache');
  return new Response(withMeta(await page.text(), meta), { status: 200, headers });
};
