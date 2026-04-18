import { clampConfidence, type MergedState, type NullableBoolean } from './types';
import type { TrustAssessment } from './trustTypes';

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
  const needs_confirmation =
    usable_for_action === false || state.confidence < 0.55 || agreement < 0.5;

  return {
    agreement,
    signal_quality,
    usable_for_action,
    needs_confirmation,
    reason: getReason(agreement, signal_quality, state.confidence),
  };
};
