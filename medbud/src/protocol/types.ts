import type { PromptType } from './decisionMetadata';

export type NullableBoolean = boolean | null;

export type ImageQuality = 'usable' | 'blurry' | 'dark' | 'unclear';
export type BodyPosition = 'supine' | 'upright' | 'unknown' | null;
export type VisibleLimb =
  | 'left_arm'
  | 'right_arm'
  | 'left_leg'
  | 'right_leg'
  | null;

export type CameraFrame = {
  uri: string;
  capturedAt: string;
  width: number | null;
  height: number | null;
  source?: 'meta_glasses' | 'phone' | 'mock';
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
  body_position: BodyPosition;
  severe_bleeding_likely: NullableBoolean;
  limb_visible: VisibleLimb;
  image_quality: ImageQuality;
  confidence: number;
};

export type MergedState = {
  responsive: NullableBoolean;
  breathing: NullableBoolean;
  severe_bleeding: NullableBoolean;
  parser_responsive: NullableBoolean;
  parser_breathing: NullableBoolean;
  parser_severe_bleeding: NullableBoolean;
  injury_location: string | null;
  person_visible: NullableBoolean;
  casualty_supine: NullableBoolean;
  limb_visible: string | null;
  image_quality: ImageQuality;
  confidence: number;
  notes: string[];
};

export type CasePhase =
  | 'unknown'
  | 'initial_assessment'
  | 'bleeding_control'
  | 'airway_check'
  | 'stabilization';

export type ProtocolPriority = 'low' | 'medium' | 'high' | 'critical';

export type ProtocolSelectedAction =
  | 'control_bleeding'
  | 'airway_or_breathing_support'
  | 'check_responsiveness'
  | 'confirm_breathing'
  | 'confirm_responsiveness'
  | 'monitoring'
  | 'aim_camera';

export type ActionSkipReason =
  | 'not_allowed'
  | 'field_does_not_need_confirmation'
  | 'confirmation_recovered'
  | 'cooldown'
  | 'anti_repeat_suppressed'
  | 'severe_bleeding_override'
  | 'lower_priority_than_selected'
  | 'urgent_bypass_triggered'
  | 'insufficient_persistence'
  | 'confidence_below_urgent_threshold'
  | 'recent_contradiction'
  | 'control_bleeding_not_allowed'
  | 'reassess_exited_after_recovery';

export type ProtocolActionDebug = {
  priorityOrder: ProtocolSelectedAction[];
  skipped: Array<{
    action: ProtocolSelectedAction;
    reason: ActionSkipReason;
  }>;
};

export type ProtocolDecision = {
  step_id: string;
  priority: ProtocolPriority;
  instruction: string;
  reason: string;
  needs_confirmation: boolean;
  selectedAction: ProtocolSelectedAction;
  consideredActions?: ProtocolSelectedAction[];
  cooldown_affected?: boolean;
  actionDebug?: ProtocolActionDebug;
  urgent_bypass_activated?: boolean;
  urgent_bypass_reason?: string;
  urgent_bypass_confidence?: number;
  urgent_bypass_persistence_count?: number;
  urgent_bypass_contradiction_blocked?: boolean;
  confirmation_recovery_activated?: boolean;
  confirmation_recovery_reason?: string;
  anti_repeat_suppressed?: boolean;
  anti_repeat_reason?: string;
  anti_repeat_suppressed_prompt_type?: PromptType | null;
  reassess_exited_after_recovery?: boolean;
  reassess_exit_reason?: string;
  prompt_type?: PromptType | null;
  cooldown_suppressed?: boolean;
};

const IMAGE_QUALITIES: ImageQuality[] = ['usable', 'blurry', 'dark', 'unclear'];
const BODY_POSITIONS: Exclude<BodyPosition, null>[] = [
  'supine',
  'upright',
  'unknown',
];
const VISIBLE_LIMBS: Exclude<VisibleLimb, null>[] = [
  'left_arm',
  'right_arm',
  'left_leg',
  'right_leg',
];

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

export const sanitizeBodyPosition = (value: unknown): BodyPosition => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return BODY_POSITIONS.includes(trimmed as Exclude<BodyPosition, null>)
    ? (trimmed as Exclude<BodyPosition, null>)
    : null;
};

export const sanitizeVisibleLimb = (value: unknown): VisibleLimb => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return VISIBLE_LIMBS.includes(trimmed as Exclude<VisibleLimb, null>)
    ? (trimmed as Exclude<VisibleLimb, null>)
    : null;
};

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
  body_position: null,
  severe_bleeding_likely: null,
  limb_visible: null,
  image_quality: imageQuality,
  confidence: 0,
});
