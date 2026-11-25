// The replay the page builds from a repo's pieces. KV keeps the signed pieces (see bundle.ts)
// under replay:v1:<owner>/<name>@<head>, owner and name in lower case, not this object, so
// this shape can change freely as long as assemble() still builds it from old pieces.

export const FORMAT = 1;

export interface RepoInfo {
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  branch: string;
  head: string;
  /** Unix seconds */
  headAt: number;
  /** Unix seconds */
  firstAt: number;
  commits: number;
  /** True when the history is too long to read commit by commit and was sampled per time bucket. */
  sampled: boolean;
}

export interface Author {
  name: string;
  login: string | null;
  avatar: string | null;
}

/**
 * One commit, or one time bucket when the repo is sampled. Oldest first.
 * [unix seconds, commits, lines added, lines deleted, files changed, index into authors or -1]
 * In a sampled bucket the line and file counts are estimates scaled up from the sample.
 */
export type TimelineRow = [number, number, number, number, number, number];

/** [index into Replay.paths, bytes, files]. A path ending in "/" is a folder rolled up into one entry. */
export type SnapshotEntry = [number, number, number];

export interface Snapshot {
  sha: string;
  at: number;
  files: number;
  bytes: number;
  /** GitHub cut the file list short (very large trees), so the counts are a lower bound. */
  truncated: boolean;
  entries: SnapshotEntry[];
}

export interface Moment {
  at: number;
  kind: string;
  data: Record<string, unknown>;
  caption: string;
}

export interface Replay {
  format: typeof FORMAT;
  builtAt: string;
  repo: RepoInfo;
  timeline: TimelineRow[];
  authors: Author[];
  paths: string[];
  snapshots: Snapshot[];
  moments: Moment[];
}

export function replayKey(repo: Pick<RepoInfo, 'owner' | 'name' | 'head'>): string {
  return `${replayPrefix(repo.owner, repo.name)}${repo.head}`;
}

export function replayPrefix(owner: string, name: string): string {
  return `replay:v1:${owner.toLowerCase()}/${name.toLowerCase()}@`;
}
