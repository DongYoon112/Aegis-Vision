export type SignalQuality = 'high' | 'medium' | 'low';

export type TrustAssessment = {
  agreement: number;
  signal_quality: SignalQuality;
  usable_for_action: boolean;
  needs_confirmation: boolean;
  reason: string;
};
