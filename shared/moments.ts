import type { Moment, Replay, RepoInfo } from './replay';
import { fmt, lightSnapshots, type LightSnapshot } from './chart';

// Milestones found by rules from the data alone. Each caption states only what the snapshots show;
// folder names are marked with backticks. A later step may reword them, never change the facts.

const FILE_MARKS = [1_000, 10_000, 100_000];
const MAX_MOMENTS = 5;

// folders that hold project tooling rather than the project itself
const tooling = (name: string) => name === '(files)' || name.startsWith('.');

interface Candidate extends Moment {
  score: number;
}

export function findMoments(replay: Replay): Moment[] {
  return findMomentsFrom(replay.repo, lightSnapshots(replay));
}

export function findMomentsFrom(repo: RepoInfo, snapshots: LightSnapshot[]): Moment[] {
  if (snapshots.length === 0) return [];
  const counts = snapshots.map((s) => s.counts);
  const found: Candidate[] = [{ at: repo.firstAt, kind: 'first-commit', data: {}, caption: 'First commit', score: 100 }];

  for (let i = 1; i < snapshots.length; i++) {
    // a list GitHub cut short is missing folders it never listed, so it can't show what arrived or left
    if (snapshots[i].truncated || snapshots[i - 1].truncated) continue;
    const before = counts[i - 1];
    const after = counts[i];
    const prevFiles = snapshots[i - 1].files;
    const files = snapshots[i].files;
    const big = (n: number, of: number) => n >= Math.max(20, of * 0.05);
    const arrived = [...after].filter(([k, n]) => !tooling(k) && !before.has(k) && big(n, files)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const gone = [...before].filter(([k, n]) => !tooling(k) && !after.has(k) && big(n, prevFiles)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const at = snapshots[i].at;
    if (arrived.length && gone.length) {
      found.push({
        at, kind: 'rename', data: { arrived, gone },
        caption: `\`${arrived[0]}/\` arrives and \`${gone[0]}/\` is gone`, score: 60,
      });
    } else if (arrived.length) {
      found.push({ at, kind: 'new-top-folder', data: { folder: arrived[0] }, caption: `\`${arrived[0]}/\` arrives`, score: 40 });
    } else if (gone.length) {
      found.push({ at, kind: 'removed-folder', data: { folder: gone[0] }, caption: `\`${gone[0]}/\` is removed`, score: 35 });
    }
    const mark = FILE_MARKS.filter((m) => prevFiles < m && files >= m).pop();
    if (mark) found.push({ at, kind: 'file-mark', data: { files: mark }, caption: `Passes ${fmt(mark)} files`, score: 20 + Math.log10(mark) });
  }

  // keep the strongest, but never two so close together that their labels would pile up
  const span = Math.max(repo.headAt - repo.firstAt, 1);
  const kept: Candidate[] = [];
  for (const c of [...found].sort((a, b) => b.score - a.score || a.at - b.at)) {
    if (kept.length >= MAX_MOMENTS) break;
    if (kept.some((k) => Math.abs(k.at - c.at) < span * 0.07)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.at - b.at).map(({ score: _score, ...m }) => m);
}
