import { clampConfidence, type MergedState, type ProtocolDecision } from '../protocol/types';
import {
  getActionForPromptType,
  getFieldForAction,
  getPromptTypeForDecision,
} from '../protocol/decisionMetadata';
import type { TrustAssessment } from '../protocol/trustTypes';
import type {
  BleedingObservation,
  FieldObservation,
  MemoryContext,
  RecentSignals,
  RecoveryFieldState,
  SessionMemory,
  SignalSnapshot,
} from './types';

const RECENT_STEPS_LIMIT = 4;
const SIGNAL_HISTORY_LIMIT = 2;
const BLEEDING_OBSERVATION_LIMIT = 4;
const RECOVERY_OBSERVATION_LIMIT = 3;
const HIGH_URGENCY_CONFIDENCE = 0.8;
const RECOVERY_CONFIDENCE_THRESHOLD = 0.6;

const SIGNAL_QUALITY_MULTIPLIER: Record<TrustAssessment['signal_quality'], number> = {
  high: 1,
  medium: 0.8,
  low: 0.5,
};

const toSignalSnapshot = (
  memorySignals: RecentSignals,
  state: MergedState
): SignalSnapshot => ({
  bleeding:
    state.severe_bleeding !== null ? state.severe_bleeding : memorySignals.bleeding,
  responsive: state.responsive !== null ? state.responsive : memorySignals.responsive,
  breathing: state.breathing !== null ? state.breathing : memorySignals.breathing,
});

const getSignalSimilarity = (
  previous: SignalSnapshot | null,
  current: SignalSnapshot | null
) => {
  if (!previous || !current) {
    return 0;
  }

  const values: Array<keyof SignalSnapshot> = ['bleeding', 'responsive', 'breathing'];
  const total = values.reduce((score, key) => {
    const prev = previous[key];
    const next = current[key];

    if (prev === next) {
      return score + 1;
    }

    if (prev === null || next === null) {
      return score + 0.5;
    }

    return score;
  }, 0);

  return total / values.length;
};

const getProgressScore = (previous: RecentSignals, current: SignalSnapshot) => {
  let score = 0;

  if (previous.bleeding === true && current.bleeding === false) {
    score += 1;
  } else if (previous.bleeding === false && current.bleeding === true) {
    score -= 1;
  }

  if (previous.responsive === false && current.responsive === true) {
    score += 1;
  } else if (previous.responsive === true && current.responsive === false) {
    score -= 1;
  }

  if (
    (previous.breathing === false || previous.breathing === null) &&
    current.breathing === true
  ) {
    score += 1;
  } else if (
    previous.breathing === true &&
    (current.breathing === false || current.breathing === null)
  ) {
    score -= 1;
  }

  return score;
};

const getBleedingObservation = (
  state: MergedState,
  trust: TrustAssessment
): BleedingObservation => ({
  value: state.severe_bleeding,
  confidence: trust.fields.severe_bleeding.confidence,
});

const getSevereBleedingConsecutiveTrueCount = (
  observations: BleedingObservation[]
) => {
  let count = 0;

  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (observations[index]?.value === true) {
      count += 1;
      continue;
    }

    break;
  }

  return count;
};

const hasRecentBleedingContradiction = (
  observations: BleedingObservation[],
  trust: TrustAssessment
) =>
  observations.some(
    (observation) =>
      observation.value === false && observation.confidence >= HIGH_URGENCY_CONFIDENCE
  ) || trust.fields.severe_bleeding.reason.includes('disagree');

const createInitialRecoveryFieldState = (): RecoveryFieldState => ({
  recentObservations: [],
  stableCycleCount: 0,
  confirmationNeededLastCycle: false,
  confirmationRecentlyCleared: false,
  lastConfirmationClearedAt: null,
  recoveryReason: '',
});

const getRecoveryObservation = (
  field: 'breathing' | 'responsiveness',
  state: MergedState,
  trust: TrustAssessment
): FieldObservation => ({
  value: field === 'breathing' ? state.breathing : state.responsive,
  confidence: trust.fields[field].confidence,
});

