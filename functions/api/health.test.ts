import { expect, it } from 'vitest';
import { onRequestGet } from './health';

it('answers ok', async () => {
  const res = await onRequestGet({} as Parameters<typeof onRequestGet>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get('cache-control')).toBe('no-store');
});
