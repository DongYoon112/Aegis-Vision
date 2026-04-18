import type {
  CasePhase,
  MergedState,
  NullableBoolean,
  ProtocolDecision,
  ProtocolPriority,
} from './types';
import {
  getActionForPromptType,
  getFieldForAction,
  getPromptTypeForDecision,
  getPromptTypeForField,
} from './decisionMetadata';
import type { TrustAssessment } from './trustTypes';
import type { CooldownStrength, MemoryContext } from '../session/types';

const CONFIRMATION_COOLDOWN_MS = 8000;
const MATERIAL_CONFIDENCE_DELTA = 0.12;

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
  prompt_type: needs_confirmation ? getPromptTypeForDecision({ step_id, needs_confirmation }) : null,
  cooldown_suppressed: false,
});

const PRIORITY_ORDER: ProtocolPriority[] = ['low', 'medium', 'high', 'critical'];

const isCriticalStep = (stepId: string) =>
  ['control_bleeding', 'check_breathing', 'check_responsive', 'confirm_state'].includes(
    stepId
  );

const getFallbackPromptType = (
  state: MergedState,
  trust: TrustAssessment
) => {
  if (trust.fields.severe_bleeding.needsConfirmation && state.severe_bleeding !== false) {
    return 'confirm_bleeding';
  }

  if (trust.fields.breathing.needsConfirmation) {
    return 'confirm_breathing';
  }

  if (trust.fields.responsiveness.needsConfirmation) {
    return 'confirm_responsiveness';
  }

  return null;
};

const normalizeNullableBoolean = (value: NullableBoolean | 'unknown' | unknown): NullableBoolean =>
  value === true || value === false ? value : null;

const normalizeState = (state: MergedState): MergedState => ({
  ...state,
  responsive: normalizeNullableBoolean(state.responsive as NullableBoolean | 'unknown'),
  breathing: normalizeNullableBoolean(state.breathing as NullableBoolean | 'unknown'),
  severe_bleeding: normalizeNullableBoolean(
    state.severe_bleeding as NullableBoolean | 'unknown'
  ),
});

const getPriorityIndex = (priority: ProtocolPriority) =>
  PRIORITY_ORDER.indexOf(priority);

const clampPriority = (
  priority: ProtocolPriority,
  basePriority: ProtocolPriority
): ProtocolPriority => {
  const clampedIndex = Math.max(
    getPriorityIndex(basePriority),
    Math.min(getPriorityIndex(priority), getPriorityIndex('critical'))
  );

  return PRIORITY_ORDER[clampedIndex];
};

const escalatePriority = (
  basePriority: ProtocolPriority,
  steps: 0 | 1 | 2
): ProtocolPriority => {
  const baseIndex = getPriorityIndex(basePriority);
  const escalatedIndex = Math.min(baseIndex + steps, getPriorityIndex('critical'));
  return PRIORITY_ORDER[escalatedIndex];
};

const getPhaseForStep = (stepId: string | null): CasePhase | null => {
  if (!stepId) {
    return null;
  }

  if (stepId.startsWith('control_bleeding')) {
    return 'bleeding_control';
  }

  if (stepId.startsWith('check_breathing')) {
    return 'airway_check';
  }

  if (stepId.startsWith('check_responsive')) {
    return 'initial_assessment';
  }

  if (stepId.startsWith('reassess')) {
    return 'stabilization';
  }

  return null;
};

const getPreviousPhase = (memory: MemoryContext): CasePhase | null => {
  const lastPhase = getPhaseForStep(memory.last_step_id);
  if (lastPhase) {
    return lastPhase;
  }

  for (let index = memory.recent_steps.length - 1; index >= 0; index -= 1) {
    const phase = getPhaseForStep(memory.recent_steps[index] ?? null);
    if (phase) {
      return phase;
    }
  }

  return null;
};

const getStabilizationInstruction = (turnCount: number) => {
  if (turnCount <= 1) {
    return 'Reassess their condition now.';
  }

  if (turnCount === 2) {
    return 'Check their condition again.';
  }

  return 'Monitor their condition.';
};

