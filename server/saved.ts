import { BUILD, decodeBundle, type BundleMeta } from '../shared/bundle';
import type { Signed } from '../shared/pieces';
import { latestKey, replayKey } from '../shared/replay';
import type { Env } from './env';

/**
 * The newest saved replay of a repo, without asking GitHub: what the README card, the share image and
 * the link preview draw from. Copies from an older build count as missing.
 */
export async function savedReplay(env: Env, owner: string, name: string): Promise<{ head: string; text: string; pieces: Signed[] } | null> {
  if (!env.REPLAYS) return null;
  const head = await env.REPLAYS.get(latestKey(owner, name));
  if (!head) return null;
  const { value, metadata } = await env.REPLAYS.getWithMetadata<BundleMeta>(replayKey({ owner, name, head }));
  if (!value || (metadata?.build ?? 1) < BUILD) return null;
  const bundle = decodeBundle(value);
  return bundle ? { head, text: value, pieces: bundle.pieces } : null;
}
