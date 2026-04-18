import { medbudEnv } from '../../utils/env';
import type { ExpoCameraRefLike } from '../camera';
import { expoCameraProvider } from './expoCameraProvider';
import { metaGlassesProvider } from './metaGlassesProvider';
import { mockFrameProvider } from './mockProvider';
import type { FrameProvider, FrameProviderStatus } from './types';

class FrameProviderManager {
  private activeProvider: FrameProvider = expoCameraProvider;
  private initialized = false;

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (medbudEnv.useMocks) {
      this.activeProvider = mockFrameProvider;
      this.initialized = true;
      return;
    }

    await metaGlassesProvider.initialize();
    await metaGlassesProvider.connect?.();
    await this.resolveActiveProvider();
    this.initialized = true;
  }

  async resolveActiveProvider() {
    if (medbudEnv.useMocks) {
      this.activeProvider = mockFrameProvider;
      return this.activeProvider;
    }

    const metaStatus = metaGlassesProvider.getStatus();

    if (metaStatus.available && metaStatus.connectionState === 'connected') {
      this.activeProvider = metaGlassesProvider;
    } else {
      this.activeProvider = expoCameraProvider;
    }

    return this.activeProvider;
  }

  getActiveProvider() {
    return this.activeProvider;
  }

  getStatus(): FrameProviderStatus {
    const activeStatus = this.activeProvider.getStatus();

    if (activeStatus.kind === 'expo_camera' && !medbudEnv.useMocks) {
      const metaStatus = metaGlassesProvider.getStatus();

      if (!metaStatus.available || metaStatus.connectionState !== 'connected') {
        return {
          ...activeStatus,
          statusLabel: 'Using phone camera fallback',
          reason: metaStatus.reason ?? 'Meta glasses unavailable',
        };
      }
    }

    return activeStatus;
  }

  async connectGlasses() {
    if (medbudEnv.useMocks) {
      return;
    }

    await metaGlassesProvider.connect?.();
    await this.resolveActiveProvider();
  }

  async disconnectGlasses() {
    if (medbudEnv.useMocks) {
      return;
    }

    await metaGlassesProvider.disconnect?.();
    await this.resolveActiveProvider();
  }

  attachExpoCameraRef(ref: ExpoCameraRefLike | null) {
    expoCameraProvider.attachCameraRef(ref);
  }
}

export const providerManager = new FrameProviderManager();
