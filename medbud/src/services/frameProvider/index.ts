import { medbudEnv } from '../../utils/env';
import type { ExpoCameraRefLike } from '../camera';
import { phoneFallbackSource } from './expoCameraProvider';
import { metaWearablesSource } from './metaGlassesProvider';
import { mockInputSource } from './mockProvider';
import type { InputSource, SourceManagerStatus } from './types';

class SourceManager {
  private activeVideoSource: InputSource = phoneFallbackSource;
  private activeAudioSource: InputSource = phoneFallbackSource;
  private initialized = false;
  private lastConnectionError: string | null = null;
  private fallbackReason: string | null = null;
  private lastConnectionAttemptAt: string | null = null;
  private lastAttemptedSource: InputSource['kind'] | null = null;
  private connectionAttempts = 0;

  private setFallbackReason(reason: string | null) {
    this.fallbackReason = reason;
  }

  private resolveLiveSelection() {
    const metaStatus = metaWearablesSource.getStatus();
    const metaVideoConnected =
      metaStatus.video.connectionState === 'connected' ||
      metaStatus.video.connectionState === 'streaming_video';
    const metaAudioConnected =
      metaStatus.audio.connectionState === 'connected' ||
      metaStatus.audio.connectionState === 'streaming_audio';

    this.activeVideoSource =
      metaStatus.video.available && metaVideoConnected
        ? metaWearablesSource
        : phoneFallbackSource;
    this.activeAudioSource =
      metaStatus.audio.available && metaAudioConnected
        ? metaWearablesSource
        : phoneFallbackSource;

    if (this.activeVideoSource.kind === 'phone' && this.activeAudioSource.kind === 'phone') {
      this.setFallbackReason(
        metaStatus.sdkPresent === false
          ? 'Meta native module is missing from this Android build'
          : metaStatus.repoConfigured === false
            ? 'Meta DAT GitHub Packages credentials are not configured'
            : metaStatus.applicationIdConfigured === false
              ? 'Meta DAT application ID is not configured'
              : metaStatus.nativeConnectionState === 'developer_mode_required'
                ? 'Enable Developer Mode and complete DAT registration in the Meta AI app'
                : metaStatus.reason ?? 'Meta glasses unavailable'
      );
      return;
    }

    if (this.activeVideoSource.kind === 'meta_glasses' && this.activeAudioSource.kind === 'phone') {
      this.setFallbackReason(
        metaStatus.audio.available
          ? 'Meta glasses audio is not connected'
          : 'Phone audio fallback active because Meta audio is unavailable'
      );
      return;
    }

    this.setFallbackReason(null);
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (medbudEnv.useMocks) {
      this.activeVideoSource = mockInputSource;
      this.activeAudioSource = mockInputSource;
      this.initialized = true;
      return;
    }

    await metaWearablesSource.initialize();

    try {
      await this.connectGlasses();
    } catch {
      this.resolveLiveSelection();
    }

    await this.resolveActiveSources();
    this.initialized = true;
  }

  async resolveActiveSources() {
    if (medbudEnv.useMocks) {
      this.activeVideoSource = mockInputSource;
      this.activeAudioSource = mockInputSource;
      return {
        videoSource: this.activeVideoSource,
        audioSource: this.activeAudioSource,
      };
    }

    this.resolveLiveSelection();

    return {
      videoSource: this.activeVideoSource,
      audioSource: this.activeAudioSource,
    };
  }

  getActiveSources() {
    return {
      videoSource: this.activeVideoSource,
      audioSource: this.activeAudioSource,
    };
  }

  async connectGlasses() {
    if (medbudEnv.useMocks) {
      return;
    }

    this.lastAttemptedSource = 'meta_glasses';
    this.lastConnectionAttemptAt = new Date().toISOString();
    this.connectionAttempts += 1;
    this.lastConnectionError = null;

    try {
      await metaWearablesSource.connect?.();
    } catch (error) {
      this.lastConnectionError =
        error instanceof Error ? error.message : 'Meta glasses connection failed';
      this.resolveLiveSelection();
      throw error;
    }

    this.resolveLiveSelection();
  }

