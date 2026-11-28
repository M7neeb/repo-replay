import { assemble } from '../../shared/assemble';
import type { ApiError, PieceResponse, StartResponse, StoreResponse, TreePartResponse, TreesResponse } from '../../shared/api';
import { addCounts, depthFromCounts, type DepthCounts } from '../../shared/depth';
import { decodeBundle, encodePieces } from '../../shared/bundle';
import { BUCKETS, decodePiece, MAX_SNAPSHOTS, TREE_PIECES, type BucketsPiece, type CommitsPiece, type Piece, type Signed, type TreePiece } from '../../shared/pieces';
import type { Replay, RepoInfo } from '../../shared/replay';
import type { RepoRef } from './repoUrl';

export type Api = (path: string, init?: RequestInit) => Promise<Response>;

export type Progress =
  | { stage: 'start' }
  | { stage: 'history'; done: number; total: number; unit: 'commits' | 'parts' }
  | { stage: 'files'; done: number; total: number }
  | { stage: 'save' };

export interface Loaded {
  replay: Replay;
  /** Came straight from the saved copy. */
  cached: boolean;
  /** A saved copy that may be behind the repo, shown because GitHub was busy. */
  stale: boolean;
  /** The finished build could be kept for next time. */
  saved: boolean;
}

export class LoadError extends Error {
  constructor(
    readonly kind: ApiError['error'] | 'offline',
    readonly retryAt?: number,
  ) {
    super(kind);
  }
}

const BUCKETS_PER_CALL = 5;
const ONE_SLICE_ABOVE = 300_000;
const PARALLEL = 6;
// Roughly how many files one call can read and still stay inside the server's CPU budget.
const FILES_PER_CALL = 2500;

async function send(api: Api, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await api(path, init);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new LoadError('offline');
  }
}

async function call<T>(api: Api, path: string, init?: RequestInit): Promise<T> {
  return readJson<T>(await send(api, path, init));
}

async function readJson<T>(res: Response): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new LoadError('upstream');
  }
  if (!res.ok) {
    const e = body as Partial<ApiError>;
    throw new LoadError(e.error ?? 'upstream', e.retryAt);
  }
  return body as T;
}

async function inParallel<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

/**
 * How many snapshots to take when each file list is read in `parts` calls: enough to show the
 * project grow, few enough that the build stays inside MAX_PIECES and the hourly GitHub allowance.
 */
export function snapshotLimit(parts: number): number {
  return parts > 1 ? Math.max(4, Math.min(MAX_SNAPSHOTS, Math.floor(TREE_PIECES / parts))) : MAX_SNAPSHOTS;
}

/** Up to MAX_SNAPSHOTS commits spread evenly through the history, oldest first, always ending at the head. */
export function pickSnapshots(candidates: { sha: string; at: number }[], head: string, max = MAX_SNAPSHOTS): string[] {
  const list = candidates.filter((c) => c.sha !== head).sort((a, b) => a.at - b.at);
  const room = Math.max(1, max - 1);
  const picked: string[] = [];
  if (list.length <= room) {
    picked.push(...list.map((c) => c.sha));
  } else {
    for (let i = 0; i < room; i++) picked.push(list[Math.round((i * (list.length - 1)) / (room - 1))].sha);
  }
  return [...new Set(picked), head];
}

function q(repo: RepoInfo, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams({ repo: `${repo.owner}/${repo.name}`, head: repo.head });
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return params.toString();
}

// pages loaded before saved copies came as plain text still know them by their old type
const isBundle = (res: Response) => res.headers.get('x-replay-bundle') === '1' || (res.headers.get('content-type') ?? '').startsWith('text/x-repo-replay');

async function replayFrom(res: Response): Promise<Replay> {
  const bundle = decodeBundle(await res.text());
  if (!bundle) throw new LoadError('upstream');
  return assemble(bundle.pieces.map((s) => decodePiece(s.body)), bundle.builtAt);
}

/** The newest saved replay, if there is one, without building anything or asking GitHub. */
export async function loadSaved(ref: RepoRef, opts: { api?: Api; signal?: AbortSignal } = {}): Promise<Replay | null> {
  const api: Api = opts.api ?? ((path, init) => fetch(path, { ...init, signal: opts.signal }));
  const res = await api(`/api/saved/${ref.owner}/${ref.name}`);
  return res.ok && isBundle(res) ? replayFrom(res) : null;
}

