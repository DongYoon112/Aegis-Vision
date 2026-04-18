import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

import type { RecordedAudio } from '../types/session';

const MIME_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
  caf: 'audio/x-caf',
  webm: 'audio/webm',
  '3gp': 'audio/3gpp',
};

const inferMimeType = (uri: string) => {
  const extension = uri.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'audio/m4a';
};

class RecorderService {
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;

  async requestPermission() {
    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      throw new Error(
        'Microphone permission was denied. Aegis Vision needs microphone access to record a short emergency clip.'
      );
    }
  }

  async startRecording() {
    await this.requestPermission();

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    this.recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await this.recorder.prepareToRecordAsync();
    this.recorder.record();
  }

  async stopRecording(): Promise<RecordedAudio> {
    if (!this.recorder) {
      throw new Error('No active recording is available to stop.');
    }

    const activeRecorder = this.recorder;

    await activeRecorder.stop();
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });

    const uri = activeRecorder.uri ?? activeRecorder.getStatus().url ?? '';
    this.recorder = null;

    if (!uri) {
      throw new Error('The recording completed, but no audio file was produced.');
    }

    return {
      uri,
      fileName: uri.split('/').pop() ?? 'medbud-recording.m4a',
      mimeType: inferMimeType(uri),
    };
  }
}

export const recorder = new RecorderService();
