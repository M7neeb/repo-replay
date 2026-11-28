import type { Replay } from '../../shared/replay';

export interface Period {
  label: string;
  commits: number;
  added: number;
  deleted: number;
  /** Files in the project at the end of the period, from the latest snapshot inside it. */
  files: number | null;
  newPeople: number;
}

export interface Summary {
  firstAt: number;
  headAt: number;
  commits: number;
  people: number;
  files: number;
  byMonth: boolean;
  periods: Period[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Under two years of history a year-by-year list is too short to read anything from, so go by month.
export function summarize(replay: Replay): Summary {
  const { repo, timeline, snapshots } = replay;
  const byMonth = repo.headAt - repo.firstAt < 2 * 365 * 24 * 3600;
  const keyOf = (t: number) => {
    const d = new Date(t * 1000);
    return byMonth ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : String(d.getUTCFullYear());
  };

  const periods: Period[] = [];
  const index = new Map<string, Period>();
  const seen = new Set<number>();
  for (const [at, n, add, del, , author] of timeline) {
    const label = keyOf(at);
    let p = index.get(label);
    if (!p) {
      p = { label, commits: 0, added: 0, deleted: 0, files: null, newPeople: 0 };
      index.set(label, p);
      periods.push(p);
    }
    p.commits += n;
    p.added += add;
    p.deleted += del;
    if (author >= 0 && !seen.has(author)) {
      seen.add(author);
      p.newPeople++;
    }
  }
  for (const s of snapshots) {
    const p = index.get(keyOf(s.at));
    if (p) p.files = s.files;
  }

  return {
    firstAt: repo.firstAt,
    headAt: repo.headAt,
    commits: repo.commits,
    people: replay.authors.length,
    files: snapshots.at(-1)?.files ?? 0,
    byMonth,
    periods,
  };
}

export function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Short form for big numbers so a row of them fits a phone: 9,999, 12.3k, 44.2M. */
export function formatShort(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) < 10_000) return v.toLocaleString('en-US');
  if (Math.abs(v) < 1_000_000) return `${(v / 1000).toFixed(v < 100_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(v < 100_000_000 ? 1 : 0)}M`;
}

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
