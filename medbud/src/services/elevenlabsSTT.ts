import { medbudEnv } from '../utils/env';
import type { RecordedAudio } from '../types/session';

const MOCK_TRANSCRIPTS = [
  'The patient is awake, breathing, and has a deep cut on the forearm with heavy bleeding.',
  'The casualty is not responding. I do not see major bleeding. I am not sure if they are breathing.',
  'The person is responsive and talking. There is blood on the leg and they say it hurts to breathe.',
];

const chooseMockTranscript = () =>
  MOCK_TRANSCRIPTS[Math.floor(Math.random() * MOCK_TRANSCRIPTS.length)];

const ensureTranscript = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  throw new Error('ElevenLabs STT returned an empty transcript.');
};

const createAudioFormData = (audio: RecordedAudio) => {
  const formData = new FormData();
  formData.append('model_id', medbudEnv.elevenLabs.sttModelId);
  formData.append('language_code', 'eng');
  formData.append('tag_audio_events', 'false');
  formData.append(
    'file',
    {
      uri: audio.uri,
      name: audio.fileName,
      type: audio.mimeType,
    } as unknown as Blob
  );
  return formData;
};

async function transcribeAudioLive(audio: RecordedAudio) {
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': medbudEnv.elevenLabs.apiKey,
    },
    body: createAudioFormData(audio),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs STT failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { text?: unknown };
  return ensureTranscript(data.text);
}

async function transcribeAudio(audio: RecordedAudio) {
  if (medbudEnv.useMocks) {
    return chooseMockTranscript();
  }

  return transcribeAudioLive(audio);
}

export const elevenLabsSTT = {
  transcribeAudio,
};