const determinePhase = (state: MergedState, previousPhase: CasePhase | null): CasePhase => {
  if (state.severe_bleeding === true) {
    return 'bleeding_control';
  }

  if (previousPhase === 'bleeding_control' && state.severe_bleeding !== false) {
    return 'bleeding_control';
  }

  if (previousPhase === 'bleeding_control' && state.severe_bleeding === false) {
    return 'airway_check';
  }

  if (state.breathing === null) {
    return 'airway_check';
  }

  if (previousPhase === 'airway_check' && state.breathing !== true) {
    return 'airway_check';
  }

  if (previousPhase === 'airway_check' && state.breathing === true) {
    return 'stabilization';
  }

  if (state.responsive === null) {
    return 'initial_assessment';
  }

  if (
    previousPhase === 'initial_assessment' &&
    state.responsive === null &&
    state.breathing !== null
  ) {
    return 'initial_assessment';
  }

  return 'stabilization';
};

const getBaseDecisionForPhase = (
  phase: CasePhase,
  state: MergedState,
  memory: MemoryContext
): ProtocolDecision => {
  switch (phase) {
    case 'bleeding_control':
      return makeDecision(
        'control_bleeding',
        'critical',
        'Apply pressure to the wound now.',
        'Severe bleeding requires immediate bleeding control.',
        false
      );
    case 'airway_check':
      return makeDecision(
        'check_breathing',
        'critical',
        'Check if they are breathing.',
        'Breathing status is the next priority once bleeding is controlled or absent.',
        false
      );
    case 'initial_assessment':
      return makeDecision(
        'check_responsive',
        'high',
        'Check if they respond.',
        'Responsiveness should be checked before moving into stabilization.',
        false
      );
    case 'stabilization':
      return makeDecision(
        'reassess',
        'medium',
        getStabilizationInstruction(memory.turn_count),
        'Stabilization requires repeated condition checks.',
        false
      );
    default:
      return makeDecision(
        'reassess',
        'medium',
        getStabilizationInstruction(memory.turn_count),
        'Fallback stabilization guidance when the case phase is unclear.',
        false
      );
  }
};

const shouldUseVisibilityOverride = (state: MergedState) =>
  state.image_quality === 'usable' &&
  state.person_visible === false &&
  state.severe_bleeding === null &&
  state.breathing === null;

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
  reason: string,
  promptType: ProtocolDecision['prompt_type'] = null
) => {
  const promptAction = getActionForPromptType(promptType ?? null);
  const instructionStep =
    stepId === 'confirm_state' && promptAction ? promptAction : stepId;

  return {
    ...makeDecision(
      `${stepId}_follow_up`,
      stepId === 'control_bleeding' || stepId === 'check_breathing' ? 'high' : 'low',
      getFollowUpInstruction(instructionStep, state, getFollowUpTier(memory.turn_count)),
      reason,
      true
    ),
    prompt_type:
      promptType ??
      getPromptTypeForDecision({
        step_id: `${stepId}_follow_up`,
        needs_confirmation: true,
      }),
  };
};

const makeReassessDecision = (
  instruction: string,
  reason: string,
  priority: ProtocolDecision['priority'] = 'low'
) => makeDecision('reassess', priority, instruction, reason, true);

const getConfirmationDecision = (
  promptType: NonNullable<ProtocolDecision['prompt_type']>,
  state: MergedState,
  reason: string
): ProtocolDecision => {
  switch (promptType) {
    case 'confirm_bleeding':
      return {
        ...makeDecision(
          'control_bleeding',
          'high',
          getFollowUpInstruction('control_bleeding', state, 2),
          reason,
          true
        ),
        prompt_type: promptType,
      };
    case 'confirm_breathing':
      return {
        ...makeDecision(
          'confirm_state',
          'low',
          getFollowUpInstruction('check_breathing', state, 2),
          reason,
          true
        ),
        prompt_type: promptType,
      };
    case 'confirm_responsiveness':
      return {
        ...makeDecision(
          'confirm_state',
          'low',
          getFollowUpInstruction('check_responsive', state, 2),
          reason,
          true
        ),
        prompt_type: promptType,
      };
    default:
      return {
        ...makeDecision(
          'confirm_state',
          'low',
          'Confirm what you see now.',
          reason,
          true
        ),
        prompt_type: promptType,
      };
  }
};

