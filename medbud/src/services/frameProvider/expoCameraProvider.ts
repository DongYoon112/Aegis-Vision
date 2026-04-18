import { cameraService, type ExpoCameraRefLike } from '../camera';
import type { FrameProvider, FrameProviderStatus } from './types';

const SAMPLE_INTERVAL_MS = 1500;

class ExpoCameraFrameProvider implements FrameProvider {
  private active = false;

  attachCameraRef(ref: ExpoCameraRefLike | null) {
    cameraService.attachCameraRef(ref);
  }

  async requestPermissions() {
    await cameraService.requestPermissions();
  }

  startSampling() {
    this.active = true;
    cameraService.startSampling(SAMPLE_INTERVAL_MS);
  }

  stopSampling() {
    this.active = false;
    cameraService.stopSampling();
  }

  getLatestFrame() {
    return cameraService.getLatestFrame();
  }

  getStatus(): FrameProviderStatus {
    const latestFrame = this.getLatestFrame();

    return {
      kind: 'expo_camera',
      available: true,
      active: this.active,
      connectionState: 'connected',
      lastFrameAt: latestFrame?.capturedAt ?? null,
      statusLabel: 'Using phone camera fallback',
    };
  }
}

export const expoCameraProvider = new ExpoCameraFrameProvider();
