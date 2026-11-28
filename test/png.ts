import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';

/** Width, height and the raw rows (filter byte + RGB) of a PNG, checked by Node's own zlib. */
export function readPng(png: Uint8Array): { w: number; h: number; rows: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IHDR') {
      w = dv.getUint32(at + 8);
      h = dv.getUint32(at + 12);
    }
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += len + 12;
  }
  return { w, h, rows: new Uint8Array(inflateSync(Buffer.concat(idat))) };
}
