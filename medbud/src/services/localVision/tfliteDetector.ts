import { clampConfidence, type CameraFrame } from '../../protocol/types';
import type {
  DetectorInitState,
  DetectorResult,
  DetectorStatus,
} from './detectorTypes';

const makeDetectorStatus = (
  backend: DetectorStatus['backend'],
  available: boolean,
  reason: string | null
): DetectorStatus => ({
  backend,
  available,
  reason,
});

const getSafeDetectorResult = (): DetectorResult => ({
  person_box_present: null,
  limb_visible: null,
  bleeding_region_candidate: null,
  detector_confidence: 0,
});

class TFLiteDetectorBackend {
  private initState: DetectorInitState = 'uninitialized';
  private availableCache: boolean | null = null;
  private status: DetectorStatus = makeDetectorStatus(
    'tflite',
    false,
    'TFLite runtime not initialized.'
  );

  async initialize() {
    if (this.initState === 'ready' || this.initState === 'failed') {
      return;
    }

    if (this.initState === 'initializing') {
      return;
    }

    this.initState = 'initializing';

    try {
      // TODO: Load the real TFLite runtime package here.
      // TODO: Resolve the detector model file path here.
      // TODO: Validate model metadata and input tensor shape here.
      this.availableCache = false;
      this.initState = 'failed';
      this.status = makeDetectorStatus(
        'tflite',
        false,
        'TFLite runtime or model is not installed yet.'
      );
    } catch (error) {
      this.availableCache = false;
      this.initState = 'failed';
      this.status = makeDetectorStatus(
        'tflite',
        false,
        error instanceof Error
          ? error.message
          : 'TFLite detector initialization failed.'
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) {
      return this.availableCache;
    }

    await this.initialize();
    return this.availableCache ?? false;
  }

  getStatus(): DetectorStatus {
    return { ...this.status };
  }

  async analyzeFrame(frame: CameraFrame): Promise<DetectorResult> {
    const isAvailable = await this.isAvailable();

    if (!isAvailable) {
      return getSafeDetectorResult();
    }

    try {
      // TODO: Resize and normalize the frame for the TFLite model here.
      // TODO: Run async TFLite inference here without blocking the UI thread.
      // TODO: Parse output tensors and map them into DetectorResult here.
      void frame;

      return {
        person_box_present: null,
        limb_visible: null,
        bleeding_region_candidate: null,
        detector_confidence: clampConfidence(0.1, 0),
      };
    } catch (error) {
      this.status = makeDetectorStatus(
        'tflite',
        false,
        error instanceof Error ? error.message : 'TFLite inference failed.'
      );
      this.initState = 'failed';
      this.availableCache = false;
      return getSafeDetectorResult();
    }
  }
}

export const tfliteDetector = new TFLiteDetectorBackend();
