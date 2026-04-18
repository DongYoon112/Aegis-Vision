import type { NullableBoolean } from '../protocol/types';
import type { PromptType } from '../protocol/decisionMetadata';
import type { TrustFieldName } from '../protocol/trustTypes';

export type RecentSignals = {
  bleeding: NullableBoolean;
  responsive: NullableBoolean;
  breathing: NullableBoolean;
};

export type SignalSnapshot = RecentSignals;

export type SessionMemory = {
  last_step_id: string | null;
  last_instruction: string | null;
  last_confidence: number | null;
  recent_steps: string[];
  recent_signals: RecentSignals;
  turn_count: number;
  signal_history: SignalSnapshot[];
  lastPromptType: PromptType | null;
  lastPromptAt: number | null;
  lastFieldConfidences: Record<TrustFieldName, number>;
};

export type CooldownStrength = 'none' | 'weak' | 'strong';

export type MemoryContext = {
  last_step_id: string | null;
  recent_steps: string[];
  recent_signals: RecentSignals;
  turn_count: number;
  effectiveConfidence: number;
  confidenceDelta: number;
  confidenceDropping: boolean;
  similarity: number;
  signalsStable: boolean;
  signalsImproving: boolean;
  lastPromptType: PromptType | null;
  lastPromptAt: number | null;
  lastFieldConfidences: Record<TrustFieldName, number>;
  confirmationCooldownActive: boolean;
  confirmationPromptSuppressed: boolean;
  suppressedPromptType: PromptType | null;
};
