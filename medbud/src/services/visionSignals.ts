import * as FileSystem from 'expo-file-system/legacy';

import { visionPrompt } from '../prompts/visionPrompt';
import {
  clampConfidence,
  fallbackVisionOutput,
  sanitizeBodyPosition,
  sanitizeImageQuality,
  sanitizeNullableBoolean,
  sanitizeVisibleLimb,
  type CameraFrame,
  type VisionOutput,
} from '../protocol/types';
import { openAIService } from './openai';
import { medbudEnv } from '../utils/env';

const FRAME_STALE_MS = 3000;

const VISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    person_visible: {
      type: ['boolean', 'null'],
    },
    body_position: {
      type: ['string', 'null'],
      enum: ['supine', 'upright', 'unknown', null],
    },
    severe_bleeding_likely: {
      type: ['boolean', 'null'],
    },
    limb_visible: {
      type: ['string', 'null'],
      enum: ['left_arm', 'right_arm', 'left_leg', 'right_leg', null],
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
    'body_position',
    'severe_bleeding_likely',
    'limb_visible',
    'image_quality',
    'confidence',
  ],
} as const;

const MOCK_VISION_SIGNALS: VisionOutput = {
  person_visible: true,
  body_position: 'upright',
  severe_bleeding_likely: true,
  limb_visible: 'left_arm',
  image_quality: 'usable',
  confidence: 0.87,
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

const isFrameFresh = (frame: CameraFrame | null, now: number) => {
  if (!frame) {
    return false;
  }

  const capturedAt = Date.parse(frame.capturedAt);
  if (Number.isNaN(capturedAt)) {
    return false;
  }

  return now - capturedAt <= FRAME_STALE_MS;
};

const sanitizeVisionSignals = (value: unknown): VisionOutput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallbackVisionOutput('unclear');
  }

  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'person_visible',
    'body_position',
    'severe_bleeding_likely',
    'limb_visible',
    'image_quality',
    'confidence',
  ];

  const candidateKeys = Object.keys(candidate);
  const hasSchemaMismatch =
    candidateKeys.length !== expectedKeys.length ||
    candidateKeys.some((key) => !expectedKeys.includes(key));

  if (hasSchemaMismatch) {
    return fallbackVisionOutput('unclear');
  }

  const imageQuality = sanitizeImageQuality(candidate.image_quality);
  let confidence = clampConfidence(candidate.confidence, 0);

  if (imageQuality !== 'usable') {
    confidence = clampConfidence(confidence * 0.5, 0);
  }

  let personVisible = sanitizeNullableBoolean(candidate.person_visible);
  let bodyPosition = sanitizeBodyPosition(candidate.body_position);
  let severeBleedingLikely = sanitizeNullableBoolean(
    candidate.severe_bleeding_likely
  );
  const limbVisible = sanitizeVisibleLimb(candidate.limb_visible);

  if (confidence < 0.6) {
    personVisible = null;
    bodyPosition = null;
    severeBleedingLikely = null;
  }

  return {
    person_visible: personVisible,
    body_position: bodyPosition,
    severe_bleeding_likely: severeBleedingLikely,
    limb_visible: limbVisible,
    image_quality: imageQuality,
    confidence,
  };
};

async function analyzeFrameLive(
  frame: CameraFrame | null,
  now: number
): Promise<VisionOutput> {
  if (!isFrameFresh(frame, now)) {
    return fallbackVisionOutput('unclear');
  }

  const safeFrame = frame;
  if (!safeFrame) {
    return fallbackVisionOutput('unclear');
  }

  const imageUrl = await frameToDataUrl(safeFrame);

  const raw = await openAIService.createStructuredResponse<unknown>({
    name: 'stitch_stage4_vision_signals',
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
            text: 'Analyze the frame and return only structured visible scene signals.',
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

  return sanitizeVisionSignals(raw);
}

async function analyzeFrame(
  frame: CameraFrame | null,
  now: number
): Promise<VisionOutput> {
  if (medbudEnv.useMocks) {
    if (!isFrameFresh(frame, now)) {
      return fallbackVisionOutput('unclear');
    }

    return sanitizeVisionSignals(MOCK_VISION_SIGNALS);
  }

  return analyzeFrameLive(frame, now);
}

export const visionSignals = {
  analyzeFrame,
};
