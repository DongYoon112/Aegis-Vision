export type NullableBoolean = boolean | null;

export type ImageQuality = 'usable' | 'blurry' | 'dark' | 'unclear';

export type CameraFrame = {
  uri: string;
  capturedAt: string;
  width: number | null;
  height: number | null;
};

export type ParserOutput = {
  responsive: NullableBoolean;
  severe_bleeding: NullableBoolean;
  breathing: NullableBoolean;
  injury_location: string | null;
  notes: string[];
  confidence: number;
};

export type VisionOutput = {
  person_visible: NullableBoolean;
  casualty_supine: NullableBoolean;
  severe_bleeding_likely: NullableBoolean;
  limb_visible: string | null;
  image_quality: ImageQuality;
  confidence: number;
};

export type MergedState = {
  responsive: NullableBoolean;
  breathing: NullableBoolean;
  severe_bleeding: NullableBoolean;
  injury_location: string | null;
  person_visible: NullableBoolean;
  casualty_supine: NullableBoolean;
  limb_visible: string | null;
  image_quality: ImageQuality;
  confidence: number;
  notes: string[];
};

export type ProtocolPriority = 'low' | 'medium' | 'high';

export type ProtocolDecision = {
  step_id: string;
  priority: ProtocolPriority;
  instruction: string;
  reason: string;
  needs_confirmation: boolean;
};

const IMAGE_QUALITIES: ImageQuality[] = ['usable', 'blurry', 'dark', 'unclear'];

export const clampConfidence = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
};

export const sanitizeNullableBoolean = (value: unknown): NullableBoolean =>
  typeof value === 'boolean' ? value : null;

export const sanitizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const sanitizeNotes = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();

  value.forEach((entry) => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) {
        unique.add(trimmed);
      }
    }
  });

  return Array.from(unique);
};

export const sanitizeImageQuality = (value: unknown): ImageQuality =>
  typeof value === 'string' && IMAGE_QUALITIES.includes(value as ImageQuality)
    ? (value as ImageQuality)
    : 'unclear';

export const fallbackParserOutput = (): ParserOutput => ({
  responsive: null,
  severe_bleeding: null,
  breathing: null,
  injury_location: null,
  notes: [],
  confidence: 0,
});

export const fallbackVisionOutput = (imageQuality: ImageQuality = 'unclear'): VisionOutput => ({
  person_visible: null,
  casualty_supine: null,
  severe_bleeding_likely: null,
  limb_visible: null,
  image_quality: imageQuality,
  confidence: 0,
});
