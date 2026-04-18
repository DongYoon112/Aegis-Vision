import { clampConfidence, type CameraFrame, type VisionOutput } from '../../protocol/types';
import { analyzeObjectSignals } from './objectSignals';
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
    const objectSignals = await analyzeObjectSignals(frame, quality);

    const confidence = clampConfidence(
      0.7 * pose.pose_confidence + 0.3 * objectSignals.object_confidence,
      0
    );

    return {
      person_visible: pose.person_visible,
      body_position: pose.body_position,
      severe_bleeding_likely:
        objectSignals.bleeding_region_candidate === true &&
        objectSignals.object_confidence >= 0.7
          ? true
          : objectSignals.bleeding_region_candidate === false &&
              objectSignals.object_confidence >= 0.7
            ? false
            : null,
      limb_visible: objectSignals.limb_visible,
      image_quality: quality.image_quality,
      confidence,
    };
  } catch {
    return getStrictFallback();
  }
};
