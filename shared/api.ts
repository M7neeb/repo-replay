import type { RepoInfo } from './replay';
import type { DepthCounts } from './depth';
import type { Signed } from './pieces';

export interface ApiError {
  error: 'bad_request' | 'not_found' | 'empty' | 'busy' | 'upstream' | 'not_configured' | 'rejected';
  /** For busy: when GitHub gives us a fresh allowance, unix seconds. */
  retryAt?: number;
  message?: string;
}

/** Sent when no saved copy exists. A saved copy comes back as a bundle instead (marked x-replay-bundle: 1). */
export interface StartResponse {
  status: 'build';
  repo: RepoInfo;
  piece: Signed;
}

export interface PieceResponse {
  piece: Signed;
}

export interface TreesResponse {
  pieces: Signed[];
  /** null when the first tree was too big to read in one call; its depth then comes from counting its parts. */
  depth: number | null;
  /** File lists too big for one call, to be read part by part. */
  split: { sha: string; parts: number }[];
}

/** One part of a big file list: the depth counts when no depth was given, otherwise a signed piece. */
export type TreePartResponse = { counts: DepthCounts } | { piece: Signed };

export interface StoreResponse {
  saved: boolean;
}
