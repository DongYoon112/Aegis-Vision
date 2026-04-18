export type SessionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'parsing'
  | 'vision'
  | 'deciding'
  | 'speaking'
  | 'error';

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
