import type { CameraFrame, VisionOutput } from '../protocol/types';
import { analyzeLocalVision } from './localVision';

async function analyzeFrame(
  frame: CameraFrame | null,
  now: number
): Promise<VisionOutput> {
  return analyzeLocalVision(frame, now);
}

export const visionSignals = {
  analyzeFrame,
};