export async function loadReplay(
  ref: RepoRef,
  opts: { api?: Api; onProgress?: (p: Progress) => void; signal?: AbortSignal } = {},
): Promise<Loaded> {
  const api: Api = opts.api ?? ((path, init) => fetch(path, { ...init, signal: opts.signal }));
  const progress = opts.onProgress ?? (() => {});
  const check = () => opts.signal?.throwIfAborted();

  progress({ stage: 'start' });
  const first = await send(api, `/api/replay/${ref.owner}/${ref.name}`);
  if (first.ok && isBundle(first)) {
    return { replay: await replayFrom(first), cached: true, stale: first.headers.get('x-replay-stale') === '1', saved: true };
  }
  const start = await readJson<StartResponse>(first);

  const repo = start.repo;
  const signed: Signed[] = [start.piece];
  const pieces: Piece[] = [decodePiece(start.piece.body)];
  const keep = (s: Signed) => {
    signed.push(s);
    const p = decodePiece(s.body);
    pieces.push(p);
    return p;
  };
  const candidates: { sha: string; at: number }[] = [];


  const treeQ = (sha: string, extra: Record<string, string | number> = {}) => `/api/trees?${q(repo, { shas: sha, ...extra })}`;
  const readParts = async (sha: string, parts: number, depth: number) => {
    const all = await inParallel(
      Array.from({ length: parts }, (_, part) => () => call<TreePartResponse>(api, treeQ(sha, { part, parts, depth }))),
      PARALLEL,
    );
    return all.map((r) => {
      if (!('piece' in r)) throw new LoadError('upstream');
      return keep(r.piece) as TreePiece;
    });
  };

  // The latest file list doesn't depend on the history, so it's read alongside it. It decides how
  // deep to look, and how many snapshots fit when every file list has to be read in parts.
  const readHead = async (): Promise<{ depth: number; headFiles: number; headParts: number }> => {
    const head = await call<TreesResponse>(api, treeQ(repo.head));
    if (head.pieces.length && head.depth !== null) {
      return { depth: head.depth, headFiles: (keep(head.pieces[0]) as TreePiece).files, headParts: 1 };
    }
    const split = head.split.find((s) => s.sha === repo.head);
    if (!split) throw new LoadError('upstream');
    const counted = await inParallel(
      Array.from({ length: split.parts }, (_, part) => () => call<TreePartResponse>(api, treeQ(repo.head, { part, parts: split.parts }))),
      PARALLEL,
    );
    let counts: DepthCounts | null = null;
    for (const r of counted) {
      if (!('counts' in r)) throw new LoadError('upstream');
      counts = counts ? addCounts(counts, r.counts) : r.counts;
    }
    const depth = depthFromCounts(counts!);
    const files = (await readParts(repo.head, split.parts, depth)).reduce((n, t) => n + t.files, 0);
    return { depth, headFiles: files, headParts: split.parts };
  };
  const headRead = readHead();
  // Keep a failure here from counting as unhandled while the history is still loading.
  headRead.catch(() => {});


  if (!repo.sampled) {
    let after: string | null = null;
    let done = 0;
    progress({ stage: 'history', done, total: repo.commits, unit: 'commits' });
    do {
      check();
      const extra: Record<string, string> = after ? { after } : {};
      const res: PieceResponse = await call<PieceResponse>(api, `/api/history?${q(repo, extra)}`);
      const page = keep(res.piece) as CommitsPiece;
      page.shas.forEach((sha, i) => candidates.push({ sha, at: page.rows[i][0] }));
      done += page.shas.length;
      progress({ stage: 'history', done: Math.min(done, repo.commits), total: repo.commits, unit: 'commits' });
      after = page.next;
    } while (after);
  } else {
    // Very long histories time out at GitHub with several slices per query, so don't even try.
    const perCall = repo.commits > ONE_SLICE_ABOVE ? 1 : BUCKETS_PER_CALL;
    const ranges: [number, number][] = [];
    for (let from = 0; from < BUCKETS; from += perCall) ranges.push([from, Math.min(from + perCall, BUCKETS)]);
    let done = 0;
    progress({ stage: 'history', done, total: BUCKETS, unit: 'parts' });
    // GitHub stops a query after about ten seconds, so a range that fails is asked for again one
    // slice at a time.
    const read = async (from: number, to: number, retried = false): Promise<void> => {
      check();
      let res: PieceResponse;
      try {
        res = await call<PieceResponse>(api, `/api/buckets?${q(repo, { first: repo.firstAt, last: repo.headAt, from, to })}`);
      } catch (err) {
        if (!(err instanceof LoadError) || err.kind !== 'upstream') throw err;
        if (to - from > 1) {
          await inParallel(Array.from({ length: to - from }, (_, i) => () => read(from + i, from + i + 1)), PARALLEL);
          return;
        }
        if (retried) throw err;
        return read(from, to, true);
      }
      const piece = keep(res.piece) as BucketsPiece;
      // The newest commit in each bucket stands for how the project looked at the end of it.
      piece.buckets.forEach((b, j) => {
        if (b.shas[0]) candidates.push({ sha: b.shas[0], at: piece.samples[j][0][0] });
      });
      done += piece.buckets.length;
      progress({ stage: 'history', done, total: BUCKETS, unit: 'parts' });
    };
    await inParallel(ranges.map(([from, to]) => () => read(from, to)), PARALLEL);
  }

  check();
  progress({ stage: 'files', done: 0, total: MAX_SNAPSHOTS });
  const { depth, headFiles, headParts } = await headRead;

  if (repo.firstSha && !candidates.some((c) => c.sha === repo.firstSha)) candidates.push({ sha: repo.firstSha, at: repo.firstAt });
  const shas = pickSnapshots(candidates, repo.head, snapshotLimit(headParts));
  const total = shas.length;
  let done = 1;
  progress({ stage: 'files', done, total });

  const rest = shas.filter((s) => s !== repo.head);
  const perCall = headParts > 1 ? 1 : Math.max(1, Math.min(10, Math.floor(FILES_PER_CALL / Math.max(headFiles, 1))));
  const batches: string[][] = [];
  for (let i = 0; i < rest.length; i += perCall) batches.push(rest.slice(i, i + perCall));
  await inParallel(
    batches.map((batch) => async () => {
      check();
      const res = await call<TreesResponse>(api, treeQ(batch.join(','), { depth }));
      res.pieces.forEach(keep);
      for (const s of res.split) {
        check();
        await readParts(s.sha, s.parts, depth);
      }
      done += batch.length;
      progress({ stage: 'files', done, total });
    }),
    PARALLEL,
  );

  check();
  progress({ stage: 'save' });
  const replay = assemble(pieces, new Date().toISOString());
  let saved = false;
  try {
    const res = await call<StoreResponse>(api, '/api/replay', {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: encodePieces(signed),
    });
    saved = res.saved;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // Not being able to save only means the next visit builds it again.
  }
  return { replay, cached: false, stale: false, saved };
}
