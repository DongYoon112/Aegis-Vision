import { clampConfidence, type CameraFrame } from '../../protocol/types';
import { medbudEnv } from '../../utils/env';
import type { FrameQualityResult, PoseSignalResult } from './types';

const NOT_RUN_RESULT: PoseSignalResult = {
  person_visible: null,
  body_position: null,
  pose_confidence: 0,
  pose_status: 'not_run',
};

const UNCERTAIN_RESULT: PoseSignalResult = {
  person_visible: true,
  body_position: 'unknown',
  pose_confidence: 0.35,
  pose_status: 'uncertain',
};

export const analyzePoseSignals = async (
  frame: CameraFrame,
  quality: FrameQualityResult
): Promise<PoseSignalResult> => {
  if (!quality.usable_for_local_cv) {
    return NOT_RUN_RESULT;
  }

  if (!medbudEnv.useMocks) {
    // TODO: Replace this deterministic stub with a MediaPipe/native pose adapter.
    return {
      ...UNCERTAIN_RESULT,
      pose_confidence: clampConfidence(UNCERTAIN_RESULT.pose_confidence, 0),
    };
  }

  const normalizedUri = frame.uri.toLowerCase();

  if (normalizedUri.includes('noperson') || normalizedUri.includes('empty')) {
    return {
      person_visible: null,
      body_position: null,
      pose_confidence: 0,
      pose_status: 'not_run',
    };
  }

  if (normalizedUri.includes('supine')) {
    return {
      person_visible: true,
      body_position: 'supine',
      pose_confidence: clampConfidence(0.72, 0),
      pose_status: 'detected',
    };
  }

  if (normalizedUri.includes('upright') || normalizedUri.includes('standing')) {
    return {
      person_visible: true,
      body_position: 'upright',
      pose_confidence: clampConfidence(0.72, 0),
      pose_status: 'detected',
    };
  }

  return {
    ...UNCERTAIN_RESULT,
    pose_confidence: clampConfidence(UNCERTAIN_RESULT.pose_confidence, 0),
  };
};
