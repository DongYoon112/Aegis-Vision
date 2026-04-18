import { clampConfidence, type CameraFrame } from '../../protocol/types';
import { medbudEnv } from '../../utils/env';
import type {
  DetectorBackend,
  DetectorInitState,
  DetectorResult,
  DetectorStatus,
} from './detectorTypes';
import { tfliteDetector } from './tfliteDetector';

export interface DetectorAdapter {
  isAvailable(): Promise<boolean>;
  analyzeFrame(frame: CameraFrame): Promise<DetectorResult>;
  getStatus(): DetectorStatus;
}

const getSafeDetectorResult = (): DetectorResult => ({
  person_box_present: null,
  limb_visible: null,
  bleeding_region_candidate: null,
  detector_confidence: 0,
});

const makeDetectorStatus = (
  backend: DetectorBackend,
  available: boolean,
  reason: string | null
): DetectorStatus => ({
  backend,
  available,
  reason,
});

class StubDetectorBackend {
  getStatus(): DetectorStatus {
    return makeDetectorStatus('stub', true, null);
  }

  private getMockLimbHint(uri: string) {
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
  }

  private getMockBleedingHint(uri: string) {
    const normalizedUri = uri.toLowerCase();

    if (normalizedUri.includes('noblood')) {
      return false;
    }

    if (normalizedUri.includes('blood') || normalizedUri.includes('bleed')) {
      return true;
    }

    return null;
  }

  async analyzeFrame(frame: CameraFrame): Promise<DetectorResult> {
    if (medbudEnv.useMocks) {
      const limbVisible = this.getMockLimbHint(frame.uri);
      const bleedingRegionCandidate = this.getMockBleedingHint(frame.uri);
      const hasPersonBox =
        limbVisible !== null || bleedingRegionCandidate !== null ? true : null;

      if (
        limbVisible !== null ||
        bleedingRegionCandidate !== null ||
        hasPersonBox === true
      ) {
        return {
          person_box_present: true,
          limb_visible: limbVisible,
          bleeding_region_candidate: bleedingRegionCandidate,
          detector_confidence: clampConfidence(0.8, 0),
        };
      }
    }

    return {
      person_box_present: null,
      limb_visible: null,
      bleeding_region_candidate: null,
      detector_confidence: clampConfidence(0.1, 0),
    };
  }
}

class ManagedDetectorAdapter implements DetectorAdapter {
  private initState: DetectorInitState = 'uninitialized';
  private activeBackend: DetectorBackend = 'stub';
  private availabilityCache: boolean | null = null;
  private status: DetectorStatus = makeDetectorStatus(
    'stub',
    true,
    null
  );
  private readonly stubBackend = new StubDetectorBackend();

  private async initializeBackend() {
    if (this.initState === 'ready' || this.initState === 'failed') {
      return;
    }

    if (this.initState === 'initializing') {
      return;
    }

    this.initState = 'initializing';

    const tfliteAvailable = await tfliteDetector.isAvailable();

    if (tfliteAvailable) {
      this.activeBackend = 'tflite';
      this.availabilityCache = true;
      this.status = tfliteDetector.getStatus();
      this.initState = 'ready';
      return;
    }

    this.activeBackend = 'stub';
    this.availabilityCache = true;
    this.status = makeDetectorStatus(
      'stub',
      true,
      tfliteDetector.getStatus().reason
    );
    this.initState = 'ready';
  }

  async isAvailable(): Promise<boolean> {
    if (this.availabilityCache !== null) {
      return this.availabilityCache;
    }

    await this.initializeBackend();
    return this.availabilityCache ?? false;
  }

  getStatus(): DetectorStatus {
    return { ...this.status };
  }

  async analyzeFrame(frame: CameraFrame): Promise<DetectorResult> {
    try {
      await this.isAvailable();

      if (this.activeBackend === 'tflite') {
        const result = await tfliteDetector.analyzeFrame(frame);
        this.status = tfliteDetector.getStatus();
        return result;
      }

      this.status = this.stubBackend.getStatus();
      return this.stubBackend.analyzeFrame(frame);
    } catch (error) {
      this.status = makeDetectorStatus(
        this.activeBackend,
        false,
        error instanceof Error ? error.message : 'Detector backend failed.'
      );
      this.initState = 'failed';
      return getSafeDetectorResult();
    }
  }
}

export const detectorAdapter: DetectorAdapter = new ManagedDetectorAdapter();
