import { requireNativeModule } from 'expo-modules-core';
import {
  NativeEventEmitter,
  NativeModules,
} from 'react-native';

import type { CameraFrame } from '../protocol/types';
import type { RecordedAudio } from '../types/session';
import type {
  InputConnectionState,
  MetaAuthorizationStatus,
  MetaCapabilities,
  MetaRuntimeOrigin,
} from './frameProvider/types';

export type MetaWearablesStatus = {
  sdkPresent: boolean;
  repoConfigured: boolean;
  applicationIdConfigured: boolean;
  platformSupported: boolean;
  availability: boolean;
  authorizationStatus: MetaAuthorizationStatus;
  connectionState: InputConnectionState;
  capabilities: MetaCapabilities;
  runtimeOrigin: MetaRuntimeOrigin;
  mockDeviceEnabled: boolean;
  lastError: string | null;
  lastConnectionAttemptAt: string | null;
  lastFrameAt: string | null;
  lastAudioAt: string | null;
};

export type MetaWearablesEventMap = {
  statusChanged: MetaWearablesStatus;
  frameReceived: CameraFrame;
  audioReceived: RecordedAudio;
  error: {
    message: string;
    code?: string;
  };
};

type BridgeSubscription = {
  remove(): void;
};

export interface MetaWearablesBridge {
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  connectToGlasses(): Promise<boolean>;
  disconnectFromGlasses(): Promise<void>;
  startVideoCapture(intervalMs: number): Promise<void>;
  stopVideoCapture(): Promise<void>;
  startAudioCapture(): Promise<void>;
  stopAudioCapture(): Promise<void>;
  getLatestFrame(): Promise<CameraFrame | null>;
  getLatestAudio(): Promise<RecordedAudio | null>;
  getConnectionState(): Promise<InputConnectionState>;
  getStatus(): Promise<MetaWearablesStatus>;
  addListener<K extends keyof MetaWearablesEventMap>(
    eventName: K,
    listener: (payload: MetaWearablesEventMap[K]) => void
  ): BridgeSubscription;
}

type NativeMetaWearablesModule = {
  initialize?: () => Promise<void>;
  isAvailable?: () => Promise<boolean>;
  connectToGlasses?: () => Promise<boolean>;
  disconnectFromGlasses?: () => Promise<void>;
  startVideoCapture?: (intervalMs: number) => Promise<void>;
  stopVideoCapture?: () => Promise<void>;
  startAudioCapture?: () => Promise<void>;
  stopAudioCapture?: () => Promise<void>;
  getLatestFrame?: () => Promise<CameraFrame | null>;
  getLatestAudio?: () => Promise<RecordedAudio | null>;
  getConnectionState?: () => Promise<InputConnectionState>;
  getStatus?: () => Promise<Partial<MetaWearablesStatus>>;
};

const nativeModule = (() => {
  try {
    return requireNativeModule<NativeMetaWearablesModule>('MetaWearablesBridge');
  } catch {
    return (NativeModules as {
      MetaWearablesBridge?: NativeMetaWearablesModule;
    }).MetaWearablesBridge;
  }
})();

const defaultStatus = (): MetaWearablesStatus => ({
  sdkPresent: false,
  repoConfigured: false,
  applicationIdConfigured: false,
  platformSupported: false,
  availability: false,
  authorizationStatus: 'unknown',
  connectionState: 'sdk_missing',
  capabilities: {
    video: false,
    audio: false,
    playback: false,
  },
  runtimeOrigin: 'stub',
  mockDeviceEnabled: false,
  lastError: nativeModule ? null : 'Meta native module is not installed in this build.',
  lastConnectionAttemptAt: null,
  lastFrameAt: null,
  lastAudioAt: null,
});

const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

class NativeBackedMetaWearablesBridge implements MetaWearablesBridge {
  private latestStatus: MetaWearablesStatus = defaultStatus();

  private latestFrame: CameraFrame | null = null;

  private latestAudio: RecordedAudio | null = null;

  private listenersAttached = false;

  private ensureEventListeners() {
    if (!eventEmitter || this.listenersAttached) {
      return;
    }

    eventEmitter.addListener('statusChanged', (payload: MetaWearablesStatus) => {
      this.latestStatus = this.mergeStatus(payload);
    });
    eventEmitter.addListener('frameReceived', (payload: CameraFrame) => {
      this.latestFrame = {
        ...payload,
        source: 'meta_glasses',
      };
      this.latestStatus = this.mergeStatus({
        lastFrameAt: payload.capturedAt,
      });
    });
    eventEmitter.addListener('audioReceived', (payload: RecordedAudio) => {
      this.latestAudio = payload;
      this.latestStatus = this.mergeStatus({
        lastAudioAt: new Date().toISOString(),
      });
    });
    eventEmitter.addListener('error', (payload: { message: string }) => {
      this.latestStatus = this.mergeStatus({
        lastError: payload.message,
        connectionState: 'failed',
      });
    });

    this.listenersAttached = true;
  }

  private mergeStatus(
    patch: Partial<MetaWearablesStatus>
  ): MetaWearablesStatus {
    return {
      ...this.latestStatus,
      ...patch,
      capabilities: {
        ...this.latestStatus.capabilities,
        ...(patch.capabilities ?? {}),
      },
    };
  }

  async initialize() {
    this.ensureEventListeners();
    await nativeModule?.initialize?.();
    this.latestStatus = await this.getStatus();
  }

