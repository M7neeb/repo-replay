import { isOwner, isRepoName, isSha } from '../shared/names';
import { pieceKey } from '../shared/pieces';

export interface Target {
  owner: string;
  name: string;
  head: string;
  key: string;
}

/** Reads ?repo=owner/name&head=sha, or null when either is malformed. */
export function readTarget(url: URL): Target | null {
  const [owner = '', name = '', extra] = (url.searchParams.get('repo') ?? '').split('/');
  const head = url.searchParams.get('head') ?? '';
  if (extra !== undefined || !isOwner(owner) || !isRepoName(name) || !isSha(head)) return null;
  return { owner, name, head, key: pieceKey(owner, name, head) };
}

export function readInt(url: URL, name: string, min: number, max: number): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}
