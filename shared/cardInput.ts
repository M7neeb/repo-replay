import { buildTimeline, checkStructure } from './assemble';
import type { LightSnapshot } from './chart';
import type { MomentInput } from './moments';
import { decodeHeader, decodePiece, type Header, type Piece, type Signed, type TreeHeader } from './pieces';

// The README card needs far less than a full replay: the commit timeline and, per snapshot, how many files
// each top folder held. That comes from the commit pages (or time buckets) plus the small tree headers,
// without reading any file list, so the server can draw the card for a big project inside its CPU budget.

export function cardInput(signed: Signed[]): MomentInput | null {
  const headers: Header[] = signed.map((p) => decodeHeader(p.body));
  const structure = checkStructure(headers);
  // only the commit pages and buckets need their data; tree pieces stay headers
  const pieces = headers.map((h, i) => (h.kind === 'commits' || h.kind === 'buckets' ? decodePiece(signed[i].body) : (h as Piece)));
  const { timeline, dates } = buildTimeline(pieces, structure);

  const snapshots: LightSnapshot[] = [];
  for (const t of structure.trees) {
    let files = 0;
    let truncated = false;
    const counts = new Map<string, number>();
    for (const i of t.parts) {
      const h = headers[i] as TreeHeader;
      // copies saved before headers carried folder totals can't be drawn this way
      if (!h.folders) return null;
      files += h.files;
      truncated ||= h.truncated;
      for (const [k, n] of h.folders) counts.set(k, (counts.get(k) ?? 0) + n);
    }
    snapshots.push({ at: dates.get(t.sha) ?? structure.repo.headAt, files, truncated, counts });
  }
  snapshots.sort((a, b) => a.at - b.at);
  return { repo: structure.repo, snapshots, timeline };
}
