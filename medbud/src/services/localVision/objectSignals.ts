import { clampConfidence, type CameraFrame } from '../../protocol/types';
import { medbudEnv } from '../../utils/env';
import type { FrameQualityResult, ObjectSignalResult } from './types';

const SAFE_OBJECT_RESULT: ObjectSignalResult = {
  limb_visible: null,
  bleeding_region_candidate: null,
  object_confidence: 0,
};

const getMockLimbHint = (uri: string) => {
  const normalizedUri = uri.toLowerCase();

  if (normalizedUri.includes('left_leg')) {
    return 'left_leg' as const;
  }

  if (normalizedUri.includes('right_leg')) {
    return 'right_leg' as const;
  }

  if (normalizedUri.includes('left_arm')) {
    return 'left_arm' as const;
  }

  if (normalizedUri.includes('right_arm')) {
    return 'right_arm' as const;
  }

  return null;
};

const getMockBleedingHint = (uri: string) => {
  const normalizedUri = uri.toLowerCase();

  if (normalizedUri.includes('noblood')) {
    return false;
  }

  if (normalizedUri.includes('blood') || normalizedUri.includes('bleed')) {
    return true;
  }

  return null;
};

export const analyzeObjectSignals = async (
  frame: CameraFrame,
  quality: FrameQualityResult
): Promise<ObjectSignalResult> => {
  if (!quality.usable_for_local_cv) {
    return SAFE_OBJECT_RESULT;
  }

  if (!medbudEnv.useMocks) {
    // TODO: Replace this conservative stub with a YOLO/TFLite/ONNX detector adapter.
    return {
      limb_visible: null,
      bleeding_region_candidate: null,
      object_confidence: clampConfidence(0.2, 0),
    };
  }

  const limbVisible = getMockLimbHint(frame.uri);
  const bleedingRegionCandidate = getMockBleedingHint(frame.uri);

  if (limbVisible !== null || bleedingRegionCandidate !== null) {
    return {
      limb_visible: limbVisible,
      bleeding_region_candidate: bleedingRegionCandidate,
      object_confidence: clampConfidence(0.8, 0),
    };
  }

  return {
    ...SAFE_OBJECT_RESULT,
    object_confidence: clampConfidence(0.2, 0),
  };
};
