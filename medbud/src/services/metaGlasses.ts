import type { PlayableAudio, RecordedAudio } from '../types/session';

export type MetaAudioInputProvider = {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<RecordedAudio>;
};

export type MetaAudioOutputProvider = {
  play: (audio: PlayableAudio) => Promise<void>;
};

export type MetaLatestFrame = {
  uri: string;
  capturedAt: string;
};

export const metaGlasses = {
  async isAvailable() {
    return false;
  },

  getAudioInputProvider(): MetaAudioInputProvider | null {
    return null;
  },

  getAudioOutputProvider(): MetaAudioOutputProvider | null {
    return null;
  },

  async getLatestFrame(): Promise<MetaLatestFrame | null> {
    return null;
  },
};
