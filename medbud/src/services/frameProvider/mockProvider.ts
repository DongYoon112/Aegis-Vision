import type { CameraFrame } from '../../protocol/types';
import type { FrameProvider, FrameProviderStatus } from './types';

const SAMPLE_INTERVAL_MS = 1500;

class MockFrameProvider implements FrameProvider {
  private active = false;
  private latestFrame: CameraFrame | null = null;
  private samplingInterval: ReturnType<typeof setInterval> | null = null;

  async requestPermissions() {
    return;
  }

  private createFrame(): CameraFrame {
    return {
      uri: 'mock://frame/latest',
      capturedAt: new Date().toISOString(),
      width: 1280,
      height: 720,
      source: 'mock',
    };
  }

  startSampling() {
    if (this.samplingInterval) {
      return;
    }

    this.active = true;
    this.latestFrame = this.createFrame();
    this.samplingInterval = setInterval(() => {
      this.latestFrame = this.createFrame();
    }, SAMPLE_INTERVAL_MS);
  }

  stopSampling() {
    this.active = false;

    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
  }

  getLatestFrame() {
    return this.latestFrame;
  }

  getStatus(): FrameProviderStatus {
    return {
      kind: 'mock',
      available: true,
      active: this.active,
      connectionState: 'connected',
      lastFrameAt: this.latestFrame?.capturedAt ?? null,
      statusLabel: 'Mock device active',
    };
  }
}

export const mockFrameProvider = new MockFrameProvider();
