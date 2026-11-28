import type { RepoInfo } from '../shared/replay';
import { toSeconds } from './github';

export interface ReleaseData {
  releases?: { totalCount: number; nodes: { tagName: string; createdAt: string }[] };
  refs?: { totalCount: number; nodes: { name: string; target: { committedDate?: string; target?: { committedDate?: string } } }[] } | null;
}

// The earliest of the first GitHub release and the oldest tag. Many older projects tagged versions for
// years before they started publishing GitHub releases, so the release alone would come too late.
export function firstRelease(repo: ReleaseData): RepoInfo['firstRelease'] {
  const options: NonNullable<RepoInfo['firstRelease']>[] = [];
  const rel = repo.releases?.nodes[0];
  if (rel && repo.releases!.totalCount > 0) options.push({ kind: 'release', tag: rel.tagName, at: toSeconds(rel.createdAt), count: repo.releases!.totalCount });
  const tag = repo.refs?.nodes[0];
  const date = tag?.target.committedDate ?? tag?.target.target?.committedDate;
  if (tag && date) options.push({ kind: 'tag', tag: tag.name, at: toSeconds(date), count: repo.refs!.totalCount });
  return options.sort((a, b) => a.at - b.at)[0];
}
