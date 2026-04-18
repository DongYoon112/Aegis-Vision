import { clampConfidence, type CameraFrame } from '../../protocol/types';
import { detectorAdapter } from './detectorAdapter';
import type { FrameQualityResult, ObjectSignalResult } from './types';

const SAFE_OBJECT_RESULT: ObjectSignalResult = {
  limb_visible: null,
  bleeding_region_candidate: null,
  object_confidence: 0,
  person_box_present: null,
};

export const analyzeObjectSignals = async (
  frame: CameraFrame,
  quality: FrameQualityResult
): Promise<ObjectSignalResult> => {
  if (!quality.usable_for_local_cv) {
    return SAFE_OBJECT_RESULT;
  }

  try {
    const available = await detectorAdapter.isAvailable();
    if (!available) {
      return SAFE_OBJECT_RESULT;
    }

    const result = await detectorAdapter.analyzeFrame(frame);

    return {
      limb_visible: result.limb_visible,
      bleeding_region_candidate: result.bleeding_region_candidate,
      object_confidence: clampConfidence(result.detector_confidence, 0),
      person_box_present: result.person_box_present,
    };
  } catch {
    return SAFE_OBJECT_RESULT;
  }
};
