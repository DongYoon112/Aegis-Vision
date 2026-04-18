export type SignalQuality = 'high' | 'medium' | 'low';

export type TrustFieldName = 'breathing' | 'severe_bleeding' | 'responsiveness';

export type TrustFieldAssessment = {
  needsConfirmation: boolean;
  confidence: number;
  reason: string;
};

export type TrustAssessment = {
  agreement: number;
  signal_quality: SignalQuality;
  usable_for_action: boolean;
  needs_confirmation: boolean;
  reason: string;
  fields: Record<TrustFieldName, TrustFieldAssessment>;
  allowedActions: string[];
  blockedActions: string[];
};
