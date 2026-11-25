import type { RepoInfo } from './replay';

// A build is a list of pieces. The server signs each one when it hands it out, checks the
// signatures again before saving, and saves the pieces themselves; the page turns them into
// a Replay. Each piece is two lines of JSON: a small header the server can check cheaply,
// and the data, which it never needs to read.

export interface RawAuthor {
  name: string;
  login: string | null;
  avatar: string | null;
}

/** [unix seconds, lines added, lines deleted, files changed, index into the piece's authors or -1] */
export type CommitRow = [number, number, number, number, number];

export interface RepoHeader {
  kind: 'repo';
  key: string;
  repo: RepoInfo;
}

export interface CommitsHeader {
  kind: 'commits';
  key: string;
  after: string | null;
  next: string | null;
  /** Newest first, as GitHub lists them. */
  shas: string[];
}

export interface CommitsData {
  authors: RawAuthor[];
  /** Same order as the header's shas. */
  rows: CommitRow[];
}

export interface BucketHeader {
  since: number;
  until: number;
  count: number;
  /** The newest commits in the bucket, newest first. */
  shas: string[];
}

export interface BucketsHeader {
  kind: 'buckets';
  key: string;
  from: number;
  buckets: BucketHeader[];
}

export interface BucketsData {
  authors: RawAuthor[];
  /** One list per bucket, same order as each bucket's shas. */
  samples: CommitRow[][];
}

export interface TreeHeader {
  kind: 'tree';
  key: string;
  sha: string;
  depth: number;
  files: number;
  bytes: number;
  truncated: boolean;
  /** A big file list is read in parts; files and bytes then count only this part. */
  part: number;
  parts: number;
}

export interface TreeData {
  entries: [string, number, number][];
}

export type Header = RepoHeader | CommitsHeader | BucketsHeader | TreeHeader;
export type RepoPiece = RepoHeader;
export type CommitsPiece = CommitsHeader & CommitsData;
export type BucketsPiece = BucketsHeader & BucketsData;
export type TreePiece = TreeHeader & TreeData;
export type Piece = RepoPiece | CommitsPiece | BucketsPiece | TreePiece;

export interface Signed {
  body: string;
  sig: string;
}

export const MAX_FULL_COMMITS = 5000;
export const BUCKETS = 60;
export const MAX_SNAPSHOTS = 60;
export const MAX_ENTRIES = 400;

export function pieceKey(owner: string, name: string, head: string): string {
  return `${owner}/${name}@${head}`;
}

// JSON.stringify never writes a raw newline, so the first one always splits header from data.
export function encodePiece(header: Header, data: object = {}): string {
  return `${JSON.stringify(header)}\n${JSON.stringify(data)}`;
}

export function decodeHeader(body: string): Header {
  const cut = body.indexOf('\n');
  return JSON.parse(cut === -1 ? body : body.slice(0, cut)) as Header;
}

export function decodePiece(body: string): Piece {
  const cut = body.indexOf('\n');
  return { ...JSON.parse(body.slice(cut + 1)), ...JSON.parse(body.slice(0, cut)) } as Piece;
}

/** Bucket edges in unix seconds: count + 1 numbers from the first commit to past the head. */
export function bucketEdges(firstAt: number, headAt: number, count = BUCKETS): number[] {
  const start = Math.min(firstAt, headAt);
  const span = Math.max(headAt - start, count);
  const edges: number[] = [];
  for (let i = 0; i <= count; i++) edges.push(start + Math.round((span * i) / count));
  // GitHub's until is inclusive, so the last bucket has to reach one second past the head commit
  edges[count] = Math.max(edges[count], headAt) + 1;
  return edges;
}
