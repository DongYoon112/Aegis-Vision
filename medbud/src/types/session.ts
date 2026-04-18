export type SessionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

export type EmergencyAssessment = {
  responsive: boolean | null;
  severe_bleeding: boolean | null;
  breathing: boolean | null;
  notes: string[];
  next_step: string;
};

export type SessionResult = {
  transcript: string;
  assessment: EmergencyAssessment | null;
  spokenResponse: string;
  errorMessage?: string;
  fallbackUsed?: boolean;
};

export type RecordedAudio = {
  uri: string;
  fileName: string;
  mimeType: string;
};

export type PlayableAudio =
  | {
      kind: 'uri';
      uri: string;
      mimeType: string;
    }
  | {
      kind: 'speech';
      spokenText: string;
    };

export type ModelAnalysis = {
  assessment: EmergencyAssessment;
  spokenResponse: string;
};
