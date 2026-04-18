import type { CameraFrame } from '../../protocol/types';
import type { RecordedAudio } from '../../types/session';

export type InputSourceKind = 'meta_glasses' | 'phone' | 'mock';
export type InputChannel = 'video' | 'audio';

export type InputConnectionState =
  | 'unavailable'
  | 'sdk_missing'
  | 'repo_not_configured'
  | 'app_id_missing'
  | 'developer_mode_required'
  | 'device_not_authorized'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming_video'
  | 'streaming_audio'
  | 'partial_capability'
  | 'fallback_active'
  | 'failed';

export type MetaAuthorizationStatus =
  | 'unknown'
  | 'not_required'
  | 'pending'
  | 'authorized'
  | 'denied';

export type MetaRuntimeOrigin = 'real_hardware' | 'mock_device' | 'stub' | 'none';

export type MetaCapabilities = {
  video: boolean;
  audio: boolean;
  playback: boolean;
};

export type InputChannelStatus = {
  available: boolean;
  active: boolean;
  connectionState: InputConnectionState;
  reason?: string;
};

export type InputSourceStatus = {
  kind: InputSourceKind;
  statusLabel: string;
  reason?: string;
  video: InputChannelStatus;
  audio: InputChannelStatus;
  lastFrameAt: string | null;
  lastAudioAt: string | null;
  sdkPresent?: boolean;
  repoConfigured?: boolean;
  applicationIdConfigured?: boolean;
  platformSupported?: boolean;
  authorizationStatus?: MetaAuthorizationStatus;
  capabilities?: MetaCapabilities;
  nativeConnectionState?: InputConnectionState;
  runtimeOrigin?: MetaRuntimeOrigin;
  lastNativeError?: string | null;
  lastConnectionAttemptAt?: string | null;
  isRealHardware?: boolean;
  mockDeviceEnabled?: boolean;
};

export type SourceAvailabilityMap = {
  meta: {
    video: boolean;
    audio: boolean;
  };
  phone: {
    video: boolean;
    audio: boolean;
  };
};

export type SourceSelectionMode =
  | 'mock'
  | 'meta_full'
  | 'meta_video_phone_audio'
  | 'phone_only';

export type SourceManagerStatus = {
  activeVideoSource: InputSourceKind | null;
  activeAudioSource: InputSourceKind | null;
  selectedMode: SourceSelectionMode;
  mixedModeActive: boolean;
  fallbackActive: boolean;
  fallbackReason: string | null;
  lastConnectionError: string | null;
  lastConnectionAttemptAt: string | null;
  lastAttemptedSource: InputSourceKind | null;
  connectionAttempts: number;
  availability: SourceAvailabilityMap;
  sources: {
    meta: InputSourceStatus;
    phone: InputSourceStatus;
    mock?: InputSourceStatus;
  };
  hardwareValidation: {
    metaActiveForVideo: boolean;
    metaActiveForAudio: boolean;
    latestFrameOrigin: CameraFrame['source'] | null;
    latestAudioOrigin: InputSourceKind | null;
  };
  statusLabel: string;
  reason?: string;
};

export interface InputSource {
  kind: InputSourceKind;
  isAvailable(): boolean;
  requestPermissions(channels?: InputChannel[]): Promise<void>;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  startVideoCapture(): Promise<void>;
  stopVideoCapture(): Promise<void>;
  startAudioCapture(): Promise<void>;
  stopAudioCapture(): Promise<RecordedAudio | null>;
  getLatestFrame(): CameraFrame | null;
  getLatestAudio(): RecordedAudio | null;
  getStatus(): InputSourceStatus;
}
