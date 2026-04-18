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

  // Stage 3 can swap this with Meta/Ray-Ban microphone input.
  getAudioInputProvider(): MetaAudioInputProvider | null {
    return null;
  },

  // Stage 3 can route Stitch audio back through glasses speakers.
  getAudioOutputProvider(): MetaAudioOutputProvider | null {
    return null;
  },

  // Stage 3 can supply latest sampled frames instead of Expo camera captures.
  async getLatestFrame(): Promise<MetaLatestFrame | null> {
    return null;
  },
};
