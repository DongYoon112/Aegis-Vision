import type { CameraFrame } from '../../protocol/types';
import type { RecordedAudio } from '../../types/session';

export type InputSourceKind = 'meta_glasses' | 'phone' | 'mock';
export type InputChannel = 'video' | 'audio';

export type InputConnectionState =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

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