const maybeConvertBlockedDecision = (
  decision: ProtocolDecision,
  state: MergedState,
  trust: TrustAssessment
): ProtocolDecision => {
  const field = getFieldForAction(decision.step_id);

  if (!field || trust.allowedActions.includes(decision.step_id)) {
    return decision;
  }

  if (trust.blockedActions.includes(decision.step_id) === false) {
    return decision;
  }

  const promptType = getPromptTypeForField(field);
  if (!promptType) {
    return decision;
  }

  return getConfirmationDecision(promptType, state, trust.fields[field].reason);
};

const evidenceChangedMaterially = (
  promptType: NonNullable<ProtocolDecision['prompt_type']>,
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
) => {
  const action = getActionForPromptType(promptType);
  const field = getFieldForAction(action ?? '');

  if (!field) {
    return false;
  }

  const currentValue =
    field === 'severe_bleeding'
      ? state.severe_bleeding
      : field === 'breathing'
        ? state.breathing
        : state.responsive;
  const previousValue =
    field === 'severe_bleeding'
      ? memory.recent_signals.bleeding
      : field === 'breathing'
        ? memory.recent_signals.breathing
        : memory.recent_signals.responsive;

  if (currentValue !== previousValue) {
    return true;
  }

  return (
    Math.abs(trust.fields[field].confidence - memory.lastFieldConfidences[field]) >=
    MATERIAL_CONFIDENCE_DELTA
  );
};

const applyConfirmationCooldown = (
  decision: ProtocolDecision,
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
): ProtocolDecision => {
  const promptType = decision.prompt_type ?? getPromptTypeForDecision(decision);

  if (!promptType || memory.lastPromptType !== promptType || memory.lastPromptAt === null) {
    return decision;
  }

  const cooldownActive = Date.now() - memory.lastPromptAt < CONFIRMATION_COOLDOWN_MS;
  if (!cooldownActive || evidenceChangedMaterially(promptType, state, trust, memory)) {
    return decision;
  }

  const action = getActionForPromptType(promptType);
  if (action && trust.allowedActions.includes(action)) {
    return {
      ...makeDecision(
        action,
        decision.priority,
        action === 'control_bleeding'
          ? 'Apply pressure to the wound now.'
          : action === 'check_breathing'
            ? 'Check if they are breathing.'
            : 'Check if they respond.',
        'Confirmation prompt suppressed during cooldown; keeping the allowed field action.',
        false
      ),
      cooldown_suppressed: true,
      prompt_type: promptType,
    };
  }

  return {
    ...makeReassessDecision(
      'Give me a quick update on their condition now.',
      'Repeated confirmation prompt suppressed during cooldown.',
      'low'
    ),
    cooldown_suppressed: true,
    prompt_type: promptType,
  };
};

