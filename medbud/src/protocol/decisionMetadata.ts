import type { ProtocolDecision } from './types';
import type { TrustFieldName } from './trustTypes';

export type PromptType =
  | 'confirm_breathing'
  | 'confirm_bleeding'
  | 'confirm_responsiveness';

const ACTION_TO_FIELD: Record<string, TrustFieldName> = {
  control_bleeding: 'severe_bleeding',
  check_breathing: 'breathing',
  check_responsive: 'responsiveness',
};

const FIELD_TO_PROMPT: Record<TrustFieldName, PromptType> = {
  breathing: 'confirm_breathing',
  severe_bleeding: 'confirm_bleeding',
  responsiveness: 'confirm_responsiveness',
};

export const getRootStepId = (stepId: string) =>
  stepId.endsWith('_follow_up') ? stepId.replace(/_follow_up$/, '') : stepId;

export const getFieldForAction = (action: string): TrustFieldName | null =>
  ACTION_TO_FIELD[getRootStepId(action)] ?? null;

export const getPromptTypeForField = (
  field: TrustFieldName | null
): PromptType | null => (field ? FIELD_TO_PROMPT[field] : null);

export const getPromptTypeForDecision = (
  decision: Pick<ProtocolDecision, 'step_id' | 'needs_confirmation'>
): PromptType | null => {
  if (!decision.needs_confirmation) {
    return null;
  }

  return getPromptTypeForField(getFieldForAction(decision.step_id));
};

export const getActionForPromptType = (promptType: PromptType | null): string | null => {
  switch (promptType) {
    case 'confirm_bleeding':
      return 'control_bleeding';
    case 'confirm_breathing':
      return 'check_breathing';
    case 'confirm_responsiveness':
      return 'check_responsive';
    default:
      return null;
  }
};
