import { useEffect, useRef, useState } from 'react';
import {
  Image,
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
import { getPromptTypeForDecision } from '../protocol/decisionMetadata';
import { protocolEngine } from '../protocol/engine';
import { mergeState } from '../protocol/mergeState';
import { evaluateTrust } from '../protocol/trust';
import type {
  CameraFrame,
  MergedState,
  ParserOutput,
  ProtocolDecision,
  VisionOutput,
} from '../protocol/types';
import type { TrustAssessment } from '../protocol/trustTypes';
import {
  applyDecisionToMemory,
  buildMemoryContext,
  createInitialSessionMemory,
} from '../session/sessionMemory';
import type { MemoryContext, SessionMemory } from '../session/types';
import { elevenLabsSTT } from '../services/elevenlabsSTT';
import { elevenLabsTTS } from '../services/elevenlabsTTS';
import { providerManager } from '../services/frameProvider';
import type { FrameProvider, FrameProviderStatus } from '../services/frameProvider/types';
import { openAIService } from '../services/openai';
import { player } from '../services/player';
import { recorder } from '../services/recorder';
import { visionSignals } from '../services/visionSignals';
import { localVisionDebug } from '../services/localVision';
import type { SessionState } from '../types/session';
import { assertLiveConfig, medbudEnv } from '../utils/env';

const AUTO_STOP_MS = 5000;
const CONFIRMATION_COOLDOWN_MS = 8000;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const stringifyValue = (value: unknown, placeholder = '{}') =>
  value ? JSON.stringify(value, null, 2) : placeholder;

const defaultProviderStatus: FrameProviderStatus = {
  kind: medbudEnv.useMocks ? 'mock' : 'expo_camera',
  available: true,
  active: false,
  connectionState: medbudEnv.useMocks ? 'connected' : 'disconnected',
  lastFrameAt: null,
  statusLabel: medbudEnv.useMocks ? 'Mock device active' : 'Using phone camera fallback',
};

export function HomeScreen() {
  const cameraRef = useRef<CameraView | null>(null);

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState('');
  const [parserOutput, setParserOutput] = useState<ParserOutput | null>(null);
  const [visionOutput, setVisionOutput] = useState<VisionOutput | null>(null);
  const [mergedState, setMergedState] = useState<MergedState | null>(null);
  const [trustAssessment, setTrustAssessment] = useState<TrustAssessment | null>(null);
  const [protocolDecision, setProtocolDecision] = useState<ProtocolDecision | null>(
    null
  );
  const [memoryContext, setMemoryContext] = useState<MemoryContext | null>(null);
  const [sessionMemory, setSessionMemory] = useState<SessionMemory>(
    createInitialSessionMemory()
  );
  const [latestFrame, setLatestFrame] = useState<CameraFrame | null>(null);
  const [spokenResponse, setSpokenResponse] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [providerStatus, setProviderStatus] =
    useState<FrameProviderStatus>(defaultProviderStatus);
  const [detectorStatus, setDetectorStatus] = useState(localVisionDebug.getDetectorStatus());
  const [initializingProvider, setInitializingProvider] = useState(true);

  const isBusy = sessionState !== 'idle';

  const syncProviderStatus = () => {
    setProviderStatus(providerManager.getStatus());
    setDetectorStatus(localVisionDebug.getDetectorStatus());
  };

  useEffect(() => {
    let mounted = true;

    const initializeProviders = async () => {
      try {
        await providerManager.initialize();
        await providerManager.resolveActiveProvider();
        if (mounted) {
          syncProviderStatus();
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Failed to initialize frame providers.'
          );
        }
      } finally {
        if (mounted) {
          setInitializingProvider(false);
        }
      }
    };

    providerManager.attachExpoCameraRef(cameraRef.current);
    void initializeProviders();

    return () => {
      mounted = false;
      providerManager.attachExpoCameraRef(null);
      providerManager.getActiveProvider().stopSampling();
      void player.stop();
    };
  }, []);

  const resetSession = () => {
    setTranscript('');
    setParserOutput(null);
    setVisionOutput(null);
    setMergedState(null);
    setTrustAssessment(null);
    setProtocolDecision(null);
    setMemoryContext(null);
    setLatestFrame(null);
    setSpokenResponse('');
    setErrorMessage('');
  };

  const connectGlasses = async () => {
    setInitializingProvider(true);
    try {
      await providerManager.connectGlasses();
      syncProviderStatus();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to connect glasses.'
      );
    } finally {
      setInitializingProvider(false);
    }
  };

  const disconnectGlasses = async () => {
    setInitializingProvider(true);
    try {
      await providerManager.disconnectGlasses();
      syncProviderStatus();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to disconnect glasses.'
      );
    } finally {
      setInitializingProvider(false);
    }
  };

  const startSession = async () => {
    if (isBusy || initializingProvider) {
      return;
    }

    try {
      resetSession();

      if (!medbudEnv.useMocks) {
        assertLiveConfig();
      }

      const provider = providerManager.getActiveProvider();
      const sessionProvider: FrameProvider = provider;

      await sessionProvider.requestPermissions();

      setSessionState('listening');
      sessionProvider.startSampling();
      syncProviderStatus();
      await recorder.startRecording();
      await sleep(AUTO_STOP_MS);

      const audio = await recorder.stopRecording();
      sessionProvider.stopSampling();
      const sampledFrame = sessionProvider.getLatestFrame();
      setLatestFrame(sampledFrame);
      syncProviderStatus();

      setSessionState('transcribing');
      const transcriptText = await elevenLabsSTT.transcribeAudio(audio);
      setTranscript(transcriptText);

      setSessionState('parsing');
      const parsed = await parser.parseTranscript(transcriptText);
      setParserOutput(parsed);

      setSessionState('vision');
      const vision = await visionSignals.analyzeFrame(sampledFrame, Date.now());
      setVisionOutput(vision);

      setSessionState('deciding');
      const merged = mergeState(parsed, vision);
      setMergedState(merged);
      const trust = evaluateTrust(merged);
      setTrustAssessment(trust);
      const nextMemoryContext = buildMemoryContext(sessionMemory, merged, trust);
      const decision = protocolEngine.decide(merged, trust, nextMemoryContext);
      const decisionPromptType = decision.prompt_type ?? getPromptTypeForDecision(decision);
      const cooldownActive =
        decisionPromptType !== null &&
        nextMemoryContext.lastPromptType === decisionPromptType &&
        nextMemoryContext.lastPromptAt !== null &&
        Date.now() - nextMemoryContext.lastPromptAt < CONFIRMATION_COOLDOWN_MS;
      setMemoryContext({
        ...nextMemoryContext,
        confirmationCooldownActive: cooldownActive,
        confirmationPromptSuppressed: decision.cooldown_suppressed ?? false,
        suppressedPromptType:
          decision.cooldown_suppressed === true ? decisionPromptType : null,
      });
      setProtocolDecision(decision);
      setSessionMemory((currentMemory) =>
        applyDecisionToMemory(currentMemory, decision, merged, trust)
      );

      const rephrased = await openAIService.rephraseProtocolDecision(decision);
      setSpokenResponse(rephrased);

      setSessionState('speaking');
      const synthesizedAudio = await elevenLabsTTS.synthesizeSpeech(rephrased);
      await player.play(synthesizedAudio);

      await providerManager.resolveActiveProvider();
      syncProviderStatus();
      setSessionState('idle');
    } catch (error) {
      providerManager.getActiveProvider().stopSampling();
      await providerManager.resolveActiveProvider();
      syncProviderStatus();
      await player.stop().catch(() => undefined);
      setSessionState('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
      setSessionState('idle');
    }
  };

  const showPhonePreview = providerStatus.kind === 'expo_camera';
  const showSnapshot = providerStatus.kind === 'meta_glasses' && latestFrame?.uri;
  const frameFreshness = latestFrame
    ? Date.now() - Date.parse(latestFrame.capturedAt) <= 3000
      ? 'fresh'
      : 'stale'
    : 'none';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Aegis Vision Stage 4.3</Text>
        <Text style={styles.title}>Stitch memory-aware emergency loop</Text>
        <Text style={styles.subtitle}>
          The phone still orchestrates the session while Stitch now tracks recent
          signals and protocol steps to avoid repetitive guidance across turns.
        </Text>
      </View>

      <View style={styles.controls}>
        <StatusBadge state={sessionState} />
        <Pressable
          accessibilityRole="button"
          disabled={isBusy || initializingProvider}
          onPress={startSession}
          style={({ pressed }: { pressed: boolean }) => [
            styles.button,
            (isBusy || initializingProvider) && styles.buttonDisabled,
            pressed && !isBusy && !initializingProvider && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonText}>
            {isBusy ? 'Aegis Vision Running...' : 'Start Aegis Vision'}
          </Text>
        </Pressable>
        <Text style={styles.helperText}>
          {medbudEnv.useMocks
            ? 'Mock mode is enabled. The mock device remains the active frame source.'
            : 'Stage 3 prefers Meta glasses when available and falls back to the phone camera safely.'}
        </Text>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.cardTitle}>Input Source</Text>
        <Text style={styles.statusLine}>{providerStatus.statusLabel}</Text>
        <Text style={styles.statusMeta}>
          Active provider: {providerStatus.kind}
        </Text>
        <Text style={styles.statusMeta}>
          Connection state: {providerStatus.connectionState}
        </Text>
        <Text style={styles.statusMeta}>
          Last frame timestamp: {providerStatus.lastFrameAt ?? 'none'}
        </Text>
        <Text style={styles.statusMeta}>
          Detector backend: {detectorStatus.backend}
        </Text>
        <Text style={styles.statusMeta}>
          Detector available: {detectorStatus.available ? 'yes' : 'no'}
        </Text>
        <Text style={styles.statusMeta}>
          Last analyzed frame source: {latestFrame?.source ?? 'none'}
        </Text>
        {detectorStatus.reason ? (
          <Text style={styles.statusMeta}>Detector reason: {detectorStatus.reason}</Text>
        ) : null}
        {providerStatus.reason ? (
          <Text style={styles.statusMeta}>Reason: {providerStatus.reason}</Text>
        ) : null}
        {!medbudEnv.useMocks ? (
          <View style={styles.connectionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy || initializingProvider}
              onPress={connectGlasses}
              style={({ pressed }: { pressed: boolean }) => [
                styles.secondaryButton,
                (isBusy || initializingProvider) && styles.secondaryButtonDisabled,
                pressed &&
                  !isBusy &&
                  !initializingProvider &&
                  styles.secondaryButtonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Connect Glasses</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy || initializingProvider}
              onPress={disconnectGlasses}
              style={({ pressed }: { pressed: boolean }) => [
                styles.secondaryButton,
                (isBusy || initializingProvider) && styles.secondaryButtonDisabled,
                pressed &&
                  !isBusy &&
                  !initializingProvider &&
                  styles.secondaryButtonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Disconnect Glasses</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.cameraCard}>
        <Text style={styles.cardTitle}>Frame Source</Text>
        {showPhonePreview ? (
          <View style={styles.cameraFrame}>
            <CameraView
              ref={(ref: CameraView | null) => {
                cameraRef.current = ref;
                providerManager.attachExpoCameraRef(ref);
              }}
              style={styles.camera}
              facing="back"
            />
          </View>
        ) : showSnapshot ? (
          <View style={styles.cameraFrame}>
            <Image source={{ uri: latestFrame.uri }} style={styles.snapshot} />
          </View>
        ) : (
          <View style={[styles.cameraFrame, styles.placeholderFrame]}>
            <Text style={styles.placeholderText}>
              {providerStatus.kind === 'mock'
                ? 'Mock frame source active'
                : 'No live phone preview while glasses are active'}
            </Text>
          </View>
        )}
        <Text style={styles.cameraText}>
          Frame freshness: {frameFreshness}
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
        placeholder='{\n  "person_visible": null,\n  "body_position": null,\n  "severe_bleeding_likely": null,\n  "limb_visible": null,\n  "image_quality": "unclear",\n  "confidence": 0\n}'
      />
      <JsonCard
        title="Merged State"
        json={stringifyValue(mergedState)}
        placeholder='{\n  "responsive": null,\n  "breathing": null,\n  "severe_bleeding": null,\n  "parser_responsive": null,\n  "parser_breathing": null,\n  "parser_severe_bleeding": null,\n  "injury_location": null,\n  "person_visible": null,\n  "casualty_supine": null,\n  "limb_visible": null,\n  "image_quality": "unclear",\n  "confidence": 0,\n  "notes": []\n}'
      />
      <JsonCard
        title="Trust Assessment"
        json={stringifyValue(trustAssessment)}
        placeholder='{\n  "agreement": 0,\n  "signal_quality": "low",\n  "usable_for_action": false,\n  "needs_confirmation": true,\n  "reason": "",\n  "fields": {\n    "breathing": {\n      "needsConfirmation": true,\n      "confidence": 0,\n      "reason": ""\n    },\n    "severe_bleeding": {\n      "needsConfirmation": true,\n      "confidence": 0,\n      "reason": ""\n    },\n    "responsiveness": {\n      "needsConfirmation": true,\n      "confidence": 0,\n      "reason": ""\n    }\n  },\n  "allowedActions": [],\n  "blockedActions": []\n}'
      />
      <JsonCard
        title="Session Memory"
        json={stringifyValue({
          last_step_id: sessionMemory.last_step_id,
          turn_count: sessionMemory.turn_count,
          recent_steps: sessionMemory.recent_steps,
          trust_adjusted_confidence: memoryContext?.effectiveConfidence ?? sessionMemory.last_confidence,
          recent_signals: sessionMemory.recent_signals,
          lastPromptType: sessionMemory.lastPromptType,
          lastPromptAt: sessionMemory.lastPromptAt,
          cooldown_active: memoryContext?.confirmationCooldownActive ?? false,
          confirmation_prompt_suppressed:
            memoryContext?.confirmationPromptSuppressed ?? false,
          suppressed_prompt_type: memoryContext?.suppressedPromptType ?? null,
          recentBleedingObservations: memoryContext?.recentBleedingObservations ?? [],
          severeBleedingConsecutiveTrueCount:
            memoryContext?.severeBleedingConsecutiveTrueCount ?? 0,
          severeBleedingContradictionRecent:
            memoryContext?.severeBleedingContradictionRecent ?? false,
          lastHighUrgencyAt: sessionMemory.lastHighUrgencyAt,
          urgentBypassEligible: memoryContext?.urgentBypassEligible ?? false,
          urgentBypassReason: memoryContext?.urgentBypassReason ?? '',
          urgentBypassConfidence: memoryContext?.urgentBypassConfidence ?? 0,
          fieldRecovery: sessionMemory.fieldRecovery,
          breathingStableCycleCount:
            memoryContext?.breathingStableCycleCount ?? 0,
          responsivenessStableCycleCount:
            memoryContext?.responsivenessStableCycleCount ?? 0,
          breathingRecovered: memoryContext?.breathingRecovered ?? false,
          responsivenessRecovered:
            memoryContext?.responsivenessRecovered ?? false,
          breathingConfirmationRecentlyCleared:
            memoryContext?.breathingConfirmationRecentlyCleared ?? false,
          responsivenessConfirmationRecentlyCleared:
            memoryContext?.responsivenessConfirmationRecentlyCleared ?? false,
          breathingRecoveryReason:
            memoryContext?.breathingRecoveryReason ?? '',
          responsivenessRecoveryReason:
            memoryContext?.responsivenessRecoveryReason ?? '',
          antiRepeatSuppressedPromptType:
            protocolDecision?.anti_repeat_suppressed_prompt_type ??
            memoryContext?.antiRepeatSuppressedPromptType ??
            null,
          antiRepeatReason:
            protocolDecision?.anti_repeat_reason ??
            memoryContext?.antiRepeatReason ??
            null,
          reassessExitReason:
            protocolDecision?.reassess_exit_reason ??
            memoryContext?.reassessExitReason ??
            null,
          stability_bias: memoryContext?.signalsStable ?? false,
          confidence_delta: memoryContext?.confidenceDelta ?? 0,
          signals_improving: memoryContext?.signalsImproving ?? false,
        })}
        placeholder='{\n  "last_step_id": null,\n  "turn_count": 0,\n  "recent_steps": [],\n  "trust_adjusted_confidence": 0,\n  "recent_signals": {\n    "bleeding": null,\n    "responsive": null,\n    "breathing": null\n  },\n  "lastPromptType": null,\n  "lastPromptAt": null,\n  "cooldown_active": false,\n  "confirmation_prompt_suppressed": false,\n  "suppressed_prompt_type": null,\n  "recentBleedingObservations": [],\n  "severeBleedingConsecutiveTrueCount": 0,\n  "severeBleedingContradictionRecent": false,\n  "lastHighUrgencyAt": null,\n  "urgentBypassEligible": false,\n  "urgentBypassReason": "",\n  "urgentBypassConfidence": 0,\n  "fieldRecovery": {\n    "breathing": {\n      "recentObservations": [],\n      "stableCycleCount": 0,\n      "confirmationNeededLastCycle": false,\n      "confirmationRecentlyCleared": false,\n      "lastConfirmationClearedAt": null,\n      "recoveryReason": ""\n    },\n    "responsiveness": {\n      "recentObservations": [],\n      "stableCycleCount": 0,\n      "confirmationNeededLastCycle": false,\n      "confirmationRecentlyCleared": false,\n      "lastConfirmationClearedAt": null,\n      "recoveryReason": ""\n    }\n  },\n  "breathingStableCycleCount": 0,\n  "responsivenessStableCycleCount": 0,\n  "breathingRecovered": false,\n  "responsivenessRecovered": false,\n  "breathingConfirmationRecentlyCleared": false,\n  "responsivenessConfirmationRecentlyCleared": false,\n  "breathingRecoveryReason": "",\n  "responsivenessRecoveryReason": "",\n  "antiRepeatSuppressedPromptType": null,\n  "antiRepeatReason": null,\n  "reassessExitReason": null,\n  "stability_bias": false,\n  "confidence_delta": 0,\n  "signals_improving": false\n}'
      />
      <JsonCard
        title="Protocol Decision"
        json={stringifyValue(protocolDecision)}
        placeholder='{\n  "step_id": "",\n  "selectedAction": "monitoring",\n  "priority": "critical",\n  "instruction": "",\n  "reason": "",\n  "needs_confirmation": false,\n  "consideredActions": [],\n  "cooldown_affected": false,\n  "actionDebug": {\n    "priorityOrder": [\n      "control_bleeding",\n      "airway_or_breathing_support",\n      "check_responsiveness",\n      "confirm_breathing",\n      "confirm_responsiveness",\n      "monitoring"\n    ],\n    "skipped": []\n  },\n  "urgent_bypass_activated": false,\n  "urgent_bypass_reason": "",\n  "urgent_bypass_confidence": 0,\n  "urgent_bypass_persistence_count": 0,\n  "urgent_bypass_contradiction_blocked": false,\n  "confirmation_recovery_activated": false,\n  "confirmation_recovery_reason": "",\n  "anti_repeat_suppressed": false,\n  "anti_repeat_reason": "",\n  "anti_repeat_suppressed_prompt_type": null,\n  "reassess_exited_after_recovery": false,\n  "reassess_exit_reason": "",\n  "prompt_type": null,\n  "cooldown_suppressed": false\n}'
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
  statusCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#112235',
  },
  statusLine: {
    color: '#1b3b5a',
    fontSize: 15,
    fontWeight: '700',
  },
  statusMeta: {
    color: '#5a6d80',
    fontSize: 13,
    lineHeight: 20,
  },
  connectionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#e8eef5',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryButtonDisabled: {
    backgroundColor: '#d5dde6',
  },
  secondaryButtonPressed: {
    opacity: 0.9,
  },
  secondaryButtonText: {
    color: '#18304a',
    fontSize: 14,
    fontWeight: '700',
  },
  cameraCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
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
  snapshot: {
    width: '100%',
    height: '100%',
  },
  placeholderFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#dbe6f2',
    fontSize: 14,
    fontWeight: '600',
  },
  cameraText: {
    color: '#5a6d80',
    fontSize: 13,
    lineHeight: 20,
  },
});
