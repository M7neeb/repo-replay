import type { Signed } from './pieces';

// What the page sends to be saved, and what KV keeps: three lines per piece (signature,
// header, data). The saved copy adds one first line with the format number and build time.
// This is the stored format behind the replay:v1: keys; change it only with a migration.

const MAGIC = 'repo-replay 1';

/**
 * Raised when a fix changes what a build contains. Saved copies from older builds are built again
 * on the next visit (they are still shown while GitHub is busy).
 * 2: the first and last time slices of a sampled history were missing commits.
 * 3: merge commits counted the lines of the branch they merged a second time.
 * 4: older snapshots of big projects lost track of which folder many of their files were in.
 */
export const BUILD = 4;

export interface BundleMeta {
  builtAt: string;
  build?: number;
}

export function encodePieces(pieces: Signed[]): string {
  return pieces.map((p) => `${p.sig}\n${p.body}`).join('\n');
}

export function decodePieces(text: string): Signed[] | null {
  const lines = text.split('\n');
  if (lines.length % 3 !== 0) return null;
  const out: Signed[] = [];
  for (let i = 0; i < lines.length; i += 3) out.push({ sig: lines[i], body: `${lines[i + 1]}\n${lines[i + 2]}` });
  return out;
}

export function encodeBundle(builtAt: string, piecesText: string): string {
  return `${MAGIC} ${builtAt}\n${piecesText}`;
}

export function decodeBundle(text: string): { builtAt: string; pieces: Signed[] } | null {
  const cut = text.indexOf('\n');
  if (cut === -1 || !text.startsWith(`${MAGIC} `)) return null;
  const pieces = decodePieces(text.slice(cut + 1));
  return pieces ? { builtAt: text.slice(MAGIC.length + 1, cut), pieces } : null;
}
