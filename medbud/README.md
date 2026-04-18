# Aegis Vision Stage 3

Aegis Vision is a one-screen Expo React Native prototype for an AI-assisted emergency workflow. The assistant is named Stitch. Stage 3 upgrades frame input to a provider-based architecture so the phone can prefer Meta/Ray-Ban glasses as the camera source while preserving phone-camera fallback and mock mode.

## Stage 3 Architecture

The decision pipeline remains fixed:

```text
audio -> STT -> parser -> vision -> merge -> protocol engine -> GPT rephrase -> TTS
```

Important constraints:

- the protocol engine is still the only decision-maker
- GPT is still limited to structured parsing, structured vision extraction, and short spoken rephrasing
- the phone remains the controller/orchestrator
- wake word and "Hey Meta" integration are out of scope
- continuous video streaming is out of scope

## Frame Provider Selection

Stage 3 chooses exactly one frame provider at a time:

- `MockFrameProvider`
  - selected whenever `EXPO_PUBLIC_MEDBUD_USE_MOCKS=true`
- `MetaGlassesFrameProvider`
  - selected when Meta wearables integration is available and connected
- `ExpoCameraFrameProvider`
  - selected whenever Meta is unavailable or disconnected

Safety rules:

- provider is locked at session start
- the app never re-resolves the active provider mid-session
- if Meta disconnects during a session, fallback only applies on the next session
- frames older than `3000ms` are treated as unavailable

## Meta Integration Notes

Meta integration is isolated behind:

- `src/services/metaWearablesBridge.ts`
- `src/services/frameProvider/metaGlassesProvider.ts`
- `src/services/glassesAudio.ts`

The current bridge is a typed stub for future native iOS/Android wiring. It does not fake unsupported SDK functionality. This keeps the Expo/JS app runnable while the native integration boundary remains explicit and minimal.

Auto-connect behavior:

- the app attempts to connect Meta glasses on startup
- every connect attempt is bounded to `2000ms`
- timeout or failure falls back safely to phone camera

## What Stage 3 Includes

- Tap `Start Aegis Vision`
- Keep the Stage 2 emergency pipeline intact
- Prefer Meta glasses frames when available
- Fall back to Expo phone camera when glasses are unavailable
- Preserve deterministic mock-mode frame input
- Show input-source status, connection state, active provider, last frame timestamp, and frame freshness
- Show a live phone preview only when phone camera is active
- Show the latest sampled frame snapshot when Meta glasses are active

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example env file:

```bash
cp .env.example .env
```

3. Choose a mode:

- Mock mode: leave `EXPO_PUBLIC_MEDBUD_USE_MOCKS=true`
- Live mode: set `EXPO_PUBLIC_MEDBUD_USE_MOCKS=false` and fill in the provider keys below

4. Start the app:

```bash
npm start
```

5. Run the type check:

```bash
npm run typecheck
```

## Required Permissions

Stage 3 still needs:

- microphone permission for recording audio
- camera permission for phone-camera fallback and phone preview

These permissions remain configured through Expo plugins in `app.json`.

## Required Environment Variables

```env
EXPO_PUBLIC_OPENAI_API_KEY=
EXPO_PUBLIC_OPENAI_MODEL=gpt-5.4-mini
EXPO_PUBLIC_ELEVENLABS_API_KEY=
EXPO_PUBLIC_ELEVENLABS_STT_MODEL_ID=scribe_v2
EXPO_PUBLIC_ELEVENLABS_TTS_VOICE_ID=
EXPO_PUBLIC_ELEVENLABS_TTS_MODEL_ID=eleven_multilingual_v2
EXPO_PUBLIC_MEDBUD_USE_MOCKS=true
```

## Mock Mode

Mock mode stays fully demoable without live API credentials or Meta hardware.

In mock mode:

- the mock frame provider is always selected
- parser, vision, merge, protocol, and TTS flow still run normally
- the app remains deterministic and demo-friendly

## Live Mode Notes

When `EXPO_PUBLIC_MEDBUD_USE_MOCKS=false`, the app will:

- upload recorded audio to ElevenLabs STT
- send transcript text to OpenAI Responses API for structured parsing
- send the selected provider’s latest fresh frame to OpenAI Responses API for structured vision extraction
- send the protocol engine instruction to OpenAI for short spoken rephrasing
- send the short spoken line to ElevenLabs TTS
- play the returned audio on the phone unless future glasses audio routing becomes available

## Security Warning

This prototype keeps provider keys in client-side Expo environment variables. Those keys are embedded into the app bundle and are not secure. This is acceptable only for local prototyping and short-lived demos.

For any production system, move provider access behind a backend or signed token model.

## Project Structure

```text
medbud/
  src/
    llm/
      parser.ts
    prompts/
      parserPrompt.ts
      visionPrompt.ts
      rephrasePrompt.ts
    protocol/
      engine.ts
      mergeState.ts
      types.ts
    screens/
      HomeScreen.tsx
    components/
      StatusBadge.tsx
      TranscriptCard.tsx
      JsonCard.tsx
      ResponseCard.tsx
      ErrorCard.tsx
    services/
      frameProvider/
        index.ts
        types.ts
        expoCameraProvider.ts
        metaGlassesProvider.ts
        mockProvider.ts
      camera.ts
      vision.ts
      glassesAudio.ts
      metaWearablesBridge.ts
      elevenlabsSTT.ts
      elevenlabsTTS.ts
      metaGlasses.ts
      openai.ts
      player.ts
      recorder.ts
    types/
      session.ts
    utils/
      env.ts
  App.tsx
```

## Future Native Wiring

Stage 3 keeps native Meta-specific code centralized and mobile-first:

- native Meta wearables SDK setup belongs behind `src/services/metaWearablesBridge.ts`
- JS provider selection belongs in `src/services/frameProvider/`
- UI should not directly call native Meta APIs

This lets the app keep working with mock mode and phone fallback while native bridge work evolves.
