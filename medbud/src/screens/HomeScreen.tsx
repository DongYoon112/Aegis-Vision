import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorCard } from '../components/ErrorCard';
import { JsonCard } from '../components/JsonCard';
import { ResponseCard } from '../components/ResponseCard';
import { StatusBadge } from '../components/StatusBadge';
import { TranscriptCard } from '../components/TranscriptCard';
import { elevenLabsSTT } from '../services/elevenlabsSTT';
import { elevenLabsTTS } from '../services/elevenlabsTTS';
import { openAIService } from '../services/openai';
import { player } from '../services/player';
import { recorder } from '../services/recorder';
import type { EmergencyAssessment, SessionState } from '../types/session';
import { assertLiveConfig, medbudEnv } from '../utils/env';

const AUTO_STOP_MS = 5000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const stringifyAssessment = (assessment: EmergencyAssessment | null) =>
  assessment ? JSON.stringify(assessment, null, 2) : '';

export function HomeScreen() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState('');
  const [assessment, setAssessment] = useState<EmergencyAssessment | null>(null);
  const [spokenResponse, setSpokenResponse] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const isBusy = sessionState !== 'idle';

  const resetSession = () => {
    setTranscript('');
    setAssessment(null);
    setSpokenResponse('');
    setErrorMessage('');
  };

  const startSession = async () => {
    if (isBusy) {
      return;
    }

    try {
      resetSession();

      if (!medbudEnv.useMocks) {
        assertLiveConfig();
      }

      setSessionState('listening');
      await recorder.startRecording();
      await sleep(AUTO_STOP_MS);

      const audio = await recorder.stopRecording();

      setSessionState('transcribing');
      const transcriptText = await elevenLabsSTT.transcribeAudio(audio);
      setTranscript(transcriptText);

      setSessionState('thinking');
      const analysis = await openAIService.analyzeTranscript(transcriptText);
      setAssessment(analysis.assessment);
      setSpokenResponse(analysis.spokenResponse);

      setSessionState('speaking');
      const synthesizedAudio = await elevenLabsTTS.synthesizeSpeech(
        analysis.spokenResponse
      );
      await player.play(synthesizedAudio);

      setSessionState('idle');
    } catch (error) {
      await player.stop().catch(() => undefined);
      setSessionState('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
      setSessionState('idle');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Aegis Vision Stage 1</Text>
        <Text style={styles.title}>AI emergency assistant loop</Text>
        <Text style={styles.subtitle}>
          Stitch handles the emergency guidance flow while the phone manages audio
          input and output through a clean service layer.
        </Text>
      </View>

      <View style={styles.controls}>
        <StatusBadge state={sessionState} />
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={startSession}
          style={({ pressed }: { pressed: boolean }) => [
            styles.button,
            isBusy && styles.buttonDisabled,
            pressed && !isBusy && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonText}>
            {isBusy ? 'Aegis Vision Running...' : 'Start Aegis Vision'}
          </Text>
        </Pressable>
        <Text style={styles.helperText}>
          {medbudEnv.useMocks
            ? 'Mock mode is enabled for a reliable demo without live APIs.'
            : 'Live mode is enabled. API keys are required and embedded client-side for this prototype.'}
        </Text>
      </View>

      <TranscriptCard transcript={transcript} />
      <JsonCard json={stringifyAssessment(assessment)} />
      <ResponseCard response={spokenResponse} />
      <ErrorCard error={errorMessage} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  eyebrow: {
    color: '#4b6c8b',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    color: '#0f2135',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#4f6477',
    fontSize: 15,
    lineHeight: 22,
  },
  controls: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#12395b',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  buttonDisabled: {
    backgroundColor: '#8094a8',
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  helperText: {
    color: '#5a6d80',
    fontSize: 13,
    lineHeight: 20,
  },
});