const applyMemoryGuardrails = (
  decision: ProtocolDecision,
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext,
  phaseChanged: boolean
): ProtocolDecision => {
  if (phaseChanged) {
    return decision;
  }

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
    decision.needs_confirmation ||
    memory.confidenceDropping ||
    (memory.turn_count > 3 && trust.blockedActions.length > 0) ||
    (memory.signalsStable && repeatStrength !== 'none');

  if (repeatStrength !== 'none') {
    if (isCriticalStep(decision.step_id)) {
      return makeFollowUpDecision(
        decision.step_id,
        state,
        memory,
        repeatStrength === 'strong'
          ? 'Immediate repeat converted into a follow-up check.'
          : 'Repeated critical step converted into a follow-up check.',
        decision.prompt_type ?? getPromptTypeForDecision(decision)
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

  if (memory.turn_count > 3 && trust.blockedActions.length > 0) {
    const promptType = getFallbackPromptType(state, trust);
    if (promptType) {
      return getConfirmationDecision(
        promptType,
        state,
        'Turn limit reached while a field still needs confirmation.'
      );
    }
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

const getEscalationSteps = (
  currentPhase: CasePhase,
  previousPhase: CasePhase | null,
  memory: MemoryContext
): 0 | 1 | 2 => {
  if (currentPhase === 'unknown') {
    return 0;
  }

  let steps = 0;

  if (previousPhase !== null && previousPhase === currentPhase) {
    steps += 1;
  }

  if (memory.confidenceDropping) {
    steps += 1;
  }

  return Math.min(steps, 2) as 0 | 1 | 2;
};

const getEscalatedInstruction = (
  decision: ProtocolDecision,
  phase: CasePhase,
  escalationSteps: 0 | 1 | 2
) => {
  if (escalationSteps === 0 || decision.step_id === 'confirm_state') {
    return decision.instruction;
  }

  if (decision.step_id.startsWith('aim_camera')) {
    return 'Point the camera at them now.';
  }

  switch (phase) {
    case 'bleeding_control':
      return 'Apply pressure now.';
    case 'airway_check':
      return 'Check breathing now.';
    case 'initial_assessment':
      return 'Check responsiveness now.';
    case 'stabilization':
      return 'Reassess now.';
    default:
      return decision.instruction;
  }
};

const applyEscalation = (
  decision: ProtocolDecision,
  basePriority: ProtocolPriority,
  phase: CasePhase,
  previousPhase: CasePhase | null,
  memory: MemoryContext
): ProtocolDecision => {
  if (decision.step_id === 'confirm_state') {
    return {
      ...decision,
      priority: clampPriority(decision.priority, basePriority),
    };
  }

  const escalationSteps = getEscalationSteps(phase, previousPhase, memory);
  const escalatedPriority = clampPriority(
    escalatePriority(basePriority, escalationSteps),
    basePriority
  );

  return {
    ...decision,
    priority: clampPriority(escalatedPriority, basePriority),
    instruction: getEscalatedInstruction(decision, phase, escalationSteps),
  };
};

const decide = (
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
): ProtocolDecision => {
  const normalizedState = normalizeState(state);

  if (shouldUseVisibilityOverride(normalizedState)) {
    return makeDecision(
      'aim_camera',
      'medium',
      'Point the camera at the casualty.',
      'No usable core signals are available because the casualty is not visible.',
      false
    );
  }

  const previousPhase = getPreviousPhase(memory);
  const currentPhase = determinePhase(normalizedState, previousPhase);
  const phaseChanged =
    previousPhase !== null && currentPhase !== previousPhase;

  const baseDecision = getBaseDecisionForPhase(currentPhase, normalizedState, memory);
  const fieldAwareDecision = maybeConvertBlockedDecision(baseDecision, normalizedState, trust);
  const guardedDecision = applyMemoryGuardrails(
    fieldAwareDecision,
    normalizedState,
    trust,
    memory,
    phaseChanged
  );

  const narrowedDecision =
    (guardedDecision.prompt_type ?? getPromptTypeForDecision(guardedDecision)) === null &&
    trust.allowedActions.length === 0 &&
    trust.blockedActions.length > 0
      ? getConfirmationDecision(
          getFallbackPromptType(normalizedState, trust) ?? 'confirm_breathing',
          normalizedState,
          trust.reason
        )
      : guardedDecision;

  const cooldownAwareDecision = applyConfirmationCooldown(
    narrowedDecision,
    normalizedState,
    trust,
    memory
  );

  return applyEscalation(
    cooldownAwareDecision,
    baseDecision.priority,
    currentPhase,
    previousPhase,
    memory
  );
};

export const protocolEngine = {
  decide,
};
