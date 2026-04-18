const normalize = (value: string | undefined) => value?.trim() ?? '';

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  const normalized = normalize(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

export const medbudEnv = {
  useMocks: parseBoolean(process.env.EXPO_PUBLIC_MEDBUD_USE_MOCKS, true),
  openai: {
    apiKey: normalize(process.env.EXPO_PUBLIC_OPENAI_API_KEY),
    model: normalize(process.env.EXPO_PUBLIC_OPENAI_MODEL) || 'gpt-5.4-mini',
  },
  elevenLabs: {
    apiKey: normalize(process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY),
    sttModelId:
      normalize(process.env.EXPO_PUBLIC_ELEVENLABS_STT_MODEL_ID) || 'scribe_v2',
    ttsVoiceId: normalize(process.env.EXPO_PUBLIC_ELEVENLABS_TTS_VOICE_ID),
    ttsModelId:
      normalize(process.env.EXPO_PUBLIC_ELEVENLABS_TTS_MODEL_ID) ||
      'eleven_multilingual_v2',
  },
};

const requiredLiveConfig = [
  {
    label: 'EXPO_PUBLIC_OPENAI_API_KEY',
    value: medbudEnv.openai.apiKey,
  },
  {
    label: 'EXPO_PUBLIC_ELEVENLABS_API_KEY',
    value: medbudEnv.elevenLabs.apiKey,
  },
  {
    label: 'EXPO_PUBLIC_ELEVENLABS_TTS_VOICE_ID',
    value: medbudEnv.elevenLabs.ttsVoiceId,
  },
];

export const getMissingLiveConfig = () =>
  requiredLiveConfig.filter((entry) => !entry.value).map((entry) => entry.label);

export const assertLiveConfig = () => {
  const missing = getMissingLiveConfig();

  if (missing.length > 0) {
    throw new Error(
      `Missing live API configuration: ${missing.join(', ')}. ` +
        'Set the environment variables or switch to mock mode.'
    );
  }
};
