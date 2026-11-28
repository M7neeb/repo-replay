import type { Env } from '../../../server/env';
import { fail, json } from '../../../server/http';
import { verify } from '../../../server/sign';
import { AssembleError, checkStructure } from '../../../shared/assemble';
import { BUILD, decodePieces, encodeBundle, type BundleMeta } from '../../../shared/bundle';
import { decodeHeader, MAX_PIECES, type Header } from '../../../shared/pieces';
import { replayKey } from '../../../shared/replay';

const MAX_BODY = 8 * 1024 * 1024;
const KEEP_SECONDS = 60 * 24 * 3600;

// The page sends back the signed pieces it collected. Only pieces this server handed out are
// accepted, and they are stored as they came, so saving costs little CPU however big the repo.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GITHUB_TOKEN) return fail('not_configured');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return fail('rejected', { message: 'too large' });

  const text = await request.text();
  if (text.length > MAX_BODY) return fail('rejected', { message: 'too large' });
  const signed = decodePieces(text);
  if (!signed || signed.length === 0 || signed.length > MAX_PIECES) return fail('bad_request');

  const checks = await Promise.all(signed.map((s) => verify(env.GITHUB_TOKEN!, s)));
  if (checks.includes(false)) return fail('rejected', { message: 'bad signature' });

  let key: string;
  try {
    const headers: Header[] = signed.map((s) => decodeHeader(s.body));
    key = replayKey(checkStructure(headers).repo);
  } catch (err) {
    if (err instanceof AssembleError) return fail('rejected', { message: err.message });
    return fail('bad_request');
  }

  if (!env.REPLAYS) return json({ saved: false });
  const builtAt = new Date().toISOString();
  try {
    await env.REPLAYS.put(key, encodeBundle(builtAt, text), { expirationTtl: KEEP_SECONDS, metadata: { builtAt, build: BUILD } satisfies BundleMeta });
    return json({ saved: true });
  } catch {
    // Most likely the free plan's 1,000 writes a day; the page already has the replay.
    return json({ saved: false });
  }
};
