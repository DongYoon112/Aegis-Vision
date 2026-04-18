import type { CameraFrame } from '../../protocol/types';
import type { RecordedAudio } from '../../types/session';
import { metaWearablesBridge, type MetaWearablesStatus } from '../metaWearablesBridge';
import type {
  InputChannel,
  InputConnectionState,
  InputSource,
  InputSourceStatus,
} from './types';

const SAMPLE_INTERVAL_MS = 1500;

class MetaWearablesSource implements InputSource {
  readonly kind = 'meta_glasses' as const;

  private latestFrame: CameraFrame | null = null;

  private latestAudio: RecordedAudio | null = null;

  private latestStatus: MetaWearablesStatus = {
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
    lastError: 'Meta native module is not installed in this build.',
    lastConnectionAttemptAt: null,
    lastFrameAt: null,
    lastAudioAt: null,
  };

  private videoActive = false;

  private audioActive = false;

  private subscriptions: Array<{ remove(): void }> = [];

  private syncFromStatus(status: MetaWearablesStatus) {
    this.latestStatus = status;
  }

  async initialize() {
    await metaWearablesBridge.initialize();
    this.syncFromStatus(await metaWearablesBridge.getStatus());

    if (this.subscriptions.length === 0) {
      this.subscriptions.push(
        metaWearablesBridge.addListener('statusChanged', (status) => {
          this.syncFromStatus(status);
        }),
        metaWearablesBridge.addListener('frameReceived', (frame) => {
          this.latestFrame = {
            ...frame,
            source: 'meta_glasses',
          };
        }),
        metaWearablesBridge.addListener('audioReceived', (audio) => {
          this.latestAudio = audio;
        }),
        metaWearablesBridge.addListener('error', (payload) => {
          this.latestStatus = {
            ...this.latestStatus,
            lastError: payload.message,
            connectionState: 'failed',
          };
        })
      );
    }
  }

  isAvailable() {
    return this.latestStatus.availability;
  }

  async requestPermissions(_channels: InputChannel[] = ['video', 'audio']) {
    return;
  }

  async connect() {
    const connected = await metaWearablesBridge.connectToGlasses();
    this.syncFromStatus(await metaWearablesBridge.getStatus());

    if (!connected || this.latestStatus.connectionState === 'device_not_authorized') {
      throw new Error(
        this.latestStatus.lastError ??
          (this.latestStatus.connectionState === 'device_not_authorized'
            ? 'Meta device authorization is still pending.'
            : 'Meta glasses connection failed.')
      );
    }
  }

  async disconnect() {
    await metaWearablesBridge.disconnectFromGlasses();
    this.videoActive = false;
    this.audioActive = false;
    this.syncFromStatus(await metaWearablesBridge.getStatus());
  }

  async startVideoCapture() {
    if (
      !this.latestStatus.capabilities.video ||
      (this.latestStatus.connectionState !== 'connected' &&
        this.latestStatus.connectionState !== 'streaming_video')
    ) {
      return;
    }

    this.videoActive = true;
    await metaWearablesBridge.startVideoCapture(SAMPLE_INTERVAL_MS);
    this.syncFromStatus(await metaWearablesBridge.getStatus());
    const frame = await metaWearablesBridge.getLatestFrame();
    if (frame) {
      this.latestFrame = {
        ...frame,
        source: 'meta_glasses',
      };
    }
  }

  async stopVideoCapture() {
    this.videoActive = false;
    await metaWearablesBridge.stopVideoCapture();
    this.syncFromStatus(await metaWearablesBridge.getStatus());
  }

  async startAudioCapture() {
    if (
      !this.latestStatus.capabilities.audio ||
      (this.latestStatus.connectionState !== 'connected' &&
        this.latestStatus.connectionState !== 'streaming_audio')
    ) {
      return;
    }

    this.audioActive = true;
    await metaWearablesBridge.startAudioCapture();
    this.syncFromStatus(await metaWearablesBridge.getStatus());
  }

  async stopAudioCapture() {
    this.audioActive = false;
    await metaWearablesBridge.stopAudioCapture();
    this.syncFromStatus(await metaWearablesBridge.getStatus());
    const audio = await metaWearablesBridge.getLatestAudio();
    if (audio) {
      this.latestAudio = audio;
    }
    return this.latestAudio;
  }

