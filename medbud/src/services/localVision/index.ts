import { clampConfidence, type CameraFrame, type VisionOutput } from '../../protocol/types';
import { analyzePoseSignals } from './poseSignals';
import { evaluateFrameQuality } from './frameQuality';

const STRICT_FALLBACK: VisionOutput = {
  person_visible: null,
  body_position: null,
  severe_bleeding_likely: null,
  limb_visible: null,
  image_quality: 'unclear',
  confidence: 0,
};

const getStrictFallback = (): VisionOutput => ({
  ...STRICT_FALLBACK,
});

export const analyzeLocalVision = async (
  frame: CameraFrame | null,
  now: number
): Promise<VisionOutput> => {
  try {
    const quality = evaluateFrameQuality(frame, now);

    if (!frame || !quality.usable_for_local_cv) {
      return getStrictFallback();
    }

    const pose = await analyzePoseSignals(frame, quality);

    if (pose.pose_status === 'not_run') {
      return getStrictFallback();
    }

    const confidence = clampConfidence(
      pose.pose_confidence * quality.quality_factor,
      0
    );

    return {
      person_visible: pose.person_visible,
      body_position: pose.body_position,
      severe_bleeding_likely: null,
      limb_visible: null,
      image_quality: quality.image_quality,
      confidence,
    };
  } catch {
    return getStrictFallback();
  }
};
