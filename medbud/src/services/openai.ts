import type { EmergencyAssessment, ModelAnalysis } from '../types/session';
import { medbudEnv } from '../utils/env';

const SYSTEM_PROMPT = [
  'You are Stitch, the calm emergency guidance assistant inside Aegis Vision.',
  'Return only immediate next-step guidance.',
  'Keep spoken guidance short.',
  'Do not give long explanations.',
  'Do not freestyle advanced medical diagnosis.',
  'Use null when the transcript does not clearly establish a field.',
].join(' ');

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        responsive: {
          type: ['boolean', 'null'],
        },
        severe_bleeding: {
          type: ['boolean', 'null'],
        },
        breathing: {
          type: ['boolean', 'null'],
        },
        notes: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        next_step: {
          type: 'string',
        },
      },
      required: ['responsive', 'severe_bleeding', 'breathing', 'notes', 'next_step'],
    },
    spokenResponse: {
      type: 'string',
    },
  },
  required: ['assessment', 'spokenResponse'],
} as const;

const MOCK_ANALYSES: ModelAnalysis[] = [
  {
    assessment: {
      responsive: true,
      severe_bleeding: true,
      breathing: true,
      notes: ['Deep arm wound reported', 'Heavy bleeding mentioned'],
      next_step: 'Apply firm pressure to the wound now.',
    },
    spokenResponse: 'Apply firm pressure to the wound now.',
  },
  {
    assessment: {
      responsive: false,
      severe_bleeding: null,
      breathing: null,
      notes: ['Patient is unresponsive', 'Breathing is uncertain'],
      next_step: 'Check breathing and call emergency services now.',
    },
    spokenResponse: 'Check breathing and call emergency services now.',
  },
  {
    assessment: {
      responsive: true,
      severe_bleeding: true,
      breathing: null,
      notes: ['Leg bleeding reported', 'Breathing concern mentioned'],
      next_step: 'Control the bleeding and reassess breathing.',
    },
    spokenResponse: 'Control the bleeding and reassess breathing.',
  },
];

const isNullableBoolean = (value: unknown) =>
  typeof value === 'boolean' || value === null;

const isAssessment = (value: unknown): value is EmergencyAssessment => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    isNullableBoolean(candidate.responsive) &&
    isNullableBoolean(candidate.severe_bleeding) &&
    isNullableBoolean(candidate.breathing) &&
    Array.isArray(candidate.notes) &&
    candidate.notes.every((note) => typeof note === 'string') &&
    typeof candidate.next_step === 'string'
  );
};

const parseModelAnalysis = (value: unknown): ModelAnalysis => {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenAI returned malformed data.');
  }

  const candidate = value as Record<string, unknown>;

  if (!isAssessment(candidate.assessment)) {
    throw new Error('OpenAI response did not match the emergency assessment schema.');
  }

  if (typeof candidate.spokenResponse !== 'string' || !candidate.spokenResponse.trim()) {
    throw new Error('OpenAI response did not include a spoken response.');
  }

  return {
    assessment: candidate.assessment,
    spokenResponse: candidate.spokenResponse.trim(),
  };
};

const chooseMockAnalysis = () =>
  MOCK_ANALYSES[Math.floor(Math.random() * MOCK_ANALYSES.length)];

async function analyzeTranscriptLive(transcript: string): Promise<ModelAnalysis> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${medbudEnv.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: medbudEnv.openai.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: SYSTEM_PROMPT,
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Transcript: ${transcript}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'stitch_stage1_response',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
  };

  if (!data.output_text) {
    throw new Error('OpenAI returned no structured output text.');
  }

  return parseModelAnalysis(JSON.parse(data.output_text));
}

async function analyzeTranscript(transcript: string): Promise<ModelAnalysis> {
  if (medbudEnv.useMocks) {
    return chooseMockAnalysis();
  }

  return analyzeTranscriptLive(transcript);
}

export const openAIService = {
  analyzeTranscript,
};
