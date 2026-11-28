import { expect, it } from 'vitest';
import { durationFor } from './playback';
import { FPS, frameCount, progressAtFrame } from './saveVideo';

it('holds the first commit, plays at the player’s pace, then holds the finished chart', () => {
  const d = durationFor(11_549);
  expect(progressAtFrame(0, d)).toBe(0);
  expect(progressAtFrame(FPS - 1, d)).toBe(0);
  expect(progressAtFrame(FPS + (d * FPS) / 2, d)).toBeCloseTo(0.5);
  expect(progressAtFrame(FPS * (1 + d), d)).toBe(1);
  expect(frameCount(11_549)).toBe((1 + d + 3) * FPS);
  expect(progressAtFrame(frameCount(11_549) - 1, d)).toBe(1);
});
