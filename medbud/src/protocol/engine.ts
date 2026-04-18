import type { MergedState, ProtocolDecision } from './types';
import type { TrustAssessment } from './trustTypes';
import type { CooldownStrength, MemoryContext } from '../session/types';

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

const isCriticalStep = (stepId: string) =>
  ['control_bleeding', 'check_breathing', 'confirm_state'].includes(stepId);

const getFollowUpTier = (turnCount: number) => {
  if (turnCount >= 3) {
    return 3;
  }

  if (turnCount >= 2) {
    return 2;
  }

  return 1;
};

const getRepeatStrength = (
  decision: ProtocolDecision,
  memory: MemoryContext
): CooldownStrength => {
  if (memory.last_step_id === decision.step_id) {
    return 'strong';
  }

  if (memory.recent_steps.includes(decision.step_id)) {
    return 'weak';
  }

  return 'none';
};

const getFollowUpInstruction = (
  stepId: string,
  state: MergedState,
  tier: number
) => {
  if (stepId === 'control_bleeding') {
    if (state.severe_bleeding === true) {
      if (tier >= 3) {
        return 'Confirm the bleeding is slowing now.';
      }

      if (tier === 2) {
        return 'Check if the bleeding is slowing now.';
      }

      return 'Is the bleeding slowing?';
    }

    if (state.severe_bleeding === false) {
      return tier >= 3
        ? 'Confirm there is no severe bleeding now.'
        : 'Confirm there is no bleeding.';
    }

    return tier >= 3
      ? 'Confirm whether you see severe bleeding now.'
      : 'Do you see severe bleeding now?';
  }

  if (stepId === 'check_breathing' || stepId === 'confirm_state') {
    if (state.breathing === true) {
      return tier >= 3
        ? 'Confirm their breathing is steady now.'
        : 'Is their breathing steady?';
    }

    if (state.breathing === false) {
      return tier >= 3
        ? 'Confirm whether they are breathing at all.'
        : 'Are they breathing at all?';
    }

    return tier >= 3
      ? 'Confirm if they are breathing now.'
      : 'Can you check if they are breathing?';
  }

  if (state.responsive === true) {
    return tier >= 3
      ? 'Confirm they are responding clearly now.'
      : 'Are they responding clearly now?';
  }

  if (state.responsive === false) {
    return tier >= 3
      ? 'Confirm whether they respond at all now.'
      : 'Are they responding at all now?';
  }

  return tier >= 3
    ? 'Confirm if they respond now.'
    : 'Can you check if they respond?';
};

const makeFollowUpDecision = (
  stepId: string,
  state: MergedState,
  memory: MemoryContext,
  reason: string
) =>
  makeDecision(
    `${stepId}_follow_up`,
    stepId === 'control_bleeding' || stepId === 'check_breathing' ? 'high' : 'low',
    getFollowUpInstruction(stepId, state, getFollowUpTier(memory.turn_count)),
    reason,
    true
  );

const makeReassessDecision = (
  instruction: string,
  reason: string,
  priority: ProtocolDecision['priority'] = 'low'
) => makeDecision('reassess', priority, instruction, reason, true);

const applyMemoryGuardrails = (
  decision: ProtocolDecision,
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
): ProtocolDecision => {
  let repeatStrength = getRepeatStrength(decision, memory);

  if (memory.signalsImproving) {
    repeatStrength =
      repeatStrength === 'strong'
        ? 'weak'
        : repeatStrength === 'weak'
          ? 'none'
          : 'none';
  }

  const confirmationBias =
    trust.needs_confirmation ||
    memory.confidenceDropping ||
    (memory.turn_count > 3 && trust.needs_confirmation) ||
    (memory.signalsStable && repeatStrength !== 'none');

  if (repeatStrength !== 'none') {
    if (isCriticalStep(decision.step_id)) {
      return makeFollowUpDecision(
        decision.step_id,
        state,
        memory,
        repeatStrength === 'strong'
          ? 'Immediate repeat converted into a follow-up check.'
          : 'Repeated critical step converted into a follow-up check.'
      );
    }

    if (confirmationBias || memory.signalsStable) {
      return makeReassessDecision(
        'Confirm what you see before the next step.',
        'Repeated non-critical step with stable or less reliable signals.',
        'low'
      );
    }

    return makeReassessDecision(
      'Give me a quick update on their condition now.',
      'Repeated non-critical step converted into reassessment.',
      'low'
    );
  }

  if (memory.turn_count > 3 && trust.needs_confirmation) {
    return makeDecision(
      'confirm_state',
      'low',
      'Confirm if they are breathing now.',
      'Turn limit reached while trust still requires confirmation.',
      true
    );
  }

  if (memory.signalsStable && !memory.signalsImproving && decision.step_id === 'reassess') {
    return makeReassessDecision(
      'Confirm if anything has changed right now.',
      'Signals remain stable across turns, so Stitch asks for a fresh check.',
      'low'
    );
  }

  if (memory.confidenceDropping && !decision.needs_confirmation) {
    return makeReassessDecision(
      'Confirm what you see before acting.',
      'Confidence dropped across turns, so confirmation is safer.',
      'low'
    );
  }

  return decision;
};

const decide = (
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
): ProtocolDecision => {
  let decision: ProtocolDecision;

  if (trust.needs_confirmation) {
    decision = makeDecision(
      'confirm_state',
      'low',
      'Confirm if they are breathing.',
      trust.reason,
      true
    );
  } else if (state.severe_bleeding === true) {
    decision = makeDecision(
      'control_bleeding',
      'high',
      'Apply firm pressure to the bleeding now.',
      'Severe bleeding has top priority in the protocol.',
      false
    );
  } else if (state.responsive === false && state.breathing === null) {
    decision = makeDecision(
      'check_breathing',
      'high',
      'Check if the casualty is breathing now.',
      'An unresponsive casualty with unknown breathing outranks camera guidance.',
      false
    );
  } else if (state.person_visible === false) {
    decision = makeDecision(
      'aim_camera',
      'medium',
      'Point the camera at the casualty.',
      'The casualty is not visible enough for scene confirmation.',
      false
    );
  } else if (state.image_quality !== 'usable') {
    decision = makeDecision(
      'improve_view',
      'medium',
      'Hold still and give me a clearer view.',
      'Poor image quality should trigger a better-angle request.',
      false
    );
  } else if (state.confidence < 0.55) {
    decision = makeDecision(
      'confirm_state',
      'low',
      'Confirm if they are breathing and responsive.',
      'Low confidence requires confirmation before a stronger instruction.',
      true
    );
  } else {
    decision = fallbackInstruction(state);
  }

  return applyMemoryGuardrails(decision, state, trust, memory);
};

export const protocolEngine = {
  decide,
};
