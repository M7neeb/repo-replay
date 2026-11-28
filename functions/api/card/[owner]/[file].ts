import type { Env } from '../../../../server/env';
import { savedReplay } from '../../../../server/saved';
import { cardInput } from '../../../../shared/cardInput';
import { cardSvg, chartModelFrom, placeholderSvg, type ThemeName } from '../../../../shared/chart';
import { findMomentsFrom } from '../../../../shared/moments';
import { isOwner, isRepoName } from '../../../../shared/names';

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
  try {
    const saved = await savedReplay(env, owner, name);
    const input = saved && cardInput(saved.pieces);
    if (!input) return placeholder();
    const moments = findMomentsFrom(input);
    return svg(cardSvg(chartModelFrom(input.repo, input.snapshots, moments), { theme }), 3600);
  } catch {
    return placeholder();
  }
};
