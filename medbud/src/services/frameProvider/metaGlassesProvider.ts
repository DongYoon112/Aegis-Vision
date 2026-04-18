import type { CameraFrame } from '../../protocol/types';
import { metaWearablesBridge } from '../metaWearablesBridge';
import type { FrameProvider, FrameProviderConnectionState, FrameProviderStatus } from './types';

const SAMPLE_INTERVAL_MS = 1500;

const timeout = (ms: number) =>
  new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), ms);
  });

class MetaGlassesFrameProvider implements FrameProvider {
  private available = false;
  private active = false;
  private latestFrame: CameraFrame | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private connectionState: FrameProviderConnectionState = 'disconnected';
  private reason = 'Meta glasses unavailable';

  async initialize() {
    await metaWearablesBridge.initialize();
    this.available = await metaWearablesBridge.isAvailable();
    this.connectionState = await metaWearablesBridge.getConnectionState();
    this.reason = this.available ? 'Meta glasses available' : 'Meta glasses unavailable';
  }

  async requestPermissions() {
    return;
  }

  async connect() {
    this.connectionState = 'connecting';
    const connected = await Promise.race([
      metaWearablesBridge.connectToGlasses(),
      timeout(2000),
    ]);

    this.available = await metaWearablesBridge.isAvailable();
    this.connectionState = connected ? 'connected' : 'disconnected';
    this.reason = connected
      ? 'Meta glasses connected'
      : 'Meta glasses unavailable';
  }

  async disconnect() {
    await metaWearablesBridge.disconnectFromGlasses();
    this.connectionState = 'disconnected';
    this.active = false;
    this.stopSampling();
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
    this.connectionState = bridgeState;
    if (bridgeState !== 'connected') {
      this.reason = 'Meta glasses unavailable';
    }
  }

  startSampling() {
    if (this.pollingInterval || this.connectionState !== 'connected') {
      return;
    }

    this.active = true;
    void metaWearablesBridge.startCameraSampling(SAMPLE_INTERVAL_MS);
    void this.pollLatestFrame();
    this.pollingInterval = setInterval(() => {
      void this.pollLatestFrame();
    }, SAMPLE_INTERVAL_MS);
  }

  stopSampling() {
    this.active = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    void metaWearablesBridge.stopCameraSampling();
  }

  getLatestFrame() {
    return this.latestFrame;
  }

  getStatus(): FrameProviderStatus {
    return {
      kind: 'meta_glasses',
      available: this.available,
      active: this.active,
      connectionState: this.connectionState,
      lastFrameAt: this.latestFrame?.capturedAt ?? null,
      statusLabel:
        this.connectionState === 'connected'
          ? 'Meta glasses connected'
          : 'Meta glasses unavailable',
      reason: this.reason,
    };
  }
}

export const metaGlassesProvider = new MetaGlassesFrameProvider();
