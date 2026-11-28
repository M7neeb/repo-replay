import { expect, it } from 'vitest';
import { OTHER, parseTree, partText, pickDepth, rollup, scanTree, type ScannedTree } from './rollup';

type Item = { path: string; type: string; size?: number };
const blob = (path: string, size = 10): Item => ({ path, type: 'blob', size });

// The same layout GitHub sends, with the folder entries git always includes.
function github(items: Item[], truncated = false): string {
  const folders = new Set<string>();
  for (const i of items) {
    const parts = i.path.split('/');
    for (let n = 1; n < parts.length; n++) folders.add(parts.slice(0, n).join('/'));
  }
  const all = [...items, ...[...folders].map((path) => ({ path, type: 'tree' }))];
  const tree = all.map((i) => ({ path: i.path, mode: i.type === 'tree' ? '040000' : '100644', type: i.type, sha: 'a'.repeat(40), ...(i.type === 'blob' ? { size: i.size } : {}), url: 'https://api.github.com/x' }));
  return JSON.stringify({ sha: 'b'.repeat(40), url: 'https://api.github.com/y', tree, truncated });
}
const scan = (items: Item[]): ScannedTree => scanTree(github(items));

it('reads GitHub’s file list the same way JSON.parse would', () => {
  const items = [blob('README.md', 5), blob('src/a "quoted" \\ name.ts', 7), blob('docs/ünïcode/日本.md', 9), { path: 'lib', type: 'commit' }];
  const fast = scanTree(github(items, true));
  const parsed = JSON.parse(github(items, true)) as { tree: Item[] };
  expect(fast.paths).toEqual(parsed.tree.map((t) => t.path));
  expect(fast.sizes).toEqual(parsed.tree.map((t) => t.size ?? 0));
  expect(fast.kinds).toEqual(parsed.tree.map((t) => (t.type === 'commit' ? 'other' : t.type)));
  expect(fast.truncated).toBe(true);
});

it('copes with GitHub listing the fields in another order', () => {
  const odd = JSON.stringify({ truncated: false, tree: [{ size: 3, type: 'blob', path: 'x' }, { type: 'tree', path: 'd', sha: 'a' }, { path: 'd/y', size: 4, type: 'blob' }] });
  expect(scanTree(odd)).toEqual(parseTree(odd));
  expect(scanTree(JSON.stringify({ tree: [], truncated: false })).paths).toEqual([]);
});

it('reads a big file list in parts that add up to the whole, every entry once', () => {
  const items: Item[] = [];
  for (let i = 0; i < 3000; i++) items.push(blob(i % 97 === 0 ? `ünï/日本 {${i}}.md` : `src/m${i % 40}/f${i}.ts`, i));
  const text = github(items, true);
  const bytes = new TextEncoder().encode(text);
  const whole = parseTree(text);
  for (const parts of [2, 3, 7, 64]) {
    const merged: ScannedTree = { paths: [], kinds: [], sizes: [], truncated: false };
    for (let part = 0; part < parts; part++) {
      const { text: t, from, to } = partText(bytes, part, parts);
      const p = scanTree(t, from, to);
      merged.paths.push(...p.paths);
      merged.kinds.push(...p.kinds);
      merged.sizes.push(...p.sizes);
      merged.truncated ||= p.truncated;
    }
    expect(merged, `${parts} parts`).toEqual(whole);
  }
});

it('lists every file when the tree is small', () => {
  const tree = scan([blob('README.md'), blob('src/a.ts'), blob('src/lib/b.ts')]);
  expect(rollup(tree, pickDepth(tree, 600)).entries.map((e) => e[0])).toEqual(['README.md', 'src/a.ts', 'src/lib/b.ts']);
});

it('folds deep folders into one entry each when there are too many files', () => {
  const items = [blob('README.md', 5)];
  for (let i = 0; i < 50; i++) items.push(blob(`src/lib/f${i}.ts`, 2), blob(`docs/p${i}.md`, 3));
  const tree = scan(items);
  const depth = pickDepth(tree, 20);
  expect(depth).toBe(0);
  const { entries, files, bytes } = rollup(tree, depth, 20);
  expect(entries).toEqual([
    ['README.md', 5, 1],
    ['docs/', 150, 50],
    ['src/', 100, 50],
  ]);
  expect(files).toBe(101);
  expect(bytes).toBe(255);
});

it('picks the deepest level that fits and agrees with what rollup produces', () => {
  const items: Item[] = [];
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) items.push(blob(`p${a}/q${b}/r${c}.ts`));
  const tree = scan(items);
  for (const max of [5, 6, 36, 40, 215, 216, 1000]) {
    const depth = pickDepth(tree, max);
    expect(rollup(tree, depth, 10_000).entries.length, `max ${max}`).toBeLessThanOrEqual(Math.max(max, 6));
    if (depth < 2) expect(rollup(tree, depth + 1, 10_000).entries.length, `max ${max}`).toBeGreaterThan(max);
  }
});

it('opens folders one level at a time', () => {
  const tree = scan([blob('src/a.ts'), blob('src/lib/b.ts'), blob('src/lib/c.ts'), blob('src/lib/x/d.ts')]);
  expect(rollup(tree, 1).entries.map((e) => e[0])).toEqual(['src/a.ts', 'src/lib/']);
  expect(rollup(tree, 2).entries.map((e) => e[0])).toEqual(['src/a.ts', 'src/lib/b.ts', 'src/lib/c.ts', 'src/lib/x/']);
});

it('puts whatever does not fit under one entry when even the top level is too big', () => {
  const tree = scan(Array.from({ length: 30 }, (_, i) => blob(`f${i}.txt`, i + 1)));
  const { entries, files } = rollup(tree, pickDepth(tree, 10), 10);
  expect(entries).toHaveLength(10);
  expect(entries.find((e) => e[0] === OTHER)![2]).toBe(21);
  expect(entries.reduce((s, e) => s + e[2], 0)).toBe(files);
});

it('skips submodules and folders', () => {
  expect(rollup(scan([blob('a'), { path: 'vendor/lib', type: 'commit' }]), 3).files).toBe(1);
});

it('opens fewer folder levels instead of losing which folder files are in', () => {
  // an old snapshot with far more small test folders than the depth picked from the newest one allows
  const items: Item[] = [blob('README.md', 5)];
  for (let i = 0; i < 300; i++) items.push(blob(`test/case${i}/input.js`, 2), blob(`test/case${i}/output.js`, 2));
  for (let i = 0; i < 20; i++) items.push(blob(`src/lib/m${i}.js`, 3));
  const { entries, files } = rollup(scan(items), 2, 50);
  expect(entries.length).toBeLessThanOrEqual(50);
  expect(entries.find((e) => e[0] === OTHER)).toBeUndefined();
  const inFolder = (top: string) => entries.filter((e) => e[0].startsWith(top)).reduce((n, e) => n + e[2], 0);
  expect(inFolder('test/')).toBe(600);
  expect(inFolder('src/')).toBe(20);
  expect(entries.reduce((n, e) => n + e[2], 0)).toBe(files);
});

it('only lumps top-level files together when even the top level does not fit', () => {
  const items: Item[] = [blob('src/a.ts')];
  for (let i = 0; i < 30; i++) items.push(blob(`f${i}.txt`, i + 1));
  const { entries } = rollup(scan(items), 3, 10);
  expect(entries).toHaveLength(10);
  expect(entries.some((e) => e[0] === 'src/')).toBe(true);
});
