import { clampConfidence, type MergedState, type ProtocolDecision } from '../protocol/types';
import {
  getActionForPromptType,
  getFieldForAction,
  getPromptTypeForDecision,
} from '../protocol/decisionMetadata';
import type { TrustAssessment } from '../protocol/trustTypes';
import type { MemoryContext, RecentSignals, SessionMemory, SignalSnapshot } from './types';

const RECENT_STEPS_LIMIT = 4;
const SIGNAL_HISTORY_LIMIT = 2;

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
  };
};
