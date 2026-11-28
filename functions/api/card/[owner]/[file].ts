import type { Env } from '../../../../server/env';
import { BUILD, decodeBundle, type BundleMeta } from '../../../../shared/bundle';
import { cardInput } from '../../../../shared/cardInput';
import { cardSvg, chartModelFrom, placeholderSvg, type ThemeName } from '../../../../shared/chart';
import { findMomentsFrom } from '../../../../shared/moments';
import { isOwner, isRepoName } from '../../../../shared/names';
import { latestKey, replayKey } from '../../../../shared/replay';

// The README card: /api/card/<owner>/<repo>.svg, ?theme=dark for GitHub's dark mode.
// It draws the newest saved replay; opening the replay page is what refreshes it.

function svg(body: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  const owner = String(params.owner);
  const file = String(params.file);
  const name = file.replace(/\.svg$/i, '');
  if (!file.toLowerCase().endsWith('.svg') || !isOwner(owner) || !isRepoName(name)) {
    return new Response('Not found', { status: 404 });
  }
  const url = new URL(request.url);
  const theme: ThemeName = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const placeholder = () => svg(placeholderSvg(owner, name, theme, url.host), 600);
  if (!env.REPLAYS) return placeholder();

  try {
    const head = await env.REPLAYS.get(latestKey(owner, name));
    if (!head) return placeholder();
    const { value, metadata } = await env.REPLAYS.getWithMetadata<BundleMeta>(replayKey({ owner, name, head }));
    if (!value || (metadata?.build ?? 1) < BUILD) return placeholder();
    const bundle = decodeBundle(value);
    const input = bundle && cardInput(bundle.pieces);
    if (!input) return placeholder();
    const moments = findMomentsFrom(input.repo, input.snapshots);
    return svg(cardSvg(chartModelFrom(input.repo, input.snapshots, moments), { theme }), 3600);
  } catch {
    return placeholder();
  }
};
