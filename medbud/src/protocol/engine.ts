import type {
  ActionSkipReason,
  CasePhase,
  MergedState,
  NullableBoolean,
  ProtocolActionDebug,
  ProtocolDecision,
  ProtocolPriority,
  ProtocolSelectedAction,
} from './types';
import {
  getActionForPromptType,
  getPromptTypeForDecision,
  type PromptType,
} from './decisionMetadata';
import type { TrustAssessment } from './trustTypes';
import type { CooldownStrength, MemoryContext } from '../session/types';

const CONFIRMATION_COOLDOWN_MS = 8000;
const MATERIAL_CONFIDENCE_DELTA = 0.12;
const HIGH_URGENCY_CONFIDENCE = 0.8;
const PERSISTENCE_CYCLES = 2;

const PRIORITY_ORDER: ProtocolPriority[] = ['low', 'medium', 'high', 'critical'];

const ACTION_PRIORITY_ORDER: ProtocolSelectedAction[] = [
  'control_bleeding',
  'airway_or_breathing_support',
  'check_responsiveness',
  'confirm_breathing',
  'confirm_responsiveness',
  'monitoring',
];

const makeDecision = (
  step_id: string,
  priority: ProtocolDecision['priority'],
  instruction: string,
  reason: string,
  needs_confirmation: boolean,
  selectedAction: ProtocolSelectedAction,
  overrides: Partial<ProtocolDecision> = {}
): ProtocolDecision => ({
  step_id,
  priority,
  instruction,
  reason,
  needs_confirmation,
  selectedAction,
  consideredActions: ACTION_PRIORITY_ORDER,
  cooldown_affected: false,
  actionDebug: {
    priorityOrder: ACTION_PRIORITY_ORDER,
    skipped: [],
  },
  prompt_type: needs_confirmation
    ? getPromptTypeForDecision({ step_id, needs_confirmation })
    : null,
  cooldown_suppressed: false,
  ...overrides,
});

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

