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

type ResponsesApiContentItem = {
  type?: string;
  text?: string;
  json?: unknown;
  refusal?: string;
};

type ResponsesApiOutputItem = {
  content?: ResponsesApiContentItem[];
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: ResponsesApiOutputItem[];
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  error?: {
    message?: string;
  };
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

  const data = (await response.json()) as ResponsesApiResponse;
  const extracted = extractStructuredResponseText(data);

  if (!extracted) {
    const incompleteReason = data.incomplete_details?.reason;
    const errorMessage = data.error?.message;
    const detail = [errorMessage, incompleteReason].filter(Boolean).join(' | ');
    throw new Error(
      detail
        ? `OpenAI returned no structured output text. ${detail}`
        : 'OpenAI returned no structured output text.'
    );
  }

  return JSON.parse(extracted) as T;
}

function extractStructuredResponseText(data: ResponsesApiResponse): string | null {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  for (const outputItem of data.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
        return contentItem.text;
      }

      if (contentItem.json !== undefined) {
        return JSON.stringify(contentItem.json);
      }
    }
  }

  return null;
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
