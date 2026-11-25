import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from './repoUrl';

describe('parseRepoUrl', () => {
  const ok = { owner: 'sveltejs', name: 'svelte' };

  it.each([
    'https://github.com/sveltejs/svelte',
    'http://github.com/sveltejs/svelte',
    'https://www.github.com/sveltejs/svelte/',
    'github.com/sveltejs/svelte',
    'sveltejs/svelte',
    '  sveltejs/svelte  ',
    'https://github.com/sveltejs/svelte.git',
    'git@github.com:sveltejs/svelte.git',
    'https://github.com/sveltejs/svelte/tree/main/packages',
    'https://github.com/sveltejs/svelte/issues/123',
    'https://github.com/sveltejs/svelte?tab=readme',
    'https://github.com/sveltejs/svelte#readme',
  ])('reads %s', (input) => {
    expect(parseRepoUrl(input)).toEqual(ok);
  });

  it('keeps dots and dashes in repo names', () => {
    expect(parseRepoUrl('github.com/vercel/next.js')).toEqual({ owner: 'vercel', name: 'next.js' });
    expect(parseRepoUrl('M7neeb/repo-replay')).toEqual({ owner: 'M7neeb', name: 'repo-replay' });
  });

  it.each([
    '',
    '   ',
    'https://gitlab.com/a/b',
    'https://github.com/sveltejs',
    'https://github.com/',
    'svelte',
    '-bad/repo',
    'bad-/repo',
    'a--b/repo',
    'owner/..',
    'owner/bad name',
    'https://example.com/owner/repo',
  ])('rejects %j', (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});
