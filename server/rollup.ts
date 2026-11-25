import { MAX_ENTRIES } from '../shared/pieces';
import { depthFromCounts, DEPTH_LIMIT, slashes, type DepthCounts } from '../shared/depth';

export interface ScannedTree {
  paths: string[];
  kinds: ('blob' | 'tree' | 'other')[];
  sizes: number[];
  truncated: boolean;
}

const PATH_KEY = '"path":"';

function escaped(text: string, quote: number): boolean {
  let n = 0;
  for (let i = quote - 1; i >= 0 && text.charCodeAt(i) === 92; i--) n++;
  return n % 2 === 1;
}

export function parseTree(text: string): ScannedTree {
  const data = JSON.parse(text) as { truncated?: boolean; tree?: { path: string; type: string; size?: number }[] };
  const tree = data.tree ?? [];
  return {
    paths: tree.map((t) => t.path),
    kinds: tree.map((t) => (t.type === 'blob' || t.type === 'tree' ? t.type : 'other')),
    sizes: tree.map((t) => t.size ?? 0),
    truncated: !!data.truncated,
  };
}

/**
 * Reads the entries whose "path" key lies between `from` and `to` in GitHub's tree JSON, without
 * parsing the rest. Big file lists are read in parts this way, one part per call, because parsing
 * several megabytes takes longer than the free plan's 10 ms of CPU. Quotes inside a path are always
 * escaped, so "path":" only matches a real key, and none of an entry's other values (mode, type, sha,
 * size, url) contain braces, so the braces around the key mark the entry whatever the field order.
 */
export function scanTree(text: string, from = 0, to = text.length): ScannedTree {
  const out: ScannedTree = { paths: [], kinds: [], sizes: [], truncated: text.includes('"truncated":true') };
  let at = text.indexOf(PATH_KEY, from);
  while (at !== -1 && at < to) {
    const start = at + PATH_KEY.length;
    let end = text.indexOf('"', start);
    while (end !== -1 && escaped(text, end)) end = text.indexOf('"', end + 1);
    if (end === -1) break;
    const open = text.lastIndexOf('{', at);
    const close = text.indexOf('}', end);
    const stop = close === -1 ? text.length : close;
    const field = (name: string) => {
      const before = text.indexOf(name, open);
      if (before !== -1 && before < at) return before;
      const after = text.indexOf(name, end);
      return after !== -1 && after < stop ? after : -1;
    };
    const t = field('"type":"');
    let kind: ScannedTree['kinds'][number] = 'other';
    if (t !== -1) {
      if (text.startsWith('blob"', t + 8)) kind = 'blob';
      else if (text.startsWith('tree"', t + 8)) kind = 'tree';
    }
    const s = field('"size":');
    const raw = text.slice(start, end);
    out.paths.push(raw.includes('\\') ? (JSON.parse(`"${raw}"`) as string) : raw);
    out.kinds.push(kind);
    out.sizes.push(s === -1 ? 0 : parseInt(text.slice(s + 7, s + 22), 10) || 0);
    at = text.indexOf(PATH_KEY, end);
  }
  return out;
}

/** Splits `bytes` into `parts` ranges that each start on an ASCII byte, so no character is cut in two. */
export function partRange(bytes: Uint8Array, part: number, parts: number): [number, number] {
  const cut = (n: number) => {
    if (n <= 0) return 0;
    if (n >= parts) return bytes.length;
    let i = Math.floor((bytes.length * n) / parts);
    while (i < bytes.length && bytes[i] >= 0x80) i++;
    return i;
  };
  return [cut(part), cut(part + 1)];
}

/**
 * The text for one part, with a little of the parts on either side so the entries at its edges are
 * whole. An entry belongs to the part its "path" key starts in: scan from `from` to `to`.
 */
export function partText(bytes: Uint8Array, part: number, parts: number): { text: string; from: number; to: number } {
  const [start, end] = partRange(bytes, part, parts);
  const ascii = (i: number, step: 1 | -1) => {
    while (i > 0 && i < bytes.length && bytes[i] >= 0x80) i += step;
    return Math.max(0, Math.min(bytes.length, i));
  };
  const decoder = new TextDecoder();
  const head = decoder.decode(bytes.subarray(ascii(start - 1024, -1), start));
  const own = decoder.decode(bytes.subarray(start, end));
  const tail = decoder.decode(bytes.subarray(end, ascii(end + 16384, 1)));
  return { text: head + own + tail, from: head.length, to: head.length + own.length };
}

// Depth is how many folder levels stay open. At depth 0 every top-level folder is one
// entry ("src/"); at depth 1 the files in src are listed but "src/lib/" is one entry.
function keyAt(path: string, depth: number): string {
  let slash = -1;
  for (let i = 0; i <= depth; i++) {
    slash = path.indexOf('/', slash + 1);
    if (slash === -1) return path;
  }
  return path.slice(0, slash + 1);
}

export function countDepths(tree: ScannedTree, limit = DEPTH_LIMIT): DepthCounts {
  const blobsAt = new Array<number>(limit + 2).fill(0);
  const treesAt = new Array<number>(limit + 2).fill(0);
  tree.paths.forEach((path, i) => {
    const n = Math.min(slashes(path), limit + 1);
    if (tree.kinds[i] === 'blob') blobsAt[n]++;
    else if (tree.kinds[i] === 'tree') treesAt[n]++;
  });
  return { blobsAt, treesAt };
}

export function pickDepth(tree: ScannedTree, max = MAX_ENTRIES): number {
  return depthFromCounts(countDepths(tree), max);
}

/** "/" collects whatever doesn't fit when even the top level has more than `max` entries. */
export const OTHER = '/';

export function rollup(tree: ScannedTree, depth: number, max = MAX_ENTRIES) {
  const groups = new Map<string, [number, number]>();
  let files = 0;
  let bytes = 0;
  tree.paths.forEach((path, i) => {
    if (tree.kinds[i] !== 'blob') return;
    const size = tree.sizes[i];
    files++;
    bytes += size;
    const key = keyAt(path, depth);
    const g = groups.get(key);
    if (g) {
      g[0] += size;
      g[1]++;
    } else {
      groups.set(key, [size, 1]);
    }
  });
  let entries: [string, number, number][] = [...groups].map(([path, [size, count]]) => [path, size, count]);
  if (entries.length > max) {
    entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const rest = entries.slice(max - 1);
    entries = entries.slice(0, max - 1);
    entries.push([OTHER, rest.reduce((s, e) => s + e[1], 0), rest.reduce((s, e) => s + e[2], 0)]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { entries, files, bytes };
}
