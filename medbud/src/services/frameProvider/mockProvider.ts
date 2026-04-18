import type { CameraFrame } from '../../protocol/types';
import type { RecordedAudio } from '../../types/session';
import type { InputChannel, InputSource, InputSourceStatus } from './types';

const SAMPLE_INTERVAL_MS = 1500;

class MockInputSource implements InputSource {
  readonly kind = 'mock' as const;

  private videoActive = false;
  private audioActive = false;
  private latestFrame: CameraFrame | null = null;
  private latestAudio: RecordedAudio | null = null;
  private lastAudioAt: string | null = null;
  private samplingInterval: ReturnType<typeof setInterval> | null = null;

  isAvailable() {
    return true;
  }

  async requestPermissions(_channels: InputChannel[] = ['video', 'audio']) {
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

  async startVideoCapture() {
    if (this.samplingInterval) {
      return;
    }

    this.videoActive = true;
    this.latestFrame = this.createFrame();
    this.samplingInterval = setInterval(() => {
      this.latestFrame = this.createFrame();
    }, SAMPLE_INTERVAL_MS);
  }

  async stopVideoCapture() {
    this.videoActive = false;

    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
  }

  async startAudioCapture() {
    this.audioActive = true;
  }

  async stopAudioCapture() {
    if (!this.audioActive) {
      return this.latestAudio;
    }

    this.audioActive = false;
    this.latestAudio = {
      uri: 'mock://audio/latest',
      fileName: 'mock-audio.m4a',
      mimeType: 'audio/mp4',
    };
    this.lastAudioAt = new Date().toISOString();
    return this.latestAudio;
  }

  getLatestFrame() {
    return this.latestFrame;
  }

  getLatestAudio() {
    return this.latestAudio;
  }

  getStatus(): InputSourceStatus {
    return {
      kind: 'mock',
      statusLabel: 'Mock device active',
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
      lastFrameAt: this.latestFrame?.capturedAt ?? null,
      lastAudioAt: this.lastAudioAt,
    };
  }
}

export const mockInputSource = new MockInputSource();
