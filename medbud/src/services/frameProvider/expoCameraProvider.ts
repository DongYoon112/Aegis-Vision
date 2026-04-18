import { cameraService, type ExpoCameraRefLike } from '../camera';
import { recorder } from '../recorder';
import type { RecordedAudio } from '../../types/session';
import type { InputChannel, InputSource, InputSourceStatus } from './types';

const SAMPLE_INTERVAL_MS = 1500;

class PhoneFallbackSource implements InputSource {
  readonly kind = 'phone' as const;

  private videoActive = false;
  private audioActive = false;
  private latestAudio: RecordedAudio | null = null;
  private lastAudioAt: string | null = null;

  attachCameraRef(ref: ExpoCameraRefLike | null) {
    cameraService.attachCameraRef(ref);
  }

  isAvailable() {
    return true;
  }

  async requestPermissions(channels: InputChannel[] = ['video', 'audio']) {
    if (channels.includes('video')) {
      await cameraService.requestPermissions();
    }

    if (channels.includes('audio')) {
      await recorder.requestPermission();
    }
  }

  async startVideoCapture() {
    this.videoActive = true;
    cameraService.startSampling(SAMPLE_INTERVAL_MS);
  }

  async stopVideoCapture() {
    this.videoActive = false;
    cameraService.stopSampling();
  }

  async startAudioCapture() {
    this.audioActive = true;
    await recorder.startRecording();
  }

  async stopAudioCapture() {
    if (!this.audioActive) {
      return this.latestAudio;
    }

    this.audioActive = false;
    this.latestAudio = await recorder.stopRecording();
    this.lastAudioAt = new Date().toISOString();
    return this.latestAudio;
  }

  getLatestFrame() {
    return cameraService.getLatestFrame();
  }

  getLatestAudio() {
    return this.latestAudio;
  }

  getStatus(): InputSourceStatus {
    const latestFrame = this.getLatestFrame();

    return {
      kind: 'phone',
      statusLabel: 'Phone fallback ready',
      video: {
        available: true,
        active: this.videoActive,
        connectionState: 'connected',
      },
      audio: {
        available: true,
        active: this.audioActive,
        connectionState: 'connected',
      },
      lastFrameAt: latestFrame?.capturedAt ?? null,
      lastAudioAt: this.lastAudioAt,
    };
  }
}

export const phoneFallbackSource = new PhoneFallbackSource();
