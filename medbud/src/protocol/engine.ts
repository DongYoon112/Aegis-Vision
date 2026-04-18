import type { MergedState, ProtocolDecision } from './types';

const makeDecision = (
  step_id: string,
  priority: ProtocolDecision['priority'],
  instruction: string,
  reason: string,
  needs_confirmation: boolean
): ProtocolDecision => ({
  step_id,
  priority,
  instruction,
  reason,
  needs_confirmation,
});

const fallbackInstruction = (state: MergedState) => {
  if (state.breathing === null) {
    return makeDecision(
      'reassess',
      'low',
      'Tell me if they are breathing now.',
      'Fallback reassessment when the next immediate fact is still unclear.',
      true
    );
  }

  return makeDecision(
    'reassess',
    'low',
    'Tell me if they are awake and breathing.',
    'Fallback reassessment when no higher priority rule applies.',
    true
  );
};

const decide = (state: MergedState): ProtocolDecision => {
  if (state.severe_bleeding === true) {
    return makeDecision(
      'control_bleeding',
      'high',
      'Apply firm pressure to the bleeding now.',
      'Severe bleeding has top priority in the protocol.',
      false
    );
  }

  if (state.responsive === false && state.breathing === null) {
    return makeDecision(
      'check_breathing',
      'high',
      'Check if the casualty is breathing now.',
      'An unresponsive casualty with unknown breathing outranks camera guidance.',
      false
    );
  }

  if (state.person_visible === false) {
    return makeDecision(
      'aim_camera',
      'medium',
      'Point the camera at the casualty.',
      'The casualty is not visible enough for scene confirmation.',
      false
    );
  }

  if (state.image_quality !== 'usable') {
    return makeDecision(
      'improve_view',
      'medium',
      'Hold still and give me a clearer view.',
      'Poor image quality should trigger a better-angle request.',
      false
    );
  }

  if (state.confidence < 0.55) {
    return makeDecision(
      'confirm_state',
      'low',
      'Confirm if they are breathing and responsive.',
      'Low confidence requires confirmation before a stronger instruction.',
      true
    );
  }

  return fallbackInstruction(state);
};

export const protocolEngine = {
  decide,
};
