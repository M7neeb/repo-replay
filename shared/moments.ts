import type { Moment, Replay, RepoInfo, TimelineRow } from './replay';
import { fmt, lightSnapshots, type LightSnapshot } from './chart';

// Milestones found by rules from the data alone. Each caption states only what the data shows, in plain
// words; folder and tag names are marked with backticks. Nothing here guesses what a folder is for.

const FILE_MARKS = [1_000, 10_000, 100_000];
const PEOPLE_MARKS = [10, 100, 1_000];
const MAX_MOMENTS = 5;
const DAY = 86_400;

export interface MomentInput {
  repo: RepoInfo;
  snapshots: LightSnapshot[];
  /** Oldest first: one row per commit, or per time slice when the history was sampled. */
  timeline: TimelineRow[];
}

// folders that hold project tooling rather than the project itself
const tooling = (name: string) => name === '(files)' || name.startsWith('.');

interface Candidate extends Moment {
  score: number;
}

const months = (seconds: number) => Math.max(1, Math.round(seconds / (30.44 * DAY)));
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

export function findMoments(replay: Replay): Moment[] {
  return findMomentsFrom({ repo: replay.repo, snapshots: lightSnapshots(replay), timeline: replay.timeline });
}

export function findMomentsFrom({ repo, snapshots, timeline }: MomentInput): Moment[] {
  if (snapshots.length === 0) return [];
  const found: Candidate[] = [{ at: repo.firstAt, kind: 'first-commit', data: {}, caption: 'First commit', label: 'First commit', score: 100 }];

  const release = repo.firstRelease;
  if (release && release.at >= repo.firstAt && release.at <= repo.headAt) {
    found.push({
      at: release.at, kind: 'release', data: { tag: release.tag, kind: release.kind },
      caption: `${release.kind === 'release' ? 'First GitHub release' : 'First tagged version'}, \`${release.tag}\``, label: `\`${release.tag}\``, score: 70,
    });
  }

  let growth: Candidate | null = null;
  let cleanup: Candidate | null = null;
  for (let i = 1; i < snapshots.length; i++) {
    // a list GitHub cut short is missing folders it never listed, so it can't show what arrived or left
    if (snapshots[i].truncated || snapshots[i - 1].truncated) continue;
    const before = snapshots[i - 1];
    const after = snapshots[i];
    const at = after.at;
    const big = (n: number, of: number) => n >= Math.max(20, of * 0.05);
    const arrived = [...after.counts].filter(([k, n]) => !tooling(k) && !before.counts.has(k) && big(n, after.files)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const gone = [...before.counts].filter(([k, n]) => !tooling(k) && !after.counts.has(k) && big(n, before.files)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (arrived.length && gone.length) {
      found.push({ at, kind: 'rename', data: { arrived, gone }, caption: `\`${arrived[0]}/\` arrives and \`${gone[0]}/\` is gone`, label: `\`${arrived[0]}/\` arrives`, score: 60 });
    } else if (arrived.length) {
      found.push({ at, kind: 'new-top-folder', data: { folder: arrived[0] }, caption: `\`${arrived[0]}/\` arrives`, label: `\`${arrived[0]}/\` arrives`, score: 40 });
    } else if (gone.length) {
      found.push({ at, kind: 'removed-folder', data: { folder: gone[0] }, caption: `\`${gone[0]}/\` is removed`, label: `\`${gone[0]}/\` removed`, score: 35 });
    }

    // the biggest folder changes, when both are real folders and it isn't the same event as an arrival
    const top = (c: Map<string, number>) => [...c].filter(([k]) => !tooling(k)).sort((a, b) => b[1] - a[1])[0]?.[0];
    const was = top(before.counts), now = top(after.counts);
    if (was && now && was !== now && before.counts.has(now) && after.counts.has(was)) {
      found.push({ at, kind: 'top-folder', data: { folder: now, was }, caption: `\`${now}/\` becomes the biggest folder`, label: `\`${now}/\` biggest`, score: 45 });
    }

    const mark = FILE_MARKS.filter((m) => before.files < m && after.files >= m).pop();
    if (mark) found.push({ at, kind: 'file-mark', data: { files: mark }, caption: `Passes ${fmt(mark)} files`, label: `${fmt(mark)} files`, score: 20 + Math.log10(mark) });

    const change = after.files - before.files;
    const span = `in ${plural(months(after.at - before.at), 'month', 'months')}`;
    if (change >= Math.max(100, before.files * 0.25) && (!growth || change / before.files > (growth.data.ratio as number))) {
      growth = { at, kind: 'growth-spurt', data: { from: before.files, to: after.files, ratio: change / before.files }, caption: `Grows from ${fmt(before.files)} to ${fmt(after.files)} files ${span}`, label: `+${fmt(change)} files`, score: 30 };
    }
    if (-change >= Math.max(50, before.files * 0.12) && (!cleanup || -change > (cleanup.data.from as number) - (cleanup.data.to as number))) {
      cleanup = { at, kind: 'cleanup', data: { from: before.files, to: after.files }, caption: `Drops from ${fmt(before.files)} to ${fmt(after.files)} files ${span}`, label: `${fmt(-change)} files fewer`, score: 32 };
    }
  }
  if (growth) found.push(growth);
  if (cleanup) found.push(cleanup);

  // the busiest stretch: one month in a history read commit by commit, one time slice in a sampled one
  if (repo.sampled) {
    let best = -1;
    timeline.forEach((row, i) => { if (best === -1 || row[1] > timeline[best][1]) best = i; });
    if (best >= 0 && timeline[best][1] > 0) {
      const end = timeline[best + 1]?.[0] ?? repo.headAt;
      found.push({
        at: timeline[best][0], kind: 'busiest', data: { commits: timeline[best][1] },
        caption: `The busiest stretch: ${plural(timeline[best][1], 'commit', 'commits')} in ${plural(months(end - timeline[best][0]), 'month', 'months')}`, label: 'Busiest stretch', score: 25,
      });
    }
  } else if (timeline.length >= 30) {
    const byMonth = new Map<string, { at: number; n: number }>();
    for (const [at, n] of timeline) {
      const d = new Date(at * 1000);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      const m = byMonth.get(key) ?? { at: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000, n: 0 };
      m.n += n;
      byMonth.set(key, m);
    }
    const best = [...byMonth.values()].sort((a, b) => b.n - a.n || a.at - b.at)[0];
    found.push({ at: Math.max(best.at, repo.firstAt), kind: 'busiest', data: { commits: best.n }, caption: `The busiest month: ${plural(best.n, 'commit', 'commits')}`, label: 'Busiest month', score: 25 });

    // people are only counted exactly when every commit was read
    const seen = new Set<number>();
    let mark = 0;
    for (const [at, , , , , author] of timeline) {
      if (author < 0 || seen.has(author)) continue;
      seen.add(author);
      if (PEOPLE_MARKS.includes(seen.size) && seen.size > 1) {
        mark = seen.size;
        found.push({ at, kind: 'people', data: { people: mark }, caption: `The ${ordinal(mark)} person makes a commit`, label: `${ordinal(mark)} person`, score: 18 + Math.log10(mark) });
      }
    }
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

function ordinal(n: number): string {
  return `${fmt(n)}th`;
}
