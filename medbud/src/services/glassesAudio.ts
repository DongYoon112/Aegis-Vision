import { metaWearablesBridge } from './metaWearablesBridge';

export const glassesAudio = {
  async isPlaybackAvailable() {
    const status = await metaWearablesBridge.getStatus();
    return status.capabilities.playback;
  },

  async isMicrophoneAvailable() {
    const status = await metaWearablesBridge.getStatus();
    return status.capabilities.audio;
  },
};
