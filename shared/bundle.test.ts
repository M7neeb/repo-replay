import { expect, it } from 'vitest';
import { decodeBundle, decodePieces, encodeBundle, encodePieces } from './bundle';
import { decodeHeader, decodePiece, encodePiece } from './pieces';

it('round-trips pieces, including text with newlines inside strings', () => {
  const body = encodePiece({ kind: 'tree', key: 'k', sha: 's', depth: 0, files: 1, bytes: 1, truncated: false, part: 0, parts: 1 }, { entries: [['a\nb', 1, 1]] });
  const pieces = [{ sig: 'x'.repeat(64), body }, { sig: 'y'.repeat(64), body }];
  const text = encodePieces(pieces);
  expect(decodePieces(text)).toEqual(pieces);
  const bundle = decodeBundle(encodeBundle('2026-11-25T10:00:00.000Z', text))!;
  expect(bundle.builtAt).toBe('2026-11-25T10:00:00.000Z');
  expect(decodePiece(bundle.pieces[0].body)).toMatchObject({ kind: 'tree', entries: [['a\nb', 1, 1]] });
  expect(decodeHeader(bundle.pieces[0].body)).toEqual({ kind: 'tree', key: 'k', sha: 's', depth: 0, files: 1, bytes: 1, truncated: false, part: 0, parts: 1 });
});

it('refuses text that is not a bundle', () => {
  expect(decodeBundle('{"format":1}')).toBeNull();
  expect(decodePieces('one\ntwo')).toBeNull();
});
