import { glassesAudio } from './glassesAudio';
import { metaWearablesBridge } from './metaWearablesBridge';

export const metaGlasses = {
  async isAvailable() {
    return metaWearablesBridge.isAvailable();
  },

  async isPlaybackAvailable() {
    return glassesAudio.isPlaybackAvailable();
  },

  async isMicrophoneAvailable() {
    return glassesAudio.isMicrophoneAvailable();
  },
};
