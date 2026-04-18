import type { CameraFrame } from '../../protocol/types';

export type FrameProviderKind = 'meta_glasses' | 'expo_camera' | 'mock';

export type FrameProviderConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type FrameProviderStatus = {
  kind: FrameProviderKind;
  available: boolean;
  active: boolean;
  connectionState: FrameProviderConnectionState;
  lastFrameAt: string | null;
  statusLabel: string;
  reason?: string;
};

export interface FrameProvider {
  requestPermissions(): Promise<void>;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  startSampling(): void;
  stopSampling(): void;
  getLatestFrame(): CameraFrame | null;
  getStatus(): FrameProviderStatus;
}
