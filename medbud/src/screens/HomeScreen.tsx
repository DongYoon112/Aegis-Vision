import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView } from 'expo-camera';

import { ErrorCard } from '../components/ErrorCard';
import { JsonCard } from '../components/JsonCard';
import { ResponseCard } from '../components/ResponseCard';
import { StatusBadge } from '../components/StatusBadge';
import { TranscriptCard } from '../components/TranscriptCard';
import { parser } from '../llm/parser';
import { protocolEngine } from '../protocol/engine';
import { mergeState } from '../protocol/mergeState';
import type {
  CameraFrame,
  MergedState,
  ParserOutput,
  ProtocolDecision,
  VisionOutput,
} from '../protocol/types';
import { cameraService } from '../services/camera';
import { elevenLabsSTT } from '../services/elevenlabsSTT';
import { elevenLabsTTS } from '../services/elevenlabsTTS';
import { openAIService } from '../services/openai';
import { player } from '../services/player';
import { recorder } from '../services/recorder';
import { visionService } from '../services/vision';
import type { SessionState } from '../types/session';
import { assertLiveConfig, medbudEnv } from '../utils/env';

const AUTO_STOP_MS = 5000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const stringifyValue = (value: unknown, placeholder = '{}') =>
  value ? JSON.stringify(value, null, 2) : placeholder;

export function HomeScreen() {
  const cameraRef = useRef<CameraView | null>(null);

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState('');
  const [parserOutput, setParserOutput] = useState<ParserOutput | null>(null);
  const [visionOutput, setVisionOutput] = useState<VisionOutput | null>(null);
  const [mergedState, setMergedState] = useState<MergedState | null>(null);
  const [protocolDecision, setProtocolDecision] = useState<ProtocolDecision | null>(
    null
  );
  const [latestFrame, setLatestFrame] = useState<CameraFrame | null>(null);
  const [spokenResponse, setSpokenResponse] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);

  const isBusy = sessionState !== 'idle';

  useEffect(() => {
    cameraService.attachCameraRef(cameraRef.current);

    return () => {
      cameraService.attachCameraRef(null);
      cameraService.stopSampling();
      void player.stop();
    };
  }, []);

  const resetSession = () => {
    setTranscript('');
    setParserOutput(null);
    setVisionOutput(null);
    setMergedState(null);
    setProtocolDecision(null);
    setLatestFrame(null);
    setSpokenResponse('');
    setErrorMessage('');
  };

  const ensureCameraReady = async () => {
    await cameraService.requestPermissions();
    setCameraPermissionGranted(true);
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

      await ensureCameraReady();

      setSessionState('listening');
      cameraService.attachCameraRef(cameraRef.current);
      cameraService.startSampling();
      await recorder.startRecording();
      await sleep(AUTO_STOP_MS);

      const audio = await recorder.stopRecording();
      cameraService.stopSampling();
      const frame = cameraService.getLatestFrame();
      setLatestFrame(frame);

      setSessionState('transcribing');
      const transcriptText = await elevenLabsSTT.transcribeAudio(audio);
      setTranscript(transcriptText);

      setSessionState('parsing');
      const parsed = await parser.parseTranscript(transcriptText);
      setParserOutput(parsed);

      setSessionState('vision');
      const vision = await visionService.analyzeFrame(frame);
      setVisionOutput(vision);

      setSessionState('deciding');
      const merged = mergeState(parsed, vision);
      setMergedState(merged);
      const decision = protocolEngine.decide(merged);
      setProtocolDecision(decision);

      const rephrased = await openAIService.rephraseProtocolDecision(decision);
      setSpokenResponse(rephrased);

      setSessionState('speaking');
      const synthesizedAudio = await elevenLabsTTS.synthesizeSpeech(rephrased);
      await player.play(synthesizedAudio);

      setSessionState('idle');
    } catch (error) {
      cameraService.stopSampling();
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
        <Text style={styles.eyebrow}>Aegis Vision Stage 2</Text>
        <Text style={styles.title}>Stitch multimodal emergency loop</Text>
        <Text style={styles.subtitle}>
          Audio is transcribed, parsed, combined with sampled vision, routed through
          a rule-based protocol engine, then rephrased into a short Stitch response.
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
            ? 'Mock mode is enabled. Stitch still runs the full parser, vision, merge, protocol, and TTS pipeline.'
            : 'Live mode is enabled. Stitch uses Structured Outputs for parser, vision, and rephrase steps.'}
        </Text>
      </View>

      <View style={styles.cameraCard}>
        <Text style={styles.cardTitle}>Camera Preview</Text>
        <View style={styles.cameraFrame}>
          <CameraView
            ref={(ref: CameraView | null) => {
              cameraRef.current = ref;
              cameraService.attachCameraRef(ref);
            }}
            style={styles.camera}
            facing="back"
          />
        </View>
        <Text style={styles.cameraText}>
          {cameraPermissionGranted
            ? latestFrame
              ? `Latest sampled frame: ${latestFrame.capturedAt}`
              : 'Camera ready. The latest frame will be sampled during an active session.'
            : 'Camera permission will be requested when you start a session.'}
        </Text>
      </View>

      <TranscriptCard transcript={transcript} />
      <JsonCard
        title="Parser Output"
        json={stringifyValue(parserOutput)}
        placeholder='{\n  "responsive": null,\n  "severe_bleeding": null,\n  "breathing": null,\n  "injury_location": null,\n  "notes": [],\n  "confidence": 0\n}'
      />
      <JsonCard
        title="Vision Output"
        json={stringifyValue(visionOutput)}
        placeholder='{\n  "person_visible": null,\n  "casualty_supine": null,\n  "severe_bleeding_likely": null,\n  "limb_visible": null,\n  "image_quality": "unclear",\n  "confidence": 0\n}'
      />
      <JsonCard
        title="Merged State"
        json={stringifyValue(mergedState)}
        placeholder='{\n  "responsive": null,\n  "breathing": null,\n  "severe_bleeding": null,\n  "injury_location": null,\n  "person_visible": null,\n  "casualty_supine": null,\n  "limb_visible": null,\n  "image_quality": "unclear",\n  "confidence": 0,\n  "notes": []\n}'
      />
      <JsonCard
        title="Protocol Decision"
        json={stringifyValue(protocolDecision)}
        placeholder='{\n  "step_id": "",\n  "priority": "low",\n  "instruction": "",\n  "reason": "",\n  "needs_confirmation": false\n}'
      />
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
  cameraCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#112235',
  },
  cameraFrame: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: '#1d2a38',
    height: 220,
  },
  camera: {
    flex: 1,
  },
  cameraText: {
    color: '#5a6d80',
    fontSize: 13,
    lineHeight: 20,
  },
});
