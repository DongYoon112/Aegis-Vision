import { Camera } from 'expo-camera';

import type { CameraFrame } from '../protocol/types';

type CameraRefLike = {
  takePictureAsync: (options?: Record<string, unknown>) => Promise<{
    uri: string;
    width?: number;
    height?: number;
  }>;
};

const SAMPLE_INTERVAL_MS = 1500;

class CameraService {
  private cameraRef: CameraRefLike | null = null;
  private latestFrame: CameraFrame | null = null;
  private samplingInterval: ReturnType<typeof setInterval> | null = null;
  private captureInFlight = false;

  attachCameraRef(ref: CameraRefLike | null) {
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
      };
    } finally {
      this.captureInFlight = false;
    }
  }

  startSampling() {
    if (this.samplingInterval) {
      return;
    }

    void this.captureLatestFrame();
    this.samplingInterval = setInterval(() => {
      void this.captureLatestFrame();
    }, SAMPLE_INTERVAL_MS);
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

export const cameraService = new CameraService();
