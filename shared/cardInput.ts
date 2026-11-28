import { checkStructure } from './assemble';
import type { LightSnapshot } from './chart';
import { decodeHeader, type BucketsData, type CommitsData, type Header, type Signed, type TreeHeader } from './pieces';
import type { RepoInfo } from './replay';

// The README card needs far less than a full replay: when each snapshot was taken and how many files each
// top folder held. That comes from the small headers plus the commit dates, without reading any file list,
// so the server can draw the card for a big project inside its CPU budget.

const data = <T>(body: string): T => JSON.parse(body.slice(body.indexOf('\n') + 1)) as T;

export function cardInput(pieces: Signed[]): { repo: RepoInfo; snapshots: LightSnapshot[] } | null {
  const headers: Header[] = pieces.map((p) => decodeHeader(p.body));
  const { repo, pages, bucketPieces, trees } = checkStructure(headers);

  const wanted = new Set(trees.map((t) => t.sha));
  const dates = new Map<string, number>([[repo.head, repo.headAt]]);
  for (const i of repo.sampled ? bucketPieces : pages) {
    const h = headers[i];
    if (h.kind === 'commits') {
      if (!h.shas.some((s) => wanted.has(s))) continue;
      const rows = data<CommitsData>(pieces[i].body).rows;
      h.shas.forEach((sha, j) => wanted.has(sha) && dates.set(sha, rows[j][0]));
    } else if (h.kind === 'buckets') {
      if (!h.buckets.some((b) => b.shas.some((s) => wanted.has(s)))) continue;
      const samples = data<BucketsData>(pieces[i].body).samples;
      h.buckets.forEach((b, j) => b.shas.forEach((sha, k) => wanted.has(sha) && dates.set(sha, samples[j][k][0])));
    }
  }

  const snapshots: LightSnapshot[] = [];
  for (const t of trees) {
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
    snapshots.push({ at: dates.get(t.sha) ?? repo.headAt, files, truncated, counts });
  }
  snapshots.sort((a, b) => a.at - b.at);
  return { repo, snapshots };
}
