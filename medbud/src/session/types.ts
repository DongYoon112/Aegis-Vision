import type { NullableBoolean } from '../protocol/types';
import type { PromptType } from '../protocol/decisionMetadata';
import type { TrustFieldName } from '../protocol/trustTypes';

export type RecentSignals = {
  bleeding: NullableBoolean;
  responsive: NullableBoolean;
  breathing: NullableBoolean;
};

export type SignalSnapshot = RecentSignals;

export type BleedingObservation = {
  value: NullableBoolean;
  confidence: number;
};

export type FieldObservation = {
  value: NullableBoolean;
  confidence: number;
};

export type RecoveryFieldState = {
  recentObservations: FieldObservation[];
  stableCycleCount: number;
  confirmationNeededLastCycle: boolean;
  confirmationRecentlyCleared: boolean;
  lastConfirmationClearedAt: number | null;
  recoveryReason: string;
};

export type BreathingConfirmation = {
  value: NullableBoolean;
  source: 'user_confirmation';
  confirmedAt: number;
  expiresAt: number;
  transcript: string;
  applied: boolean;
};

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
  recentBleedingObservations: BleedingObservation[];
  severeBleedingConsecutiveTrueCount: number;
  severeBleedingContradictionRecent: boolean;
  lastHighUrgencyAt: number | null;
  breathingConfirmation: BreathingConfirmation | null;
  breathingConfirmationLockoutUntil: number | null;
  breathingConfirmationSuppressedReason: string | null;
  fieldRecovery: {
    breathing: RecoveryFieldState;
    responsiveness: RecoveryFieldState;
  };
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
  recentBleedingObservations: BleedingObservation[];
  severeBleedingConsecutiveTrueCount: number;
  severeBleedingContradictionRecent: boolean;
  lastHighUrgencyAt: number | null;
  urgentBypassEligible: boolean;
  urgentBypassReason: string;
  urgentBypassConfidence: number;
  breathingConfirmation: BreathingConfirmation | null;
  breathingConfirmationFresh: boolean;
  breathingConfirmationApplied: boolean;
  breathingConfirmationLockoutUntil: number | null;
  breathingConfirmationSuppressedReason: string | null;
  breathingStableCycleCount: number;
  responsivenessStableCycleCount: number;
  breathingRecovered: boolean;
  responsivenessRecovered: boolean;
  breathingConfirmationRecentlyCleared: boolean;
  responsivenessConfirmationRecentlyCleared: boolean;
  breathingRecoveryReason: string;
  responsivenessRecoveryReason: string;
  antiRepeatSuppressedPromptType: PromptType | null;
  antiRepeatReason: string | null;
  reassessExitReason: string | null;
};
