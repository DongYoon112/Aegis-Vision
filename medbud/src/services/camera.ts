import { Camera } from 'expo-camera';

import type { CameraFrame } from '../protocol/types';

export type ExpoCameraRefLike = {
  takePictureAsync: (options?: Record<string, unknown>) => Promise<{
    uri: string;
    width?: number;
    height?: number;
  }>;
};

export class ExpoCameraSampler {
  private cameraRef: ExpoCameraRefLike | null = null;
  private latestFrame: CameraFrame | null = null;
  private samplingInterval: ReturnType<typeof setInterval> | null = null;
  private captureInFlight = false;

  attachCameraRef(ref: ExpoCameraRefLike | null) {
    this.cameraRef = ref;
  }

  async requestPermissions() {
    const permission = await Camera.requestCameraPermissionsAsync();

    if (!permission.granted) {
      throw new Error(
        'Camera permission was denied. Aegis Vision needs camera access for sampled frame analysis.'
      );
    }
  }

  private async captureLatestFrame() {
    if (this.captureInFlight || !this.cameraRef) {
      return;
    }

    this.captureInFlight = true;

    try {
      const picture = await this.cameraRef.takePictureAsync({
        quality: 0.35,
        skipProcessing: true,
      });

      if (!picture?.uri) {
        return;
      }

      this.latestFrame = {
        uri: picture.uri,
        capturedAt: new Date().toISOString(),
        width: typeof picture.width === 'number' ? picture.width : null,
        height: typeof picture.height === 'number' ? picture.height : null,
        source: 'expo_camera',
      };
    } finally {
      this.captureInFlight = false;
    }
  }

  startSampling(intervalMs: number) {
    if (this.samplingInterval) {
      return;
    }

    void this.captureLatestFrame();
    this.samplingInterval = setInterval(() => {
      void this.captureLatestFrame();
    }, intervalMs);
  }

  stopSampling() {
    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
  }

  getLatestFrame() {
    return this.latestFrame;
  }
}

export const cameraService = new ExpoCameraSampler();
