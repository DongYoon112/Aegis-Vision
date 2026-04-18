import { NativeModules } from 'react-native';

import type { CameraFrame } from '../protocol/types';
import type { InputConnectionState } from './frameProvider/types';

export interface MetaWearablesBridge {
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  connectToGlasses(): Promise<boolean>;
  disconnectFromGlasses(): Promise<void>;
  startCameraSampling(intervalMs: number): Promise<void>;
  stopCameraSampling(): Promise<void>;
  getLatestFrame(): Promise<CameraFrame | null>;
  getConnectionState(): Promise<InputConnectionState>;
}

type NativeMetaWearablesModule = {
  initialize?: () => Promise<void>;
  isAvailable?: () => Promise<boolean>;
  connectToGlasses?: () => Promise<boolean>;
  disconnectFromGlasses?: () => Promise<void>;
  startCameraSampling?: (intervalMs: number) => Promise<void>;
  stopCameraSampling?: () => Promise<void>;
  getLatestFrame?: () => Promise<CameraFrame | null>;
  getConnectionState?: () => Promise<InputConnectionState>;
};

const nativeModule = (NativeModules as { MetaWearablesBridge?: NativeMetaWearablesModule })
  .MetaWearablesBridge;

class StubMetaWearablesBridge implements MetaWearablesBridge {
  async initialize() {
    // TODO: Wire the mobile-first Meta Wearables Device Access Toolkit native module here.
    await nativeModule?.initialize?.();
  }

  async isAvailable() {
    if (!nativeModule?.isAvailable) {
      return false;
    }

    try {
      return await nativeModule.isAvailable();
    } catch {
      return false;
    }
  }

  async connectToGlasses() {
    if (!nativeModule?.connectToGlasses) {
      return false;
    }

    try {
      return await nativeModule.connectToGlasses();
    } catch {
      return false;
    }
  }

  async disconnectFromGlasses() {
    if (!nativeModule?.disconnectFromGlasses) {
      return;
    }

    try {
      await nativeModule.disconnectFromGlasses();
    } catch {
      // Ignore native disconnect failures in the stub path.
    }
  }

  async startCameraSampling(intervalMs: number) {
    if (!nativeModule?.startCameraSampling) {
      return;
    }

    try {
      await nativeModule.startCameraSampling(intervalMs);
    } catch {
      // Ignore native sampling start failures and rely on fallback behavior.
    }
  }

  async stopCameraSampling() {
    if (!nativeModule?.stopCameraSampling) {
      return;
    }

    try {
      await nativeModule.stopCameraSampling();
    } catch {
      // Ignore native sampling stop failures in the stub path.
    }
  }

  async getLatestFrame() {
    if (!nativeModule?.getLatestFrame) {
      return null;
    }

    try {
      const frame = await nativeModule.getLatestFrame();
      return frame
        ? {
            ...frame,
            source: 'meta_glasses' as const,
          }
        : null;
    } catch {
      return null;
    }
  }

  async getConnectionState() {
    if (!nativeModule?.getConnectionState) {
      return 'unavailable';
    }

    try {
      return await nativeModule.getConnectionState();
    } catch {
      return 'failed';
    }
  }
}

export const metaWearablesBridge: MetaWearablesBridge =
  new StubMetaWearablesBridge();
