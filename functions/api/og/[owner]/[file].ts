import type { Env } from '../../../../server/env';
import { ogPng } from '../../../../server/og';
import { savedReplay } from '../../../../server/saved';
import { cardInput } from '../../../../shared/cardInput';
import { chartModelFrom } from '../../../../shared/chart';
import { findMomentsFrom } from '../../../../shared/moments';
import { isOwner, isRepoName } from '../../../../shared/names';

// The picture for a shared replay link: /api/og/<owner>/<repo>.png. Links carry ?v=<head>, so a new
// build gets a new address and the picture can be kept for a week. Drawn once per place it is asked
// from, then served from Cloudflare's cache.

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env, waitUntil }) => {
  const owner = String(params.owner);
  const file = String(params.file);
  const name = file.replace(/\.png$/i, '');
  if (!file.toLowerCase().endsWith('.png') || !isOwner(owner) || !isRepoName(name)) {
    return new Response('Not found', { status: 404 });
  }
  const site = () => Response.redirect(new URL('/og.png', request.url).toString(), 302);

  const cache = typeof caches === 'undefined' ? null : caches.default;
  const hit = await cache?.match(request);
  if (hit) return hit;

  try {
    const saved = await savedReplay(env, owner, name);
    const input = saved && cardInput(saved.pieces);
    if (!saved || !input) return site();
    const png = await ogPng(chartModelFrom(input.repo, input.snapshots, findMomentsFrom(input)));
    const versioned = new URL(request.url).searchParams.get('v') === saved.head.slice(0, 12);
    const res = new Response(png, {
      headers: {
        'content-type': 'image/png',
        'cache-control': `public, max-age=${versioned ? 604800 : 3600}`,
        'x-content-type-options': 'nosniff',
      },
    });
    if (cache) waitUntil(cache.put(request, res.clone()));
    return res;
  } catch {
    return site();
  }
};