  async isAvailable() {
    if (!nativeModule?.isAvailable) {
      this.latestStatus = defaultStatus();
      return false;
    }

    try {
      const availability = await nativeModule.isAvailable();
      this.latestStatus = this.mergeStatus({
        sdkPresent: true,
        repoConfigured: this.latestStatus.repoConfigured,
        applicationIdConfigured: this.latestStatus.applicationIdConfigured,
        platformSupported: true,
        availability,
        connectionState: availability ? this.latestStatus.connectionState : 'unavailable',
        runtimeOrigin: 'real_hardware',
      });
      return availability;
    } catch (error) {
      this.latestStatus = this.mergeStatus({
        sdkPresent: true,
        repoConfigured: this.latestStatus.repoConfigured,
        applicationIdConfigured: this.latestStatus.applicationIdConfigured,
        platformSupported: true,
        availability: false,
        connectionState: 'failed',
        lastError: error instanceof Error ? error.message : 'Meta availability check failed.',
      });
      return false;
    }
  }

  async connectToGlasses() {
    if (!nativeModule?.connectToGlasses) {
      this.latestStatus = defaultStatus();
      return false;
    }

    try {
      const connected = await nativeModule.connectToGlasses();
      this.latestStatus = this.mergeStatus({
        sdkPresent: true,
        repoConfigured: this.latestStatus.repoConfigured,
        applicationIdConfigured: this.latestStatus.applicationIdConfigured,
        platformSupported: true,
        availability: connected,
        connectionState: connected ? 'connected' : 'failed',
        runtimeOrigin: connected ? 'real_hardware' : this.latestStatus.runtimeOrigin,
        lastConnectionAttemptAt: new Date().toISOString(),
        lastError: connected ? null : 'Meta glasses connection failed.',
      });
      return connected;
    } catch (error) {
      this.latestStatus = this.mergeStatus({
        sdkPresent: true,
        repoConfigured: this.latestStatus.repoConfigured,
        applicationIdConfigured: this.latestStatus.applicationIdConfigured,
        platformSupported: true,
        availability: false,
        connectionState: 'failed',
        lastConnectionAttemptAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : 'Meta glasses connection failed.',
      });
      return false;
    }
  }

  async disconnectFromGlasses() {
    await nativeModule?.disconnectFromGlasses?.();
    this.latestStatus = this.mergeStatus({
      connectionState: nativeModule ? 'disconnected' : 'sdk_missing',
    });
  }

  async startVideoCapture(intervalMs: number) {
    await nativeModule?.startVideoCapture?.(intervalMs);
    this.latestStatus = this.mergeStatus({
      connectionState:
        this.latestStatus.connectionState === 'connected'
          ? 'streaming_video'
          : this.latestStatus.connectionState,
    });
  }

  async stopVideoCapture() {
    await nativeModule?.stopVideoCapture?.();
    this.latestStatus = this.mergeStatus({
      connectionState:
        this.latestStatus.connectionState === 'streaming_video'
          ? 'connected'
          : this.latestStatus.connectionState,
    });
  }

  async startAudioCapture() {
    await nativeModule?.startAudioCapture?.();
    this.latestStatus = this.mergeStatus({
      connectionState:
        this.latestStatus.connectionState === 'connected'
          ? 'streaming_audio'
          : this.latestStatus.connectionState,
    });
  }

  async stopAudioCapture() {
    await nativeModule?.stopAudioCapture?.();
    this.latestStatus = this.mergeStatus({
      connectionState:
        this.latestStatus.connectionState === 'streaming_audio'
          ? 'connected'
          : this.latestStatus.connectionState,
    });
  }

  async getLatestFrame() {
    if (!nativeModule?.getLatestFrame) {
      return this.latestFrame;
    }

    try {
      const frame = await nativeModule.getLatestFrame();
      if (frame) {
        this.latestFrame = {
          ...frame,
          source: 'meta_glasses',
        };
      }
      return this.latestFrame;
    } catch {
      return this.latestFrame;
    }
  }

  async getLatestAudio() {
    if (!nativeModule?.getLatestAudio) {
      return this.latestAudio;
    }

    try {
      const audio = await nativeModule.getLatestAudio();
      if (audio) {
        this.latestAudio = audio;
      }
      return this.latestAudio;
    } catch {
      return this.latestAudio;
    }
  }

  async getConnectionState() {
    if (!nativeModule?.getConnectionState) {
      return this.latestStatus.connectionState;
    }

    try {
      const connectionState = await nativeModule.getConnectionState();
      this.latestStatus = this.mergeStatus({ connectionState });
      return connectionState;
    } catch {
      return 'failed';
    }
  }

  async getStatus() {
    if (!nativeModule?.getStatus) {
      this.latestStatus = defaultStatus();
      return this.latestStatus;
    }

    try {
      const status = await nativeModule.getStatus();
      this.latestStatus = this.mergeStatus({
        ...status,
        sdkPresent: status.sdkPresent ?? true,
        platformSupported: status.platformSupported ?? true,
      });
      return this.latestStatus;
    } catch (error) {
      this.latestStatus = this.mergeStatus({
        sdkPresent: true,
        platformSupported: true,
        connectionState: 'failed',
        lastError: error instanceof Error ? error.message : 'Meta status query failed.',
      });
      return this.latestStatus;
    }
  }

  addListener<K extends keyof MetaWearablesEventMap>(
    eventName: K,
    listener: (payload: MetaWearablesEventMap[K]) => void
  ) {
    this.ensureEventListeners();

    if (!eventEmitter) {
      return {
        remove() {
          return;
        },
      } as BridgeSubscription;
    }

    return eventEmitter.addListener(eventName, listener);
  }
}

export const metaWearablesBridge: MetaWearablesBridge =
  new NativeBackedMetaWearablesBridge();