const getPhaseForSelectedAction = (
  selectedAction: ProtocolSelectedAction
): CasePhase => {
  switch (selectedAction) {
    case 'control_bleeding':
      return 'bleeding_control';
    case 'airway_or_breathing_support':
    case 'confirm_breathing':
      return 'airway_check';
    case 'check_responsiveness':
    case 'confirm_responsiveness':
      return 'initial_assessment';
    case 'monitoring':
      return 'stabilization';
    case 'aim_camera':
    default:
      return 'unknown';
  }
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

const getPromptTypeForSelectedAction = (
  selectedAction: ProtocolSelectedAction
): PromptType | null => {
  switch (selectedAction) {
    case 'confirm_breathing':
      return 'confirm_breathing';
    case 'confirm_responsiveness':
      return 'confirm_responsiveness';
    default:
      return null;
  }
};

const getBasePriorityForSelectedAction = (
  selectedAction: ProtocolSelectedAction
): ProtocolPriority => {
  switch (selectedAction) {
    case 'control_bleeding':
      return 'critical';
    case 'airway_or_breathing_support':
      return 'critical';
    case 'check_responsiveness':
      return 'high';
    case 'confirm_breathing':
    case 'confirm_responsiveness':
      return 'low';
    case 'aim_camera':
      return 'medium';
    case 'monitoring':
    default:
      return 'medium';
  }
};

const getStepIdForSelectedAction = (
  selectedAction: ProtocolSelectedAction
) => {
  switch (selectedAction) {
    case 'control_bleeding':
      return 'control_bleeding';
    case 'airway_or_breathing_support':
      return 'check_breathing';
    case 'check_responsiveness':
      return 'check_responsive';
    case 'confirm_breathing':
    case 'confirm_responsiveness':
      return 'confirm_state';
    case 'aim_camera':
      return 'aim_camera';
    case 'monitoring':
    default:
      return 'reassess';
  }
};

const getInstructionForSelectedAction = (
  selectedAction: ProtocolSelectedAction,
  state: MergedState,
  memory: MemoryContext
) => {
  switch (selectedAction) {
    case 'control_bleeding':
      return 'Apply pressure to the wound now.';
    case 'airway_or_breathing_support':
      return 'Check if they are breathing.';
    case 'check_responsiveness':
      return 'Check if they respond.';
    case 'confirm_breathing':
      return getFollowUpInstruction('check_breathing', state, 2);
    case 'confirm_responsiveness':
      return getFollowUpInstruction('check_responsive', state, 2);
    case 'aim_camera':
      return 'Point the camera at the casualty.';
    case 'monitoring':
    default:
      return getStabilizationInstruction(memory.turn_count);
  }
};

const makeSelectedDecision = (
  selectedAction: ProtocolSelectedAction,
  state: MergedState,
  memory: MemoryContext,
  reason: string,
  actionDebug: ProtocolActionDebug,
  cooldownAffected: boolean,
  overrides: Partial<ProtocolDecision> = {}
): ProtocolDecision => {
  const needsConfirmation =
    selectedAction === 'confirm_breathing' ||
    selectedAction === 'confirm_responsiveness';

  return makeDecision(
    getStepIdForSelectedAction(selectedAction),
    getBasePriorityForSelectedAction(selectedAction),
    getInstructionForSelectedAction(selectedAction, state, memory),
    reason,
    needsConfirmation,
    selectedAction,
    {
      consideredActions: ACTION_PRIORITY_ORDER,
      cooldown_affected: cooldownAffected,
      actionDebug,
      prompt_type: getPromptTypeForSelectedAction(selectedAction),
      cooldown_suppressed: cooldownAffected,
      ...overrides,
    }
  );
};

const addSkippedAction = (
  skipped: ProtocolActionDebug['skipped'],
  action: ProtocolSelectedAction,
  reason: ActionSkipReason
) => {
  skipped.push({ action, reason });
};

const removeSkippedAction = (
  skipped: ProtocolActionDebug['skipped'],
  action: ProtocolSelectedAction
) => skipped.filter((entry) => entry.action !== action);

const evidenceChangedMaterially = (
  promptType: PromptType,
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
) => {
  const action = getActionForPromptType(promptType);
  const field = action ? (action === 'control_bleeding'
    ? 'severe_bleeding'
    : action === 'check_breathing'
      ? 'breathing'
      : 'responsiveness') : null;

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

const isConfirmationSuppressedByCooldown = (
  promptType: PromptType,
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
) => {
  if (memory.lastPromptType !== promptType || memory.lastPromptAt === null) {
    return false;
  }

  const cooldownActive = Date.now() - memory.lastPromptAt < CONFIRMATION_COOLDOWN_MS;
  if (!cooldownActive) {
    return false;
  }

  return evidenceChangedMaterially(promptType, state, trust, memory) === false;
};

const getUrgentBypassReason = (
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
) => {
  if (state.severe_bleeding !== true) {
    return 'severe bleeding is not currently true';
  }

  if (trust.fields.severe_bleeding.confidence < HIGH_URGENCY_CONFIDENCE) {
    return 'bleeding confidence below urgent threshold';
  }

  if (memory.severeBleedingConsecutiveTrueCount < PERSISTENCE_CYCLES) {
    return 'insufficient severe bleeding persistence';
  }

  if (memory.severeBleedingContradictionRecent) {
    return 'recent contradiction blocked bypass';
  }

  if (trust.allowedActions.includes('control_bleeding') === false) {
    return 'control bleeding is not currently allowed';
  }

  return 'persistent high-confidence severe bleeding forced control bleeding';
};

const maybeSelectUrgentBleedingBypass = (
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
): ProtocolDecision | null => {
  const actionDebug: ProtocolActionDebug = {
    priorityOrder: ACTION_PRIORITY_ORDER,
    skipped: [],
  };
  const urgentBypassReason = getUrgentBypassReason(state, trust, memory);

  if (
    state.severe_bleeding === true &&
    trust.fields.severe_bleeding.confidence >= HIGH_URGENCY_CONFIDENCE &&
    memory.severeBleedingConsecutiveTrueCount >= PERSISTENCE_CYCLES &&
    memory.severeBleedingContradictionRecent === false &&
    trust.allowedActions.includes('control_bleeding')
  ) {
    for (const trailingAction of ACTION_PRIORITY_ORDER.slice(1)) {
      addSkippedAction(actionDebug.skipped, trailingAction, 'urgent_bypass_triggered');
    }

    return makeSelectedDecision(
      'control_bleeding',
      state,
      memory,
      'Urgent bypass forced control bleeding after persistent high-confidence severe bleeding.',
      actionDebug,
      false,
      {
        urgent_bypass_activated: true,
        urgent_bypass_reason: urgentBypassReason,
        urgent_bypass_confidence: trust.fields.severe_bleeding.confidence,
        urgent_bypass_persistence_count: memory.severeBleedingConsecutiveTrueCount,
        urgent_bypass_contradiction_blocked: false,
      }
    );
  }

  const skipReason: ActionSkipReason =
    state.severe_bleeding !== true
      ? 'not_allowed'
      : trust.fields.severe_bleeding.confidence < HIGH_URGENCY_CONFIDENCE
        ? 'confidence_below_urgent_threshold'
        : memory.severeBleedingConsecutiveTrueCount < PERSISTENCE_CYCLES
          ? 'insufficient_persistence'
          : memory.severeBleedingContradictionRecent
            ? 'recent_contradiction'
            : 'control_bleeding_not_allowed';

  addSkippedAction(actionDebug.skipped, 'control_bleeding', skipReason);

  return null;
};

const selectAction = (
  state: MergedState,
  trust: TrustAssessment,
  memory: MemoryContext
) => {
  const urgentBypassDecision = maybeSelectUrgentBleedingBypass(state, trust, memory);
  if (urgentBypassDecision) {
    return urgentBypassDecision;
  }

  const actionDebug: ProtocolActionDebug = {
    priorityOrder: ACTION_PRIORITY_ORDER,
    skipped: [
      {
        action: 'control_bleeding',
        reason:
          state.severe_bleeding !== true
            ? 'not_allowed'
            : trust.fields.severe_bleeding.confidence < HIGH_URGENCY_CONFIDENCE
              ? 'confidence_below_urgent_threshold'
              : memory.severeBleedingConsecutiveTrueCount < PERSISTENCE_CYCLES
                ? 'insufficient_persistence'
                : memory.severeBleedingContradictionRecent
                  ? 'recent_contradiction'
                  : 'control_bleeding_not_allowed',
      },
    ],
  };
  let cooldownAffected = false;

  for (const action of ACTION_PRIORITY_ORDER) {
    switch (action) {
      case 'control_bleeding':
        if (
          state.severe_bleeding === true &&
          trust.allowedActions.includes('control_bleeding')
        ) {
          actionDebug.skipped = removeSkippedAction(actionDebug.skipped, action);
          const decision = makeSelectedDecision(
            action,
            state,
            memory,
            'Severe bleeding action is allowed and highest priority.',
            actionDebug,
            cooldownAffected,
            {
              urgent_bypass_activated: false,
              urgent_bypass_reason: getUrgentBypassReason(state, trust, memory),
              urgent_bypass_confidence: trust.fields.severe_bleeding.confidence,
              urgent_bypass_persistence_count: memory.severeBleedingConsecutiveTrueCount,
              urgent_bypass_contradiction_blocked:
                memory.severeBleedingContradictionRecent,
            }
          );
          for (const trailingAction of ACTION_PRIORITY_ORDER.slice(
            ACTION_PRIORITY_ORDER.indexOf(action) + 1
          )) {
            addSkippedAction(
              actionDebug.skipped,
              trailingAction,
              'severe_bleeding_override'
            );
          }
          return decision;
        }

        break;
      case 'airway_or_breathing_support':
        if (trust.allowedActions.includes('check_breathing')) {
          const decision = makeSelectedDecision(
            action,
            state,
            memory,
            'Breathing support is the highest-priority allowed action.',
            actionDebug,
            cooldownAffected
          );
          for (const trailingAction of ACTION_PRIORITY_ORDER.slice(
            ACTION_PRIORITY_ORDER.indexOf(action) + 1
          )) {
            addSkippedAction(actionDebug.skipped, trailingAction, 'lower_priority_than_selected');
          }
          return decision;
        }

        addSkippedAction(actionDebug.skipped, action, 'not_allowed');
        break;
      case 'check_responsiveness':
        if (trust.allowedActions.includes('check_responsive')) {
          const decision = makeSelectedDecision(
            action,
            state,
            memory,
            'Responsiveness check is the highest-priority allowed action.',
            actionDebug,
            cooldownAffected
          );
          for (const trailingAction of ACTION_PRIORITY_ORDER.slice(
            ACTION_PRIORITY_ORDER.indexOf(action) + 1
          )) {
            addSkippedAction(actionDebug.skipped, trailingAction, 'lower_priority_than_selected');
          }
          return decision;
        }

        addSkippedAction(actionDebug.skipped, action, 'not_allowed');
        break;
      case 'confirm_breathing':
        if (!trust.fields.breathing.needsConfirmation) {
          addSkippedAction(
            actionDebug.skipped,
            action,
            'field_does_not_need_confirmation'
          );
          break;
        }

        if (
          isConfirmationSuppressedByCooldown(
            'confirm_breathing',
            state,
            trust,
            memory
          )
        ) {
          cooldownAffected = true;
          addSkippedAction(actionDebug.skipped, action, 'cooldown');
          break;
        }

        {
          const decision = makeSelectedDecision(
            action,
            state,
            memory,
            'Breathing needs confirmation and no higher-priority action is allowed.',
            actionDebug,
            cooldownAffected
          );
          for (const trailingAction of ACTION_PRIORITY_ORDER.slice(
            ACTION_PRIORITY_ORDER.indexOf(action) + 1
          )) {
            addSkippedAction(actionDebug.skipped, trailingAction, 'lower_priority_than_selected');
          }
          return decision;
        }
      case 'confirm_responsiveness':
        if (!trust.fields.responsiveness.needsConfirmation) {
          addSkippedAction(
            actionDebug.skipped,
            action,
            'field_does_not_need_confirmation'
          );
          break;
        }

        if (
          isConfirmationSuppressedByCooldown(
            'confirm_responsiveness',
            state,
            trust,
            memory
          )
        ) {
          cooldownAffected = true;
          addSkippedAction(actionDebug.skipped, action, 'cooldown');
          break;
        }

        {
          const decision = makeSelectedDecision(
            action,
            state,
            memory,
            'Responsiveness needs confirmation and no higher-priority action is allowed.',
            actionDebug,
            cooldownAffected
          );
          for (const trailingAction of ACTION_PRIORITY_ORDER.slice(
            ACTION_PRIORITY_ORDER.indexOf(action) + 1
          )) {
            addSkippedAction(actionDebug.skipped, trailingAction, 'lower_priority_than_selected');
          }
          return decision;
        }
      case 'monitoring':
      default: {
        return makeSelectedDecision(
          'monitoring',
          state,
          memory,
          'No higher-priority allowed action is available.',
          actionDebug,
          cooldownAffected
        );
      }
    }
  }

  return makeSelectedDecision(
    'monitoring',
    state,
    memory,
    'No higher-priority allowed action is available.',
    actionDebug,
    cooldownAffected
  );
};

const makeFollowUpDecision = (
  decision: ProtocolDecision,
  state: MergedState,
  memory: MemoryContext,
  reason: string
) => {
  const promptAction = getActionForPromptType(decision.prompt_type ?? null);
  const instructionStep =
    decision.step_id === 'confirm_state' && promptAction ? promptAction : decision.step_id;

  return {
    ...decision,
    step_id: `${decision.step_id}_follow_up`,
    instruction: getFollowUpInstruction(
      instructionStep,
      state,
      getFollowUpTier(memory.turn_count)
    ),
    reason,
    needs_confirmation: true,
  };
};

const makeMonitoringDecision = (
  instruction: string,
  reason: string,
  baseDecision: ProtocolDecision
) => ({
  ...baseDecision,
  step_id: 'reassess',
  selectedAction: 'monitoring' as const,
  instruction,
  reason,
  needs_confirmation: true,
  prompt_type: null,
});

const isCriticalStep = (stepId: string) =>
  ['control_bleeding', 'check_breathing', 'check_responsive', 'confirm_state'].includes(
    stepId
  );

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
  const urgentBleedingBypassActive = decision.urgent_bypass_activated === true;

  if (memory.signalsImproving && !urgentBleedingBypassActive) {
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
    (memory.signalsStable && repeatStrength !== 'none');

  if (repeatStrength !== 'none') {
    if (decision.needs_confirmation || isCriticalStep(decision.step_id)) {
      return makeFollowUpDecision(
        decision,
        state,
        memory,
        repeatStrength === 'strong'
          ? 'Immediate repeat converted into a follow-up check.'
          : 'Repeated high-priority action converted into a follow-up check.'
      );
    }

    if (urgentBleedingBypassActive && decision.selectedAction === 'control_bleeding') {
      return {
        ...decision,
        reason: 'Urgent bypass kept bleeding control active despite repeated cycles.',
      };
    }

    if (confirmationBias || memory.signalsStable) {
      return makeMonitoringDecision(
        'Confirm what you see before the next step.',
        'Repeated non-critical step with stable or less reliable signals.',
        decision
      );
    }

    return makeMonitoringDecision(
      'Give me a quick update on their condition now.',
      'Repeated non-critical step converted into reassessment.',
      decision
    );
  }

  if (memory.signalsStable && !memory.signalsImproving && decision.selectedAction === 'monitoring') {
    return makeMonitoringDecision(
      'Confirm if anything has changed right now.',
      'Signals remain stable across turns, so Stitch asks for a fresh check.',
      decision
    );
  }

  if (
    memory.confidenceDropping &&
    !decision.needs_confirmation &&
    decision.selectedAction !== 'control_bleeding' &&
    !urgentBleedingBypassActive
  ) {
    return makeMonitoringDecision(
      'Confirm what you see before acting.',
      'Confidence dropped across turns, so monitoring is safer.',
      decision
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
  phase: CasePhase,
  previousPhase: CasePhase | null,
  memory: MemoryContext
): ProtocolDecision => {
  if (decision.step_id === 'confirm_state') {
    return {
      ...decision,
      priority: clampPriority(decision.priority, getBasePriorityForSelectedAction(decision.selectedAction)),
    };
  }

  const basePriority = getBasePriorityForSelectedAction(decision.selectedAction);
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
      false,
      'aim_camera',
      {
        actionDebug: {
          priorityOrder: ACTION_PRIORITY_ORDER,
          skipped: [],
        },
      }
    );
  }

  const previousPhase = getPreviousPhase(memory);
  const selectedDecision = selectAction(normalizedState, trust, memory);
  const currentPhase = getPhaseForSelectedAction(selectedDecision.selectedAction);
  const phaseChanged =
    previousPhase !== null && currentPhase !== previousPhase;
  const guardedDecision = applyMemoryGuardrails(
    selectedDecision,
    normalizedState,
    trust,
    memory,
    phaseChanged
  );

  if (guardedDecision.urgent_bypass_activated !== true) {
    guardedDecision.urgent_bypass_activated = false;
    guardedDecision.urgent_bypass_reason =
      guardedDecision.urgent_bypass_reason ??
      getUrgentBypassReason(normalizedState, trust, memory);
    guardedDecision.urgent_bypass_confidence =
      guardedDecision.urgent_bypass_confidence ??
      trust.fields.severe_bleeding.confidence;
    guardedDecision.urgent_bypass_persistence_count =
      guardedDecision.urgent_bypass_persistence_count ??
      memory.severeBleedingConsecutiveTrueCount;
    guardedDecision.urgent_bypass_contradiction_blocked =
      guardedDecision.urgent_bypass_contradiction_blocked ??
      memory.severeBleedingContradictionRecent;
  }

  return applyEscalation(
    guardedDecision,
    getPhaseForSelectedAction(guardedDecision.selectedAction),
    previousPhase,
    memory
  );
};

export const protocolEngine = {
  decide,
};
