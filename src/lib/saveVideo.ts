import type { ChartModel, ThemeName } from '../../shared/chart';
import { Stage, type StageData, type View } from './stage';
import { durationFor } from './playback';
import { drawFrame, VIDEO_SIZE } from './video';

// Save video: every frame is drawn on a canvas and encoded as H.264 in an MP4 by the browser itself
// (WebCodecs), so nothing is uploaded and it works offline once the replay is open. H.264 in MP4 is what
// the iPhone's Photos app and WhatsApp accept without converting.

export const FPS = 30;
const LEAD = 1; // seconds on the first commit before it starts moving
const HOLD = 3; // seconds on the finished chart
// flat colours compress well; this keeps a minute of video near 11 MB, under chat apps' limits
const BITRATE = 1_500_000;

export class VideoUnsupported extends Error {
  override name = 'VideoUnsupported';
}

/** Which frame shows which point of the replay: still at the start, moving, then held at the end. */
export function progressAtFrame(frame: number, duration: number): number {
  return Math.min(1, Math.max(0, (frame / FPS - LEAD) / duration));
}

export function frameCount(commits: number): number {
  return Math.ceil((LEAD + durationFor(commits) + HOLD) * FPS);
}

export async function canSaveVideo(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  const { canEncodeVideo } = await import('mediabunny');
  return canEncodeVideo('avc', { width: VIDEO_SIZE, height: VIDEO_SIZE, bitrate: BITRATE });
}

export async function makeVideo(
  model: ChartModel,
  commits: number,
  opts: { theme: ThemeName; data: StageData; view: View; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Blob> {
  if (!(await canSaveVideo())) throw new VideoUnsupported();
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('mediabunny');

  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_SIZE;
  canvas.height = VIDEO_SIZE;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new VideoUnsupported();

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: BITRATE, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();

  const duration = durationFor(commits);
  const stage = new Stage(opts.data);
  stage.view = opts.view;
  const frame = { model, stage, commits, theme: opts.theme, duration };
  const total = frameCount(commits);
  try {
    for (let i = 0; i < total; i++) {
      opts.signal?.throwIfAborted();
      drawFrame(ctx, frame, progressAtFrame(i, duration), (i * 1000) / FPS);
      await source.add(i / FPS, 1 / FPS);
      if (i % 10 === 0) opts.onProgress?.(i, total);
    }
    source.close();
    await output.finalize();
  } catch (err) {
    if (output.state !== 'finalized') await output.cancel().catch(() => {});
    throw err;
  }
  opts.onProgress?.(total, total);
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}
