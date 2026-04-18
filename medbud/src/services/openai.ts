import { rephrasePrompt } from '../prompts/rephrasePrompt';
import type { ProtocolDecision } from '../protocol/types';
import { medbudEnv } from '../utils/env';

type InputTextContent = {
  type: 'input_text';
  text: string;
};

type InputImageContent = {
  type: 'input_image';
  image_url: string;
  detail?: 'low' | 'high' | 'auto';
};

type ResponseInputMessage = {
  role: 'system' | 'user';
  content: Array<InputTextContent | InputImageContent>;
};

type StructuredResponseOptions = {
  name: string;
  schema: Record<string, unknown>;
  input: ResponseInputMessage[];
};

const FALLBACK_REPHRASE = (decision: ProtocolDecision) => {
  const trimmed = decision.instruction.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.slice(0, 12).join(' ');
};

async function createStructuredResponse<T>({
  name,
  schema,
  input,
}: StructuredResponseOptions): Promise<T> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${medbudEnv.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: medbudEnv.openai.model,
      input,
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema,
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

  return JSON.parse(data.output_text) as T;
}

const REPHRASE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    spoken_response: {
      type: 'string',
    },
  },
  required: ['spoken_response'],
} as const;

async function rephraseProtocolDecisionLive(
  decision: ProtocolDecision,
  systemPrompt: string
): Promise<string> {
  const result = await createStructuredResponse<{ spoken_response?: unknown }>({
    name: 'stitch_stage2_rephrase',
    schema: REPHRASE_SCHEMA,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: systemPrompt,
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              instruction: decision.instruction,
              needs_confirmation: decision.needs_confirmation,
              priority: decision.priority,
            }),
          },
        ],
      },
    ],
  });

  if (typeof result.spoken_response !== 'string') {
    throw new Error('OpenAI rephrase response was malformed.');
  }

  const sanitized = result.spoken_response.trim().replace(/\s+/g, ' ');

  if (!sanitized) {
    throw new Error('OpenAI rephrase response was empty.');
  }

  if (sanitized.split(' ').filter(Boolean).length > 12) {
    return FALLBACK_REPHRASE(decision);
  }

  return sanitized;
}

export const openAIService = {
  createStructuredResponse,
  fallbackRephrase: FALLBACK_REPHRASE,
  async rephraseProtocolDecision(decision: ProtocolDecision): Promise<string> {
    if (medbudEnv.useMocks) {
      return FALLBACK_REPHRASE(decision);
    }

    try {
      return await rephraseProtocolDecisionLive(decision, rephrasePrompt);
    } catch {
      return FALLBACK_REPHRASE(decision);
    }
  },
};
