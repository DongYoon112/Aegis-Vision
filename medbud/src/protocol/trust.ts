import { clampConfidence, type MergedState, type NullableBoolean } from './types';
import type {
  TrustAssessment,
  TrustFieldAssessment,
  TrustFieldName,
} from './trustTypes';

const FIELD_ACTIONS: Record<TrustFieldName, string> = {
  breathing: 'check_breathing',
  severe_bleeding: 'control_bleeding',
  responsiveness: 'check_responsive',
};

const CONFIRMATION_THRESHOLD = 0.6;
const BLEEDING_ACTION_THRESHOLD = 0.55;

const scoreSignalAgreement = (
  parserValue: NullableBoolean,
  mergedValue: NullableBoolean
) => {
  if (parserValue === null || mergedValue === null) {
    return 0;
  }

  return parserValue === mergedValue ? 0.3 : -0.2;
};

const getSignalQuality = (state: MergedState): TrustAssessment['signal_quality'] => {
  if (state.image_quality === 'usable' && state.confidence >= 0.7) {
    return 'high';
  }

  if (state.image_quality === 'usable') {
    return 'medium';
  }

  return 'low';
};

const getReason = (
  agreement: number,
  signalQuality: TrustAssessment['signal_quality'],
  confidence: number
) => {
  if (signalQuality === 'low' && confidence < 0.55) {
    return 'low confidence';
  }

  if (signalQuality === 'low') {
    return 'vision unclear';
  }

  if (agreement < 0.5) {
    return 'signals disagree';
  }

  return 'high confidence agreement';
};

const getFieldReason = (
  field: TrustFieldName,
  mergedValue: NullableBoolean,
  parserValue: NullableBoolean,
  confidence: number,
  state: MergedState
) => {
  if (mergedValue === null) {
    return `${field} is unknown`;
  }

  if (parserValue !== null && parserValue !== mergedValue) {
    return `${field} signals disagree`;
  }

  if (state.image_quality !== 'usable') {
    return 'vision quality reduces confidence';
  }

  if (confidence < CONFIRMATION_THRESHOLD) {
    return `${field} confidence is low`;
  }

  if (field === 'severe_bleeding' && mergedValue === true) {
    return 'strong severe bleeding signal';
  }

  return `${field} is trusted enough for action`;
};

const evaluateFieldTrust = (
  field: TrustFieldName,
  mergedValue: NullableBoolean,
  parserValue: NullableBoolean,
  state: MergedState
): TrustFieldAssessment => {
  let confidence = state.confidence;

  if (mergedValue === null) {
    confidence -= 0.3;
  }

  if (parserValue !== null && mergedValue !== null && parserValue !== mergedValue) {
    confidence -= 0.2;
  }

  if (state.image_quality !== 'usable') {
    confidence -= 0.15;
  }

  if (field === 'severe_bleeding' && mergedValue === true && confidence >= BLEEDING_ACTION_THRESHOLD) {
    confidence += 0.15;
  }

  const clampedConfidence = clampConfidence(confidence, 0);

  return {
    needsConfirmation:
      mergedValue === null ||
      (field === 'severe_bleeding' && mergedValue === true
        ? clampedConfidence < BLEEDING_ACTION_THRESHOLD
        : clampedConfidence < CONFIRMATION_THRESHOLD),
    confidence: clampedConfidence,
    reason: getFieldReason(field, mergedValue, parserValue, clampedConfidence, state),
  };
};

export const evaluateTrust = (state: MergedState): TrustAssessment => {
  const agreement = clampConfidence(
    scoreSignalAgreement(state.parser_severe_bleeding, state.severe_bleeding) +
      scoreSignalAgreement(state.parser_responsive, state.responsive) +
      scoreSignalAgreement(state.parser_breathing, state.breathing),
    0
  );

  const signal_quality = getSignalQuality(state);
  const usable_for_action =
    agreement >= 0.6 &&
    signal_quality !== 'low' &&
    state.confidence >= 0.55;
  const fields = {
    breathing: evaluateFieldTrust(
      'breathing',
      state.breathing,
      state.parser_breathing,
      state
    ),
    severe_bleeding: evaluateFieldTrust(
      'severe_bleeding',
      state.severe_bleeding,
      state.parser_severe_bleeding,
      state
    ),
    responsiveness: evaluateFieldTrust(
      'responsiveness',
      state.responsive,
      state.parser_responsive,
      state
    ),
  };
  const blockedActions = (Object.entries(fields) as Array<
    [TrustFieldName, TrustFieldAssessment]
  >)
    .filter(([, fieldTrust]) => fieldTrust.needsConfirmation)
    .map(([field]) => FIELD_ACTIONS[field]);
  const allowedActions = (Object.entries(fields) as Array<
    [TrustFieldName, TrustFieldAssessment]
  >)
    .filter(([, fieldTrust]) => fieldTrust.needsConfirmation === false)
    .map(([field]) => FIELD_ACTIONS[field]);
  const needs_confirmation = blockedActions.length > 0;

  return {
    agreement,
    signal_quality,
    usable_for_action,
    needs_confirmation,
    reason: getReason(agreement, signal_quality, state.confidence),
    fields,
    allowedActions,
    blockedActions,
  };
};
