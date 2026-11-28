// Routes the page's API calls straight into the Pages Functions, the way Cloudflare would.
import { onRequestGet as start } from '../functions/api/replay/[owner]/[name]';
import { onRequestPost as store } from '../functions/api/replay/index';
import { onRequestGet as history } from '../functions/api/history';
import { onRequestGet as buckets } from '../functions/api/buckets';
import { onRequestGet as trees } from '../functions/api/trees';
import { onRequestGet as card } from '../functions/api/card/[owner]/[file]';
import type { Env } from '../server/env';
import type { Api } from '../src/lib/build';

type Handler = (ctx: never) => Response | Promise<Response>;

export function apiFor(env: Env, log: string[] = []): Api {
  return async (path, init) => {
    const request = new Request(`https://repo-replay.test${path}`, init);
    const url = new URL(request.url);
    log.push(url.pathname);
    let handler: Handler | undefined;
    let params: Record<string, string> = {};
    const m = /^\/api\/replay\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    const c = /^\/api\/card\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (c) {
      handler = card as Handler;
      params = { owner: decodeURIComponent(c[1]), file: decodeURIComponent(c[2]) };
    } else if (m && request.method === 'GET') {
      handler = start as Handler;
      params = { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) };
    } else if (url.pathname === '/api/replay' && request.method === 'POST') handler = store as Handler;
    else if (url.pathname === '/api/history') handler = history as Handler;
    else if (url.pathname === '/api/buckets') handler = buckets as Handler;
    else if (url.pathname === '/api/trees') handler = trees as Handler;
    if (!handler) return new Response('{}', { status: 404 });
    return handler({ request, env, params } as never);
  };
}
