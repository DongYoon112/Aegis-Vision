# Aegis Vision Stage 1

Aegis Vision is a one-screen React Native prototype for the core tap-to-start loop of an AI emergency assistant. In this build, the assistant agent is named Stitch. Stage 1 is phone-first: the phone handles recording, provider calls, and playback, while Meta Ray-Ban integration is intentionally stubbed behind service interfaces for later work.

## What Stage 1 Includes

- Tap `Start Aegis Vision`
- Record a short audio clip on the phone
- Send audio to ElevenLabs Speech-to-Text
- Send the transcript to OpenAI Responses API
- Render a structured emergency JSON result and a short spoken response
- Send the spoken response text to ElevenLabs Text-to-Speech
- Play the returned audio on the phone
- Fall back to reliable mock mode when live APIs are not being used

## What Stage 1 Does Not Include

- No backend
- No auth
- No database
- No wake word
- No glasses integration yet
- No advanced vision yet
- No full medical diagnosis

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

5. Optional checks:

```bash
npm run typecheck
```

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

Mock mode is the default because it keeps the prototype demoable without external credentials. In mock mode:

- recording still happens on-device
- STT returns a canned emergency-style transcript
- OpenAI returns a deterministic structured result and short spoken line
- playback uses on-device speech so the app still talks back

## Live Mode Notes

When `EXPO_PUBLIC_MEDBUD_USE_MOCKS=false`, the app will:

- upload the recorded clip to ElevenLabs STT
- send the transcript to OpenAI Responses API
- send the short spoken response to ElevenLabs TTS
- save the returned audio locally and play it on the phone

## Security Warning

This Stage 1 prototype puts provider keys in client-side Expo environment variables. That means they are embedded into the app bundle and are readable by anyone who can run or inspect the app. This is acceptable only for short-lived demos and local prototyping.

For anything production-facing, move OpenAI and ElevenLabs calls behind a backend or signed token flow.

## Project Structure

```text
medbud/
  src/
    screens/
      HomeScreen.tsx
    components/
      StatusBadge.tsx
      TranscriptCard.tsx
      JsonCard.tsx
      ResponseCard.tsx
      ErrorCard.tsx
    services/
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

## Stage 2 Integration Notes

Meta Ray-Ban support is intentionally abstracted and not implemented in Stage 1.

The main extension points are:

- `src/services/metaGlasses.ts`
  - future glasses availability, audio routing, and frame access contract
- `src/services/recorder.ts`
  - current phone microphone implementation
  - future swap point for glasses microphone input
- `src/services/player.ts`
  - current phone speaker playback implementation
  - future swap point for glasses audio output

Stage 2 can add:

- latest-frame capture interface
- sampled frame analysis
- structured vision output

without rewriting the Stage 1 screen flow.
