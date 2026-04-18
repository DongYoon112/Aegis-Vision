import type { NullableBoolean, VisibleLimb } from '../../protocol/types';

export type DetectorResult = {
  person_box_present: NullableBoolean;
  limb_visible: VisibleLimb;
  bleeding_region_candidate: NullableBoolean;
  detector_confidence: number;
};

export type DetectorBackend = 'stub' | 'tflite' | 'onnx' | 'native';

export type DetectorStatus = {
  available: boolean;
  backend: DetectorBackend;
  reason: string | null;
};

export type DetectorInitState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'failed';
