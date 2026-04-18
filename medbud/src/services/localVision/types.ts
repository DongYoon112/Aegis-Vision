import type { BodyPosition, CameraFrame, ImageQuality, NullableBoolean } from '../../protocol/types';

export type FrameQualityResult = {
  image_quality: ImageQuality;
  frame_freshness_ms: number;
  usable_for_local_cv: boolean;
  quality_factor: number;
};

export type PoseStatus = 'not_run' | 'uncertain' | 'detected';

export type PoseSignalResult = {
  person_visible: NullableBoolean;
  body_position: BodyPosition;
  pose_confidence: number;
  pose_status: PoseStatus;
};

export type LocalVisionAnalyzer = (
  frame: CameraFrame | null,
  now: number
) => Promise<import('../../protocol/types').VisionOutput>;
