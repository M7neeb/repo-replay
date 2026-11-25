import { expect, it } from 'vitest';
import { sign, verify } from './sign';
import type { RepoHeader } from '../shared/pieces';

const piece = { kind: 'repo', key: 'a/b@' + '0'.repeat(40) } as RepoHeader;

it('accepts its own signature and nothing else', async () => {
  const signed = await sign('token-1', piece);
  expect(await verify('token-1', signed)).toBe(true);
  expect(await verify('token-2', signed)).toBe(false);
  expect(await verify('token-1', { ...signed, body: signed.body.replace('a/b', 'a/c') })).toBe(false);
  expect(await verify('token-1', { ...signed, sig: 'zz' })).toBe(false);
  expect(await verify('token-1', {} as never)).toBe(false);
});
