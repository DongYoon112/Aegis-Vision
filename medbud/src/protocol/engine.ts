import type {
  CasePhase,
  MergedState,
  NullableBoolean,
  ProtocolDecision,
  ProtocolPriority,
} from './types';
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

const PRIORITY_ORDER: ProtocolPriority[] = ['low', 'medium', 'high', 'critical'];

const isCriticalStep = (stepId: string) =>
  ['control_bleeding', 'check_breathing', 'check_responsive', 'confirm_state'].includes(
    stepId
  );

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

  if (trust.needs_confirmation) {
    return makeDecision(
      'confirm_state',
      'low',
      'Confirm if they are breathing.',
      trust.reason,
      true
    );
  }

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
  const guardedDecision = applyMemoryGuardrails(
    baseDecision,
    normalizedState,
    trust,
    memory,
    phaseChanged
  );

  return applyEscalation(
    guardedDecision,
    baseDecision.priority,
    currentPhase,
    previousPhase,
    memory
  );
};

export const protocolEngine = {
  decide,
};
