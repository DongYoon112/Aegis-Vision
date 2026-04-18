# Aegis Vision Stage 2

Aegis Vision is a one-screen Expo React Native prototype for an AI-assisted emergency workflow. The assistant is named Stitch. Stage 2 adds sampled camera-frame analysis and a rule-based protocol engine while preserving the phone-first prototype model and mock-mode demo path.

## Stage 2 Architecture

The pipeline is fixed and intentional:

```text
audio -> STT -> parser -> vision -> merge -> protocol engine -> GPT rephrase -> TTS
```

Important constraints:

- the protocol engine is the only decision-maker
- GPT is used only for structured parsing, structured vision extraction, and short spoken rephrasing
- sampled frames are analyzed, not continuous uploaded video
- all model outputs are validated and sanitized before use

## What Stage 2 Includes

- Tap `Start Aegis Vision`
- Record a short audio clip on the phone
- Sample a camera frame every `1.5s` while the session is active
- Run ElevenLabs Speech-to-Text
- Parse the transcript into structured emergency state
- Analyze the latest sampled frame into structured scene state
- Merge parser state and vision state with parser-first safety rules
- Run a rule-based protocol engine
- Rephrase the chosen instruction into a short Stitch response
- Run ElevenLabs Text-to-Speech
- Play the response on the phone
- Show transcript, parser JSON, vision JSON, merged state JSON, protocol decision, and error output on one screen

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

Stage 2 needs:

- microphone permission for recording audio
- camera permission for sampled frame analysis

These are configured through Expo plugins in `app.json`.

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

Mock mode stays fully demoable without live API credentials.

In mock mode:

- audio still records on-device
- camera preview and frame sampling still run locally
- parser returns a validated structured mock casualty state
- vision returns a validated structured mock scene state
- merge and protocol logic still run normally
- Stitch speech falls back to on-device voice playback

## Live Mode Notes

When `EXPO_PUBLIC_MEDBUD_USE_MOCKS=false`, the app will:

- upload recorded audio to ElevenLabs STT
- send transcript text to OpenAI Responses API for structured parsing
- send the sampled frame to OpenAI Responses API for structured vision extraction
- send the protocol engine instruction to OpenAI for short spoken rephrasing
- send the short spoken line to ElevenLabs TTS
- play the returned audio on the phone

## Security Warning

This prototype keeps provider keys in client-side Expo environment variables. Those keys are embedded into the app bundle and are not secure. This is acceptable only for local prototyping and short-lived demos.

For any production system, move provider access behind a backend or signed token model.

## Protocol Behavior

The protocol engine uses this fixed priority order:

1. `severe_bleeding === true`
2. `responsive === false && breathing === null`
3. `person_visible === false`
4. `image_quality !== "usable"`
5. `confidence < 0.55`
6. fallback

Breathing checks intentionally outrank camera-positioning prompts.

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
      camera.ts
      vision.ts
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

## How Meta Ray-Ban Integration Will Replace Or Augment Expo Camera Input In Stage 3

Stage 2 uses Expo Camera as the phone-first frame source. Stage 3 should keep the same parser, merge, protocol, rephrase, and TTS layers while swapping or augmenting the input providers:

- `src/services/camera.ts`
  - current source of sampled phone frames
  - future swap point for Meta/Ray-Ban frame capture
- `src/services/metaGlasses.ts`
  - current placeholder service
  - future source for glasses camera frames and wearable audio routing
- `src/services/recorder.ts` and `src/services/player.ts`
  - current phone microphone and speaker paths
  - future swap points for glasses audio input and output

The goal for Stage 3 is to replace or augment the capture layer, not to move protocol authority into the model.
