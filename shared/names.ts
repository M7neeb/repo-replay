const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function isOwner(owner: string): boolean {
  return OWNER.test(owner) && !owner.includes('--');
}

export function isRepoName(name: string): boolean {
  return NAME.test(name) && name !== '.' && name !== '..';
}

export function isSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/.test(sha);
}
