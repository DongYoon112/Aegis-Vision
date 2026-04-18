import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';

import type { PlayableAudio } from '../types/session';
import { medbudEnv } from '../utils/env';

const getOutputPath = () => {
  const basePath = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;

  if (!basePath) {
    throw new Error('A writable file system path was not available for audio playback.');
  }

  return `${basePath}medbud-tts-${Date.now()}.mp3`;
};

async function synthesizeSpeechLive(text: string): Promise<PlayableAudio> {
  const voiceId = medbudEnv.elevenLabs.ttsVoiceId;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': medbudEnv.elevenLabs.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: medbudEnv.elevenLabs.ttsModelId,
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${detail}`);
  }

  const bytes = await response.arrayBuffer();
  const outputUri = getOutputPath();
  const base64Audio = Buffer.from(bytes).toString('base64');

  await FileSystem.writeAsStringAsync(outputUri, base64Audio, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    kind: 'uri',
    uri: outputUri,
    mimeType: 'audio/mpeg',
  };
}

async function synthesizeSpeech(text: string): Promise<PlayableAudio> {
  if (medbudEnv.useMocks) {
    return {
      kind: 'speech',
      spokenText: text,
    };
  }

  return synthesizeSpeechLive(text);
}

export const elevenLabsTTS = {
  synthesizeSpeech,
};