const getNextRecoveryFieldState = (
  field: 'breathing' | 'responsiveness',
  previous: RecoveryFieldState,
  state: MergedState,
  trust: TrustAssessment
): RecoveryFieldState => {
  const observation = getRecoveryObservation(field, state, trust);
  const recentObservations = [...previous.recentObservations, observation].slice(
    -RECOVERY_OBSERVATION_LIMIT
  );
  const qualifiesForRecovery =
    observation.value !== null &&
    observation.confidence >= RECOVERY_CONFIDENCE_THRESHOLD &&
    trust.fields[field].needsConfirmation === false;
  const previousObservation =
    previous.recentObservations[previous.recentObservations.length - 1] ?? null;
  const stableCycleCount = qualifiesForRecovery
    ? previousObservation?.value === observation.value && previous.stableCycleCount > 0
      ? previous.stableCycleCount + 1
      : 1
    : 0;
  const confirmationRecentlyCleared =
    previous.confirmationNeededLastCycle &&
    qualifiesForRecovery &&
    stableCycleCount >= 1;
  const recoveryReason = confirmationRecentlyCleared
    ? `${field} confirmation cleared after stable higher-confidence evidence.`
    : !qualifiesForRecovery
      ? observation.value === null
        ? `${field} is still unknown.`
        : trust.fields[field].needsConfirmation
          ? `${field} still needs confirmation.`
          : `${field} confidence is still recovering.`
      : `${field} is stable and no longer needs confirmation.`;

  return {
    recentObservations,
    stableCycleCount,
    confirmationNeededLastCycle: trust.fields[field].needsConfirmation,
    confirmationRecentlyCleared,
    lastConfirmationClearedAt: confirmationRecentlyCleared
      ? Date.now()
      : previous.lastConfirmationClearedAt,
    recoveryReason,
  };
};

const getNextFieldRecoveryState = (
  memory: SessionMemory,
  state: MergedState,
  trust: TrustAssessment
) => ({
  breathing: getNextRecoveryFieldState(
    'breathing',
    memory.fieldRecovery.breathing,
    state,
    trust
  ),
  responsiveness: getNextRecoveryFieldState(
    'responsiveness',
    memory.fieldRecovery.responsiveness,
    state,
    trust
  ),
});

export const createInitialSessionMemory = (): SessionMemory => ({
  last_step_id: null,
  last_instruction: null,
  last_confidence: null,
  recent_steps: [],
  recent_signals: {
    bleeding: null,
    responsive: null,
    breathing: null,
  },
  turn_count: 0,
  signal_history: [],
  lastPromptType: null,
  lastPromptAt: null,
  lastFieldConfidences: {
    breathing: 0,
    severe_bleeding: 0,
    responsiveness: 0,
  },
  recentBleedingObservations: [],
  severeBleedingConsecutiveTrueCount: 0,
  severeBleedingContradictionRecent: false,
  lastHighUrgencyAt: null,
  fieldRecovery: {
    breathing: createInitialRecoveryFieldState(),
    responsiveness: createInitialRecoveryFieldState(),
  },
});

