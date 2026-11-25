import { MAX_ENTRIES } from './pieces';

export const DEPTH_LIMIT = 8;

/** How many files sit n folders down (blobsAt[n]) and how many folders are n + 1 down (treesAt[n]). */
export interface DepthCounts {
  blobsAt: number[];
  treesAt: number[];
}

export function slashes(path: string): number {
  let n = 0;
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) n++;
  return n;
}

export function addCounts(a: DepthCounts, b: DepthCounts): DepthCounts {
  return { blobsAt: a.blobsAt.map((n, i) => n + (b.blobsAt[i] ?? 0)), treesAt: a.treesAt.map((n, i) => n + (b.treesAt[i] ?? 0)) };
}

/**
 * The deepest view of the tree that still fits in `max` entries. Git keeps no empty folders, so
 * the entries at depth d are the files at most d folders down plus the folders exactly d + 1 down.
 */
export function depthFromCounts({ blobsAt, treesAt }: DepthCounts, max = MAX_ENTRIES): number {
  let best = 0;
  let upTo = 0;
  for (let depth = 0; depth < blobsAt.length - 1; depth++) {
    upTo += blobsAt[depth];
    if (upTo + treesAt[depth] > max) break;
    best = depth;
    if (blobsAt.slice(depth + 1).every((n) => n === 0)) break;
  }
  return best;
}
