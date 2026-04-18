import { parserPrompt } from '../prompts/parserPrompt';
import {
  clampConfidence,
  fallbackParserOutput,
  sanitizeNotes,
  sanitizeNullableBoolean,
  sanitizeOptionalString,
  type ParserOutput,
} from '../protocol/types';
import { openAIService } from '../services/openai';
import { medbudEnv } from '../utils/env';

const PARSER_SCHEMA = {
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
    injury_location: {
      type: ['string', 'null'],
    },
    notes: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    confidence: {
      type: 'number',
    },
  },
  required: [
    'responsive',
    'severe_bleeding',
    'breathing',
    'injury_location',
    'notes',
    'confidence',
  ],
} as const;

const MOCK_PARSER_OUTPUT: ParserOutput = {
  responsive: true,
  severe_bleeding: true,
  breathing: true,
  injury_location: 'left forearm',
  notes: ['Heavy bleeding from left forearm', 'Patient is awake and talking'],
  confidence: 0.93,
};

const sanitizeParserOutput = (value: unknown): ParserOutput => {
  if (!value || typeof value !== 'object') {
    return fallbackParserOutput();
  }

  const candidate = value as Record<string, unknown>;

  return {
    responsive: sanitizeNullableBoolean(candidate.responsive),
    severe_bleeding: sanitizeNullableBoolean(candidate.severe_bleeding),
    breathing: sanitizeNullableBoolean(candidate.breathing),
    injury_location: sanitizeOptionalString(candidate.injury_location),
    notes: sanitizeNotes(candidate.notes),
    confidence: clampConfidence(candidate.confidence, 0),
  };
};

async function parseTranscriptLive(transcript: string): Promise<ParserOutput> {
  const raw = await openAIService.createStructuredResponse<unknown>({
    name: 'stitch_stage2_parser',
    schema: PARSER_SCHEMA,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: parserPrompt,
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
  });

  return sanitizeParserOutput(raw);
}

async function parseTranscript(transcript: string): Promise<ParserOutput> {
  if (medbudEnv.useMocks) {
    return sanitizeParserOutput(MOCK_PARSER_OUTPUT);
  }

  return parseTranscriptLive(transcript);
}

export const parser = {
  parseTranscript,
};
