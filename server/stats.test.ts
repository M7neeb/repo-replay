import { describe, expect, it } from 'vitest';
import { npmPackage, weeklyDownloads } from './stats';

const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

describe('which npm package a repo publishes', () => {
  it('takes the root package.json when it points back at the repo', () => {
    expect(npmPackage([pkg({ name: 'left-pad', repository: 'git+https://github.com/stevemao/left-pad.git' })], 'stevemao', 'left-pad')).toBe('left-pad');
    expect(npmPackage([pkg({ name: '@acme/widget', repository: { type: 'git', url: 'https://github.com/Acme/Widget' } })], 'acme', 'widget')).toBe('@acme/widget');
    expect(npmPackage([pkg({ name: 'x', repository: 'github:ana/x' })], 'ana', 'x')).toBe('x');
  });

  it('falls back to packages/<name> in a monorepo whose root is private', () => {
    const root = pkg({ name: 'svelte-monorepo', private: true });
    const nested = pkg({ name: 'svelte', repository: { url: 'git+https://github.com/sveltejs/svelte.git', directory: 'packages/svelte' } });
    expect(npmPackage([root, nested], 'sveltejs', 'svelte')).toBe('svelte');
  });

  it('ignores packages that live somewhere else, private ones, odd names and broken files', () => {
    expect(npmPackage([pkg({ name: 'react', repository: 'https://github.com/facebook/react' })], 'someone', 'my-fork')).toBeNull();
    expect(npmPackage([pkg({ name: 'app', private: true, repository: 'github:ana/app' })], 'ana', 'app')).toBeNull();
    expect(npmPackage([pkg({ name: 'Bad Name', repository: 'github:ana/app' })], 'ana', 'app')).toBeNull();
    expect(npmPackage([pkg({ name: 'app' })], 'ana', 'app')).toBeNull();
    expect(npmPackage(['{ not json', null, undefined], 'ana', 'app')).toBeNull();
  });
});

describe('weekly downloads', () => {
  it('reads the number npm reports', async () => {
    const asked: string[] = [];
    const n = await weeklyDownloads('@acme/widget', async (url) => { asked.push(url); return new Response(JSON.stringify({ downloads: 1234, package: '@acme/widget' })); });
    expect(n).toBe(1234);
    expect(asked).toEqual(['https://api.npmjs.org/downloads/point/last-week/@acme/widget']);
  });

  it('gives nothing when npm says no or is down', async () => {
    expect(await weeklyDownloads('x', async () => new Response('{"error":"not found"}', { status: 404 }))).toBeNull();
    expect(await weeklyDownloads('x', async () => { throw new Error('offline'); })).toBeNull();
    expect(await weeklyDownloads('x', async () => new Response('{"downloads":"lots"}'))).toBeNull();
  });
});
