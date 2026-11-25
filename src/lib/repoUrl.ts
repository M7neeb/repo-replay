import { isOwner, isRepoName } from '../../shared/names';

export interface RepoRef {
  owner: string;
  name: string;
}

// Accepts what people actually paste: full URLs, URLs without https, "owner/repo",
// links to a branch, file or issue, and clone URLs ending in .git.
export function parseRepoUrl(input: string): RepoRef | null {
  let text = input.trim();
  if (!text) return null;

  text = text.replace(/^git@github\.com:/i, 'github.com/');
  text = text.replace(/^(https?:\/\/)?(www\.)?/i, '');

  let path: string;
  if (/^github\.com\//i.test(text)) {
    path = text.slice('github.com/'.length);
  } else if (/^[^/\s]+\/[^/\s]+\/?$/.test(text) && !text.includes('.com')) {
    path = text;
  } else {
    return null;
  }

  path = path.split(/[?#]/)[0];
  const [owner, rawName] = path.split('/');
  if (!owner || !rawName) return null;

  const name = rawName.replace(/\.git$/i, '');
  if (!isOwner(owner) || !isRepoName(name)) return null;

  return { owner, name };
}
