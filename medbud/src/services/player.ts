import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

import type { PlayableAudio } from '../types/session';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

class PlayerService {
  private player: ReturnType<typeof createAudioPlayer> | null = null;

  async play(audio: PlayableAudio) {
    await this.stop();

    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
    });

    if (audio.kind === 'speech') {
      await new Promise<void>((resolve, reject) => {
        Speech.speak(audio.spokenText, {
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: (event) => {
            reject(new Error(event.message || 'Mock speech playback failed.'));
          },
        });
      });
      return;
    }

    const player = createAudioPlayer({ uri: audio.uri });
    this.player = player;

    player.play();

    const startedAt = Date.now();

    while (true) {
      if (player.currentStatus.didJustFinish) {
        break;
      }

      if (!player.playing && player.currentTime > 0) {
        break;
      }

      if (Date.now() - startedAt > 30000) {
        throw new Error('Audio playback timed out before finishing.');
      }

      await sleep(200);
    }
  }

  async stop() {
    await Speech.stop().catch(() => undefined);

    if (this.player) {
      try {
        this.player.pause();
      } catch {
        // Ignore pause errors during cleanup.
      }

      this.player.remove();
      this.player = null;
    }
  }
}

export const player = new PlayerService();
