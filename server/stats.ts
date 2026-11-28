import type { Fetch } from './github';

// Weekly npm downloads are the honest answer to "how many people use it", but only when the repo
// really is the package's home: its package.json is public and points back at this repo.

const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

function repoField(pkg: Record<string, unknown>): string {
  const r = pkg.repository;
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object' && typeof (r as { url?: unknown }).url === 'string') return (r as { url: string }).url;
  return '';
}

function pointsAt(field: string, owner: string, name: string): boolean {
  const f = field.toLowerCase().replace(/\.git$/, '');
  const o = owner.toLowerCase(), n = name.toLowerCase();
  return f.includes(`github.com/${o}/${n}`) || f.includes(`github.com:${o}/${n}`) || f === `github:${o}/${n}` || f === `${o}/${n}`;
}

/** The npm package this repo publishes, from its root package.json or packages/<name>/package.json. */
export function npmPackage(texts: (string | null | undefined)[], owner: string, name: string): string | null {
  for (const text of texts) {
    if (!text) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!pkg || typeof pkg !== 'object' || pkg.private === true || typeof pkg.name !== 'string') continue;
    if (NPM_NAME.test(pkg.name) && pointsAt(repoField(pkg), owner, name)) return pkg.name;
  }
  return null;
}

/** Downloads in the last week, or null when npm doesn't know the package or can't be reached. */
export async function weeklyDownloads(pkg: string, fetcher: Fetch = fetch): Promise<number | null> {
  try {
    const res = await fetcher(`https://api.npmjs.org/downloads/point/last-week/${pkg}`, { headers: { 'user-agent': 'repo-replay' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { downloads?: unknown };
    return typeof body.downloads === 'number' && body.downloads >= 0 ? body.downloads : null;
  } catch {
    return null;
  }
}
