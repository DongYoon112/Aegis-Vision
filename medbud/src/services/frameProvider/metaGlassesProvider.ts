import type { CameraFrame } from '../../protocol/types';
import { glassesAudio } from '../glassesAudio';
import { metaWearablesBridge } from '../metaWearablesBridge';
import type {
  InputChannel,
  InputConnectionState,
  InputSource,
  InputSourceStatus,
} from './types';

const SAMPLE_INTERVAL_MS = 1500;

const timeout = (ms: number) =>
  new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), ms);
  });

class MetaWearablesSource implements InputSource {
  readonly kind = 'meta_glasses' as const;

  private videoAvailable = false;
  private audioAvailable = false;
  private videoActive = false;
  private latestFrame: CameraFrame | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private videoConnectionState: InputConnectionState = 'unavailable';
  private audioConnectionState: InputConnectionState = 'unavailable';
  private reason = 'Meta wearables bridge unavailable';

  async initialize() {
    await metaWearablesBridge.initialize();
    this.videoAvailable = await metaWearablesBridge.isAvailable();
    this.audioAvailable = await glassesAudio.isMicrophoneAvailable();
    const bridgeState = await metaWearablesBridge.getConnectionState();

    this.videoConnectionState = this.videoAvailable
      ? bridgeState
      : 'unavailable';
    this.audioConnectionState = this.audioAvailable
      ? this.videoConnectionState
      : 'unavailable';
    this.reason = this.videoAvailable
      ? 'Meta glasses available'
      : 'Meta wearables bridge unavailable';
  }

  isAvailable() {
    return this.videoAvailable || this.audioAvailable;
  }

  async requestPermissions(_channels: InputChannel[] = ['video', 'audio']) {
    return;
  }

  async connect() {
    if (!this.videoAvailable) {
      this.videoConnectionState = 'unavailable';
      this.audioConnectionState = this.audioAvailable ? 'disconnected' : 'unavailable';
      this.reason = 'Meta wearables bridge unavailable';
      throw new Error(this.reason);
    }

    this.videoConnectionState = 'connecting';
    this.audioConnectionState = this.audioAvailable ? 'connecting' : 'unavailable';

    const connected = await Promise.race([
      metaWearablesBridge.connectToGlasses(),
      timeout(2000),
    ]);

    this.videoAvailable = await metaWearablesBridge.isAvailable();
    this.audioAvailable = await glassesAudio.isMicrophoneAvailable();

    if (!connected) {
      this.videoConnectionState = 'failed';
      this.audioConnectionState = this.audioAvailable ? 'failed' : 'unavailable';
      this.reason = 'Meta glasses connection failed';
      throw new Error(this.reason);
    }

    const bridgeState = await metaWearablesBridge.getConnectionState();
    const normalizedState = bridgeState;

    if (normalizedState !== 'connected') {
      this.videoConnectionState = normalizedState;
      this.audioConnectionState = this.audioAvailable ? normalizedState : 'unavailable';
      this.reason = 'Meta glasses did not report a connected state';
      throw new Error(this.reason);
    }

    this.videoConnectionState = 'connected';
    this.audioConnectionState = this.audioAvailable ? 'connected' : 'unavailable';
    this.reason = this.audioAvailable
      ? 'Meta glasses connected'
      : 'Meta glasses connected for video only';
  }

  async disconnect() {
    await metaWearablesBridge.disconnectFromGlasses();
    this.videoConnectionState = this.videoAvailable ? 'disconnected' : 'unavailable';
    this.audioConnectionState = this.audioAvailable ? 'disconnected' : 'unavailable';
    this.videoActive = false;
    await this.stopVideoCapture();
    this.reason = 'Meta glasses disconnected';
  }

  private async pollLatestFrame() {
    const frame = await metaWearablesBridge.getLatestFrame();
    if (frame) {
      this.latestFrame = {
        ...frame,
        source: 'meta_glasses',
      };
    }

    const bridgeState = await metaWearablesBridge.getConnectionState();
    this.videoConnectionState = this.videoAvailable ? bridgeState : 'unavailable';
    if (this.videoConnectionState !== 'connected') {
      this.reason = 'Meta glasses unavailable';
    }
  }

  async startVideoCapture() {
    if (this.pollingInterval || this.videoConnectionState !== 'connected') {
      return;
    }

    this.videoActive = true;
    await metaWearablesBridge.startCameraSampling(SAMPLE_INTERVAL_MS);
    void this.pollLatestFrame();
    this.pollingInterval = setInterval(() => {
      void this.pollLatestFrame();
    }, SAMPLE_INTERVAL_MS);
  }

  async stopVideoCapture() {
    this.videoActive = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    await metaWearablesBridge.stopCameraSampling();
  }

  async startAudioCapture() {
    return;
  }

  async stopAudioCapture() {
    return null;
  }

  getLatestFrame() {
    return this.latestFrame;
  }

  getLatestAudio() {
    return null;
  }

  getStatus(): InputSourceStatus {
    return {
      kind: 'meta_glasses',
      statusLabel: this.reason,
      reason: this.reason,
      video: {
        available: this.videoAvailable,
        active: this.videoActive,
        connectionState: this.videoConnectionState,
        reason: this.videoAvailable
          ? this.reason
          : 'Meta wearables bridge unavailable',
      },
      audio: {
        available: this.audioAvailable,
        active: false,
        connectionState: this.audioConnectionState,
        reason: this.audioAvailable
          ? 'Meta glasses microphone available'
          : 'Meta glasses microphone unavailable',
      },
      lastFrameAt: this.latestFrame?.capturedAt ?? null,
      lastAudioAt: null,
    };
  }
}

export const metaWearablesSource = new MetaWearablesSource();