export const buildMemoryContext = (
  memory: SessionMemory,
  state: MergedState,
  trust: TrustAssessment
): MemoryContext => {
  const effectiveConfidence = clampConfidence(
    state.confidence *
      trust.agreement *
      SIGNAL_QUALITY_MULTIPLIER[trust.signal_quality],
    0
  );

  const currentSnapshot = toSignalSnapshot(memory.recent_signals, state);
  const previousSnapshot = memory.signal_history[memory.signal_history.length - 1] ?? null;
  const similarity = getSignalSimilarity(previousSnapshot, currentSnapshot);
  const confidenceDelta =
    memory.last_confidence === null
      ? 0
      : effectiveConfidence - memory.last_confidence;
  const bleedingObservation = getBleedingObservation(state, trust);
  const recentBleedingObservations = [
    ...memory.recentBleedingObservations,
    bleedingObservation,
  ].slice(-BLEEDING_OBSERVATION_LIMIT);
  const severeBleedingConsecutiveTrueCount = getSevereBleedingConsecutiveTrueCount(
    recentBleedingObservations
  );
  const severeBleedingContradictionRecent = hasRecentBleedingContradiction(
    recentBleedingObservations,
    trust
  );
  const urgentBypassEligible =
    state.severe_bleeding === true &&
    trust.fields.severe_bleeding.confidence >= HIGH_URGENCY_CONFIDENCE &&
    severeBleedingConsecutiveTrueCount >= 2 &&
    severeBleedingContradictionRecent === false;
  const urgentBypassReason =
    severeBleedingContradictionRecent
      ? 'recent contradiction blocked bypass'
      : state.severe_bleeding !== true
        ? 'severe bleeding is not currently true'
        : trust.fields.severe_bleeding.confidence < HIGH_URGENCY_CONFIDENCE
          ? 'bleeding confidence below urgent threshold'
          : severeBleedingConsecutiveTrueCount < 2
            ? 'insufficient severe bleeding persistence'
            : 'persistent high-confidence severe bleeding';
  const fieldRecovery = getNextFieldRecoveryState(memory, state, trust);

  return {
    last_step_id: memory.last_step_id,
    recent_steps: [...memory.recent_steps],
    recent_signals: { ...memory.recent_signals },
    turn_count: memory.turn_count + 1,
    effectiveConfidence,
    confidenceDelta,
    confidenceDropping: confidenceDelta < -0.15,
    similarity,
    signalsStable: similarity > 0.7,
    signalsImproving: getProgressScore(memory.recent_signals, currentSnapshot) > 0,
    lastPromptType: memory.lastPromptType,
    lastPromptAt: memory.lastPromptAt,
    lastFieldConfidences: { ...memory.lastFieldConfidences },
    confirmationCooldownActive: false,
    confirmationPromptSuppressed: false,
    suppressedPromptType: null,
    recentBleedingObservations,
    severeBleedingConsecutiveTrueCount,
    severeBleedingContradictionRecent,
    lastHighUrgencyAt: memory.lastHighUrgencyAt,
    urgentBypassEligible,
    urgentBypassReason,
    urgentBypassConfidence: trust.fields.severe_bleeding.confidence,
    breathingStableCycleCount: fieldRecovery.breathing.stableCycleCount,
    responsivenessStableCycleCount: fieldRecovery.responsiveness.stableCycleCount,
    breathingRecovered:
      fieldRecovery.breathing.stableCycleCount >= 1 &&
      trust.fields.breathing.needsConfirmation === false,
    responsivenessRecovered:
      fieldRecovery.responsiveness.stableCycleCount >= 1 &&
      trust.fields.responsiveness.needsConfirmation === false,
    breathingConfirmationRecentlyCleared:
      fieldRecovery.breathing.confirmationRecentlyCleared,
    responsivenessConfirmationRecentlyCleared:
      fieldRecovery.responsiveness.confirmationRecentlyCleared,
    breathingRecoveryReason: fieldRecovery.breathing.recoveryReason,
    responsivenessRecoveryReason: fieldRecovery.responsiveness.recoveryReason,
    antiRepeatSuppressedPromptType: null,
    antiRepeatReason: null,
    reassessExitReason: null,
  };
};

export const applyDecisionToMemory = (
  memory: SessionMemory,
  decision: ProtocolDecision,
  state: MergedState,
  trust: TrustAssessment
): SessionMemory => {
  const context = buildMemoryContext(memory, state, trust);
  const recentSignals = toSignalSnapshot(memory.recent_signals, state);
  const nextSignalHistory = [...memory.signal_history, recentSignals].slice(
    -SIGNAL_HISTORY_LIMIT
  );
  const nextRecentSteps = [...memory.recent_steps, decision.step_id].slice(
    -RECENT_STEPS_LIMIT
  );
  const promptType = decision.prompt_type ?? getPromptTypeForDecision(decision);
  const promptField =
    getFieldForAction(decision.step_id) ??
    getFieldForAction(getActionForPromptType(promptType) ?? '');
  const recentBleedingObservations = [
    ...memory.recentBleedingObservations,
    getBleedingObservation(state, trust),
  ].slice(-BLEEDING_OBSERVATION_LIMIT);
  const severeBleedingConsecutiveTrueCount = getSevereBleedingConsecutiveTrueCount(
    recentBleedingObservations
  );
  const severeBleedingContradictionRecent = hasRecentBleedingContradiction(
    recentBleedingObservations,
    trust
  );
  const lastHighUrgencyAt =
    state.severe_bleeding === true &&
    trust.fields.severe_bleeding.confidence >= HIGH_URGENCY_CONFIDENCE
      ? Date.now()
      : memory.lastHighUrgencyAt;
  const fieldRecovery = getNextFieldRecoveryState(memory, state, trust);

  return {
    last_step_id: decision.step_id,
    last_instruction: decision.instruction,
    last_confidence: context.effectiveConfidence,
    recent_steps: nextRecentSteps,
    recent_signals: recentSignals,
    turn_count: memory.turn_count + 1,
    signal_history: nextSignalHistory,
    lastPromptType: promptType ?? memory.lastPromptType,
    lastPromptAt: promptType ? Date.now() : memory.lastPromptAt,
    lastFieldConfidences: promptField
      ? {
          ...memory.lastFieldConfidences,
          [promptField]: trust.fields[promptField].confidence,
        }
      : { ...memory.lastFieldConfidences },
    recentBleedingObservations,
    severeBleedingConsecutiveTrueCount,
    severeBleedingContradictionRecent,
    lastHighUrgencyAt,
    fieldRecovery,
  };
};
