import { glassesAudio } from './glassesAudio';
import { metaWearablesBridge } from './metaWearablesBridge';

export const metaGlasses = {
  async isAvailable() {
    const status = await metaWearablesBridge.getStatus();
    return status.availability;
  },

  async isPlaybackAvailable() {
    return glassesAudio.isPlaybackAvailable();
  },

  async isMicrophoneAvailable() {
    return glassesAudio.isMicrophoneAvailable();
  },
};