  getLatestFrame() {
    return this.latestFrame;
  }

  getLatestAudio() {
    return this.latestAudio;
  }

  private getChannelState(
    capabilityAvailable: boolean,
    isActive: boolean,
    streamingState: InputConnectionState
  ): InputConnectionState {
    if (!this.latestStatus.sdkPresent) {
      return 'sdk_missing';
    }

    if (!this.latestStatus.repoConfigured) {
      return 'repo_not_configured';
    }

    if (!this.latestStatus.applicationIdConfigured) {
      return 'app_id_missing';
    }

    if (!this.latestStatus.platformSupported || !capabilityAvailable) {
      return 'unavailable';
    }

    if (this.latestStatus.connectionState === 'developer_mode_required') {
      return 'developer_mode_required';
    }

    if (this.latestStatus.authorizationStatus === 'pending') {
      return 'device_not_authorized';
    }

    if (isActive && this.latestStatus.connectionState === streamingState) {
      return streamingState;
    }

    return this.latestStatus.connectionState;
  }

  getStatus(): InputSourceStatus {
    let statusLabel = 'Meta native SDK missing';
    if (this.latestStatus.sdkPresent) {
      if (this.latestStatus.connectionState === 'repo_not_configured') {
        statusLabel = 'Meta DAT GitHub Packages auth missing';
      } else if (this.latestStatus.connectionState === 'app_id_missing') {
        statusLabel = 'Meta DAT app ID missing';
      } else if (this.latestStatus.connectionState === 'developer_mode_required') {
        statusLabel = 'Meta Developer Mode required';
      } else if (this.latestStatus.connectionState === 'device_not_authorized') {
        statusLabel = 'Meta authorization required';
      } else if (
        this.latestStatus.connectionState === 'connected' ||
        this.latestStatus.connectionState === 'streaming_video' ||
        this.latestStatus.connectionState === 'streaming_audio'
      ) {
        statusLabel = 'Meta glasses connected';
      } else {
        statusLabel = 'Meta glasses available';
      }
    }

    return {
      kind: 'meta_glasses',
      statusLabel,
      reason: this.latestStatus.lastError ?? undefined,
      video: {
        available: this.latestStatus.capabilities.video && this.latestStatus.availability,
        active: this.videoActive,
        connectionState: this.getChannelState(
          this.latestStatus.capabilities.video,
          this.videoActive,
          'streaming_video'
        ),
        reason:
          this.latestStatus.authorizationStatus === 'pending'
            ? 'Meta device authorization is pending.'
            : this.latestStatus.capabilities.video
              ? this.latestStatus.lastError ?? undefined
              : 'Meta video capability is unavailable in this build.',
      },
      audio: {
        available: this.latestStatus.capabilities.audio && this.latestStatus.availability,
        active: this.audioActive,
        connectionState: this.getChannelState(
          this.latestStatus.capabilities.audio,
          this.audioActive,
          'streaming_audio'
        ),
        reason:
          this.latestStatus.authorizationStatus === 'pending'
            ? 'Meta device authorization is pending.'
            : this.latestStatus.capabilities.audio
              ? this.latestStatus.lastError ?? undefined
              : 'Meta audio capability is unavailable in this build.',
      },
      lastFrameAt: this.latestFrame?.capturedAt ?? this.latestStatus.lastFrameAt,
      lastAudioAt: this.latestStatus.lastAudioAt,
      sdkPresent: this.latestStatus.sdkPresent,
      repoConfigured: this.latestStatus.repoConfigured,
      applicationIdConfigured: this.latestStatus.applicationIdConfigured,
      platformSupported: this.latestStatus.platformSupported,
      authorizationStatus: this.latestStatus.authorizationStatus,
      capabilities: this.latestStatus.capabilities,
      nativeConnectionState: this.latestStatus.connectionState,
      runtimeOrigin: this.latestStatus.runtimeOrigin,
      lastNativeError: this.latestStatus.lastError,
      lastConnectionAttemptAt: this.latestStatus.lastConnectionAttemptAt,
      isRealHardware: this.latestStatus.runtimeOrigin === 'real_hardware',
      mockDeviceEnabled: this.latestStatus.mockDeviceEnabled,
    };
  }
}

export const metaWearablesSource = new MetaWearablesSource();