  async disconnectGlasses() {
    if (medbudEnv.useMocks) {
      return;
    }

    this.lastAttemptedSource = 'meta_glasses';
    this.lastConnectionAttemptAt = new Date().toISOString();

    await metaWearablesSource.disconnect?.();
    this.resolveLiveSelection();
  }

  attachExpoCameraRef(ref: ExpoCameraRefLike | null) {
    phoneFallbackSource.attachCameraRef(ref);
  }

  getStatus(): SourceManagerStatus {
    const metaStatus = metaWearablesSource.getStatus();
    const phoneStatus = phoneFallbackSource.getStatus();
    const mockStatus = medbudEnv.useMocks ? mockInputSource.getStatus() : undefined;

    if (medbudEnv.useMocks) {
      return {
        activeVideoSource: 'mock',
        activeAudioSource: 'mock',
        selectedMode: 'mock',
        mixedModeActive: false,
        fallbackActive: false,
        fallbackReason: null,
        lastConnectionError: this.lastConnectionError,
        lastConnectionAttemptAt: this.lastConnectionAttemptAt,
        lastAttemptedSource: this.lastAttemptedSource,
        connectionAttempts: this.connectionAttempts,
        availability: {
          meta: {
            video: false,
            audio: false,
          },
          phone: {
            video: false,
            audio: false,
          },
        },
        sources: {
          meta: metaStatus,
          phone: phoneStatus,
          mock: mockStatus,
        },
        hardwareValidation: {
          metaActiveForVideo: false,
          metaActiveForAudio: false,
          latestFrameOrigin: null,
          latestAudioOrigin: null,
        },
        statusLabel: 'Mock source active',
      };
    }

    const activeVideoSource = this.activeVideoSource.kind;
    const activeAudioSource = this.activeAudioSource.kind;
    const mixedModeActive = activeVideoSource !== activeAudioSource;
    const selectedMode =
      activeVideoSource === 'meta_glasses' && activeAudioSource === 'meta_glasses'
        ? 'meta_full'
        : activeVideoSource === 'meta_glasses' && activeAudioSource === 'phone'
          ? 'meta_video_phone_audio'
          : 'phone_only';
    const fallbackActive =
      activeVideoSource === 'phone' ||
      activeAudioSource === 'phone';
    const statusLabel =
      selectedMode === 'meta_full'
        ? 'Using Meta glasses for supported live capture'
        : selectedMode === 'meta_video_phone_audio'
        ? 'Using Meta glasses video with phone audio fallback'
        : 'Using phone fallback for live capture';

    return {
      activeVideoSource,
      activeAudioSource,
      selectedMode,
      mixedModeActive,
      fallbackActive,
      fallbackReason: this.fallbackReason,
      lastConnectionError: this.lastConnectionError,
      lastConnectionAttemptAt: this.lastConnectionAttemptAt,
      lastAttemptedSource: this.lastAttemptedSource,
      connectionAttempts: this.connectionAttempts,
      availability: {
        meta: {
          video: metaStatus.video.available,
          audio: metaStatus.audio.available,
        },
        phone: {
          video: phoneStatus.video.available,
          audio: phoneStatus.audio.available,
        },
      },
      sources: {
        meta: metaStatus,
        phone: phoneStatus,
      },
      hardwareValidation: {
        metaActiveForVideo: activeVideoSource === 'meta_glasses',
        metaActiveForAudio: activeAudioSource === 'meta_glasses',
        latestFrameOrigin:
          activeVideoSource === 'meta_glasses' ? 'meta_glasses' : 'phone',
        latestAudioOrigin: activeAudioSource,
      },
      statusLabel,
      reason: this.lastConnectionError ?? this.fallbackReason ?? metaStatus.reason,
    };
  }
}

export const providerManager = new SourceManager();
