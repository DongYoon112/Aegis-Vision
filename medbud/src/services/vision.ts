import { visionPrompt } from '../prompts/visionPrompt';
import {
  clampConfidence,
  fallbackVisionOutput,
  sanitizeImageQuality,
  sanitizeNullableBoolean,
  sanitizeOptionalString,
  type CameraFrame,
  type VisionOutput,
} from '../protocol/types';
import { openAIService } from './openai';
import { medbudEnv } from '../utils/env';
import * as FileSystem from 'expo-file-system/legacy';

const VISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    person_visible: {
      type: ['boolean', 'null'],
    },
    casualty_supine: {
      type: ['boolean', 'null'],
    },
    severe_bleeding_likely: {
      type: ['boolean', 'null'],
    },
    limb_visible: {
      type: ['string', 'null'],
    },
    image_quality: {
      type: 'string',
      enum: ['usable', 'blurry', 'dark', 'unclear'],
    },
    confidence: {
      type: 'number',
    },
  },
  required: [
    'person_visible',
    'casualty_supine',
    'severe_bleeding_likely',
    'limb_visible',
    'image_quality',
    'confidence',
  ],
} as const;

const MOCK_VISION_OUTPUT: VisionOutput = {
  person_visible: true,
  casualty_supine: false,
  severe_bleeding_likely: true,
  limb_visible: 'left forearm',
  image_quality: 'usable',
  confidence: 0.87,
};

const sanitizeVisionOutput = (value: unknown): VisionOutput => {
  if (!value || typeof value !== 'object') {
    return fallbackVisionOutput();
  }

  const candidate = value as Record<string, unknown>;

  return {
    person_visible: sanitizeNullableBoolean(candidate.person_visible),
    casualty_supine: sanitizeNullableBoolean(candidate.casualty_supine),
    severe_bleeding_likely: sanitizeNullableBoolean(
      candidate.severe_bleeding_likely
    ),
    limb_visible: sanitizeOptionalString(candidate.limb_visible),
    image_quality: sanitizeImageQuality(candidate.image_quality),
    confidence: clampConfidence(candidate.confidence, 0),
  };
};

const getMimeType = (uri: string) => {
  const extension = uri.split('.').pop()?.toLowerCase();

  if (extension === 'png') {
    return 'image/png';
  }

  return 'image/jpeg';
};

const frameToDataUrl = async (frame: CameraFrame) => {
  const base64 = await FileSystem.readAsStringAsync(frame.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return `data:${getMimeType(frame.uri)};base64,${base64}`;
};

async function analyzeFrameLive(frame: CameraFrame | null): Promise<VisionOutput> {
  if (!frame) {
    return fallbackVisionOutput('unclear');
  }

  const imageUrl = await frameToDataUrl(frame);

  const raw = await openAIService.createStructuredResponse<unknown>({
    name: 'stitch_stage2_vision',
    schema: VISION_SCHEMA,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: visionPrompt,
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Analyze the latest sampled frame and return only the schema fields.',
          },
          {
            type: 'input_image',
            image_url: imageUrl,
            detail: 'low',
          },
        ],
      },
    ],
  });

  return sanitizeVisionOutput(raw);
}

async function analyzeFrame(frame: CameraFrame | null): Promise<VisionOutput> {
  if (medbudEnv.useMocks) {
    return sanitizeVisionOutput(MOCK_VISION_OUTPUT);
  }

  return analyzeFrameLive(frame);
}

export const visionService = {
  analyzeFrame,
};
