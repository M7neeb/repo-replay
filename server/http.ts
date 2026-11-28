import type { ApiError } from '../shared/api';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

/**
 * A saved replay goes out exactly as it was stored; the page assembles it. It is sent as plain text
 * because Cloudflare only compresses types it knows, and a big replay is mostly repeated text.
 */
export function bundleResponse(text: string, stale: boolean, cache = 'no-cache'): Response {
  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache, 'x-replay-bundle': '1', 'x-replay-stale': stale ? '1' : '0' },
  });
}

const STATUS: Record<ApiError['error'], number> = {
  bad_request: 400,
  not_found: 404,
  empty: 422,
  busy: 503,
  upstream: 502,
  not_configured: 500,
  rejected: 422,
};

export function fail(error: ApiError['error'], extra: Omit<ApiError, 'error'> = {}): Response {
  return json({ error, ...extra } satisfies ApiError, STATUS[error]);
}
