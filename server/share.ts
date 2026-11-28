import { fmt, monthYear } from '../shared/chart';
import { decodeHeader, type Signed, type TreeHeader } from '../shared/pieces';
import type { RepoInfo } from '../shared/replay';

// What a chat app or social site shows for a replay link: the page's title, description and picture,
// written into the page's <head> on the server because link previews don't run the page's script.

export interface ShareMeta {
  title: string;
  ogTitle: string;
  description: string;
  image: string;
  imageAlt: string;
}

/** The repo and how many files its newest snapshot holds, from piece headers only. */
export function shareFacts(pieces: Signed[]): { repo: RepoInfo; files: number } | null {
  let repo: RepoInfo | null = null;
  const trees: TreeHeader[] = [];
  for (const p of pieces) {
    const h = decodeHeader(p.body);
    if (h.kind === 'repo') repo = h.repo;
    else if (h.kind === 'tree') trees.push(h);
  }
  if (!repo) return null;
  const head = repo.head;
  const files = trees.filter((t) => t.sha === head).reduce((n, t) => n + t.files, 0);
  return { repo, files };
}

export function replayMeta(facts: { repo: RepoInfo; files: number }, origin: string): ShareMeta {
  const { repo, files } = facts;
  const full = `${repo.owner}/${repo.name}`;
  const commits = `${fmt(repo.commits)} ${repo.commits === 1 ? 'commit' : 'commits'}`;
  return {
    title: `${full} · repo-replay`,
    ogTitle: `How ${full} grew`,
    description: `${fmt(files)} ${files === 1 ? 'file' : 'files'} and ${commits} since ${monthYear(repo.firstAt)}. A short replay of how it grew, with the big moments marked.`,
    image: `${origin}/api/og/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}.png?v=${repo.head.slice(0, 12)}`,
    imageAlt: `Files in ${full} from ${monthYear(repo.firstAt)} to ${monthYear(repo.headAt)}, by top-level folder`,
  };
}

/** For a repo with no saved replay yet: the site's own picture. */
export function unbuiltMeta(owner: string, name: string, origin: string): ShareMeta {
  return {
    title: `${owner}/${name} · repo-replay`,
    ogTitle: `How ${owner}/${name} grew`,
    description: `A short replay of how ${owner}/${name} grew, from the first commit to today, with the big moments marked.`,
    image: `${origin}/og.png`,
    imageAlt: 'repo-replay: see how any GitHub project grew',
  };
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page with its title and preview tags set. Tags the page lacks are left alone. */
export function withMeta(html: string, m: ShareMeta): string {
  const set = (key: string, value: string) => (doc: string) =>
    doc.replace(new RegExp(`(<meta (?:name|property)="${key.replace(/[:.]/g, '\\$&')}" content=")[^"]*(")`), (_, a: string, b: string) => `${a}${attr(value)}${b}`);
  const steps = [
    (doc: string) => doc.replace(/<title>[^<]*<\/title>/, `<title>${attr(m.title)}</title>`),
    set('description', m.description),
    set('og:title', m.ogTitle),
    set('og:description', m.description),
    set('og:image', m.image),
    set('og:image:alt', m.imageAlt),
  ];
  return steps.reduce((doc, step) => step(doc), html);
}
