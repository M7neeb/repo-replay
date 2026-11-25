import type { ApiError } from '../shared/api';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const BUNDLE_TYPE = 'text/x-repo-replay';

/** A saved replay goes out exactly as it was stored; the page assembles it. */
export function bundleResponse(text: string, stale: boolean): Response {
  return new Response(text, {
    headers: { 'content-type': `${BUNDLE_TYPE}; charset=utf-8`, 'cache-control': 'no-store', 'x-replay-stale': stale ? '1' : '0' },
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
