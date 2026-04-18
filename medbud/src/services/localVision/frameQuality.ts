import type { CameraFrame } from '../../protocol/types';
import { medbudEnv } from '../../utils/env';
import type { FrameQualityResult } from './types';

const FRAME_STALE_MS = 3000;

const defaultUnusableResult = (freshnessMs: number): FrameQualityResult => ({
  image_quality: 'unclear',
  frame_freshness_ms: freshnessMs,
  usable_for_local_cv: false,
  quality_factor: 0,
});

const getFrameFreshnessMs = (frame: CameraFrame | null, now: number) => {
  if (!frame) {
    return Number.POSITIVE_INFINITY;
  }

  const capturedAt = Date.parse(frame.capturedAt);
  if (Number.isNaN(capturedAt)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, now - capturedAt);
};

const evaluateMockHeuristics = (frame: CameraFrame): FrameQualityResult => {
  const normalizedUri = frame.uri.toLowerCase();

  if (normalizedUri.includes('blur')) {
    return {
      image_quality: 'blurry',
      frame_freshness_ms: 0,
      usable_for_local_cv: false,
      quality_factor: 0.5,
    };
  }

  if (normalizedUri.includes('dark') || normalizedUri.includes('lowlight')) {
    return {
      image_quality: 'dark',
      frame_freshness_ms: 0,
      usable_for_local_cv: false,
      quality_factor: 0.5,
    };
  }

  if (normalizedUri.includes('unclear')) {
    return defaultUnusableResult(0);
  }

  return {
    image_quality: 'usable',
    frame_freshness_ms: 0,
    usable_for_local_cv: true,
    quality_factor: 1,
  };
};

export const evaluateFrameQuality = (
  frame: CameraFrame | null,
  now: number
): FrameQualityResult => {
  const freshnessMs = getFrameFreshnessMs(frame, now);

  if (!frame) {
    return defaultUnusableResult(freshnessMs);
  }

  if (freshnessMs > FRAME_STALE_MS) {
    return defaultUnusableResult(freshnessMs);
  }

  if (medbudEnv.useMocks) {
    const result = evaluateMockHeuristics(frame);
    return {
      ...result,
      frame_freshness_ms: freshnessMs,
    };
  }

  // TODO: Replace this conservative placeholder with native/OpenCV blur/darkness checks.
  return {
    image_quality: 'usable',
    frame_freshness_ms: freshnessMs,
    usable_for_local_cv: true,
    quality_factor: 1,
  };
};
