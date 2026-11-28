import { FORMAT, type Author, type Replay, type RepoInfo, type Snapshot, type TimelineRow } from './replay';
import {
  bucketEdges,
  BUCKETS,
  type BucketsHeader,
  type CommitsHeader,
  type Header,
  type Piece,
  type RawAuthor,
  type TreeHeader,
} from './pieces';

export class AssembleError extends Error {}

export interface Structure {
  repo: RepoInfo;
  /** History pages in order, newest commits first. Empty for a sampled repo. */
  pages: number[];
  /** Bucket pieces by position. Empty for a fully read repo. */
  bucketPieces: number[];
  /** Each snapshot's tree pieces (more than one when its file list was read in parts). */
  trees: { sha: string; parts: number[] }[];
}

// Everything that makes a set of pieces a complete replay, checked on headers alone. The server
// runs this before saving (it can't afford to read the data), and the page runs it again before
// building, so a saved copy always opens.
export function checkStructure(headers: Header[]): Structure {
  const repoAt = headers.findIndex((h) => h.kind === 'repo');
  if (repoAt === -1 || headers.filter((h) => h.kind === 'repo').length !== 1) throw new AssembleError('needs exactly one repo piece');
  const { repo, key } = headers[repoAt] as Extract<Header, { kind: 'repo' }>;
  if (headers.some((h) => h.key !== key)) throw new AssembleError('pieces from another repo or commit');

  const dates = new Map<string, number>([[repo.head, repo.headAt]]);
  if (repo.firstSha) dates.set(repo.firstSha, repo.firstAt);
  const pages: number[] = [];
  const bucketPieces: number[] = [];

  if (!repo.sampled) {
    if (headers.some((h) => h.kind === 'buckets')) throw new AssembleError('buckets in a fully read build');
    const byAfter = new Map<string | null, number>();
    headers.forEach((h, i) => {
      if (h.kind !== 'commits') return;
      if (byAfter.has(h.after)) throw new AssembleError('repeated history page');
      byAfter.set(h.after, i);
    });
    let at = byAfter.get(null);
    while (at !== undefined) {
      pages.push(at);
      const next = (headers[at] as CommitsHeader).next;
      if (next === null) break;
      at = byAfter.get(next);
    }
    const last = pages.at(-1);
    if (last === undefined || (headers[last] as CommitsHeader).next !== null || pages.length !== byAfter.size) {
      throw new AssembleError('history is incomplete');
    }
    const seen = new Set<string>();
    // Dates come from the data, so here we only learn which commits exist.
    for (const i of pages) {
      for (const sha of (headers[i] as CommitsHeader).shas) {
        if (seen.has(sha)) throw new AssembleError('repeated commit');
        seen.add(sha);
        if (!dates.has(sha)) dates.set(sha, NaN);
      }
    }
  } else {
    if (headers.some((h) => h.kind === 'commits')) throw new AssembleError('commit pages in a sampled build');
    const edges = bucketEdges(repo.firstAt, repo.headAt, BUCKETS);
    const filled = new Array<boolean>(BUCKETS).fill(false);
    headers.forEach((h, i) => {
      if (h.kind !== 'buckets') return;
      bucketPieces.push(i);
      (h as BucketsHeader).buckets.forEach((b, j) => {
        const slot = h.from + j;
        if (slot >= BUCKETS || b.since !== edges[slot] || b.until !== edges[slot + 1] - 1) throw new AssembleError('bucket out of place');
        if (filled[slot]) throw new AssembleError('repeated bucket');
        filled[slot] = true;
        for (const sha of b.shas) if (!dates.has(sha)) dates.set(sha, NaN);
      });
    });
    if (filled.includes(false)) throw new AssembleError('history is incomplete');
    bucketPieces.sort((a, b) => (headers[a] as BucketsHeader).from - (headers[b] as BucketsHeader).from);
  }

  const bySha = new Map<string, { parts: number; depth: number; slots: (number | undefined)[] }>();
  headers.forEach((h, i) => {
    if (h.kind !== 'tree') return;
    const t = h as TreeHeader;
    if (!dates.has(t.sha)) throw new AssembleError('snapshot of a commit outside the history');
    if (!Number.isInteger(t.parts) || t.parts < 1 || !Number.isInteger(t.part) || t.part < 0 || t.part >= t.parts) {
      throw new AssembleError('bad snapshot part');
    }
    let entry = bySha.get(t.sha);
    if (!entry) {
      entry = { parts: t.parts, depth: t.depth, slots: new Array(t.parts) };
      bySha.set(t.sha, entry);
    }
    if (entry.parts !== t.parts || entry.depth !== t.depth) throw new AssembleError('snapshot parts do not match');
    // The same part twice is harmless (a retried call); keep the first.
    entry.slots[t.part] ??= i;
  });
  const trees: { sha: string; parts: number[] }[] = [];
  for (const [sha, entry] of bySha) {
    const parts = [...entry.slots];
    if (parts.some((p) => p === undefined)) throw new AssembleError('snapshot is missing a part');
    trees.push({ sha, parts: parts as number[] });
  }
  if (!bySha.has(repo.head)) throw new AssembleError('missing the latest snapshot');

  return { repo, pages, bucketPieces, trees };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A commit's typical size in a sample: the mean without the top and bottom tenth. The median alone
 * reads too low, because most commits are small and a few big ones carry much of the work.
 * Samples under 10 are too small to trim, so they use the median.
 */
export function typical(values: number[]): number {
  if (values.length < 10) return median(values);
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length / 10);
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

function authorKey(a: RawAuthor): string {
  return a.login ? `@${a.login.toLowerCase()}` : a.name.toLowerCase();
}

/**
 * The timeline, the authors and every known commit date, from the commit pages or the time buckets.
 * Only those pieces need their data; the README card passes the others as headers alone.
 */
export function buildTimeline(pieces: Piece[], structure: Structure): { timeline: TimelineRow[]; authors: Author[]; dates: Map<string, number> } {
  const { repo, pages, bucketPieces } = structure;
  const authors: Author[] = [];
  const authorIndex = new Map<string, number>();
  const globalAuthor = (list: RawAuthor[], i: number): number => {
    const a = list[i];
    if (!a) return -1;
    const k = authorKey(a);
    let g = authorIndex.get(k);
    if (g === undefined) {
      g = authors.length;
      authors.push({ name: a.name, login: a.login, avatar: a.avatar });
      authorIndex.set(k, g);
    }
    return g;
  };

  const dates = new Map<string, number>([[repo.head, repo.headAt]]);
  if (repo.firstSha) dates.set(repo.firstSha, repo.firstAt);
  const timeline: TimelineRow[] = [];
  if (!repo.sampled) {
    for (let p = pages.length - 1; p >= 0; p--) {
      const page = pieces[pages[p]] as Extract<Piece, { kind: 'commits' }>;
      for (let i = page.rows.length - 1; i >= 0; i--) {
        const [at, add, del, files, a] = page.rows[i];
        dates.set(page.shas[i], at);
        timeline.push([at, 1, add, del, files, globalAuthor(page.authors, a)]);
      }
    }
  } else {
    for (const index of bucketPieces) {
      const piece = pieces[index] as Extract<Piece, { kind: 'buckets' }>;
      piece.buckets.forEach((b, j) => {
        const sample = piece.samples[j] ?? [];
        // A plain mean lets one huge commit in a sample of 20 (a vendored library, a generated
        // file) multiply into hundreds of millions of lines; see typical().
        const sum = (k: 1 | 2 | 3) => Math.round(typical(sample.map((row) => row[k])) * b.count);
        const tally = new Map<number, number>();
        sample.forEach((row, i) => {
          dates.set(b.shas[i], row[0]);
          const g = globalAuthor(piece.authors, row[4]);
          if (g >= 0) tally.set(g, (tally.get(g) ?? 0) + 1);
        });
        let top = -1;
        let best = 0;
        for (const [g, n] of tally) if (n > best) [top, best] = [g, n];
        timeline.push([b.since, b.count, sum(1), sum(2), sum(3), top]);
      });
    }
  }

  return { timeline, authors, dates };
}

export function assemble(pieces: Piece[], builtAt: string): Replay {
  const structure = checkStructure(pieces);
  const { repo, trees } = structure;
  const { timeline, authors, dates } = buildTimeline(pieces, structure);

  const paths: string[] = [];
  const pathIndex = new Map<string, number>();
  const snapshots: Snapshot[] = trees.map(({ sha, parts }) => {
    const merged = new Map<number, [number, number, number]>();
    let files = 0;
    let bytes = 0;
    let truncated = false;
    for (const index of parts) {
      const t = pieces[index] as Extract<Piece, { kind: 'tree' }>;
      files += t.files;
      bytes += t.bytes;
      truncated ||= t.truncated;
      for (const [path, size, count] of t.entries) {
        let i = pathIndex.get(path);
        if (i === undefined) {
          i = paths.length;
          paths.push(path);
          pathIndex.set(path, i);
        }
        const e = merged.get(i);
        if (e) {
          e[1] += size;
          e[2] += count;
        } else {
          merged.set(i, [i, size, count]);
        }
      }
    }
    return { sha, at: dates.get(sha) ?? repo.headAt, files, bytes, truncated, entries: [...merged.values()] };
  });
  snapshots.sort((a, b) => a.at - b.at);

  return { format: FORMAT, builtAt, repo, timeline, authors, paths, snapshots, moments: [] };
}
