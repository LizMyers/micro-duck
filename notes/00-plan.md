# 00 · Plan

*2026-09-23*

## Goal
A voice-interaction project for **Microduck** (Pollen Robotics / Hugging Face) built on Hugging Face's
open-source [`speech-to-speech`](https://github.com/huggingface/speech-to-speech) library — as a portfolio
piece for HF's *Senior ML Engineer, Voice Agents* role (or a dev-rel wildcard application).

## The angle: a voice agent for a robot that can't talk
Microduck is deliberately wordless — it quacks, in a voice generated from its own serial number.
Take the words away and what's left is everything else a voice pipeline has to get right:
**timing, turn-taking, prosody, barge-in, embodiment.** That's the job description.

## Constraints that shaped the plan
- **No hardware.** Microduck is pre-order only ($399, ships ~Christmas 2026). → Simulation first; aim to "earn" one.
- **Applying ASAP.** → Each milestone must end in something demoable on its own.
- **GPU-poor.** HF's posting celebrates it. → Everything runs locally on a laptop with open models.

## Why not cloud APIs + a proprietary LLM?
First instinct was cloud STT → hosted LLM → cloud TTS (fastest to a working loop). Dropped once the target
became HF's voice-agents team: the point is to show fluency with *their* open stack.

## Milestones
1. **Local open voice agent** — `speech-to-speech` fully local on Apple Silicon; baseline latency.
2. **Creature voice** — a new TTS backend for `speech-to-speech` that renders the LLM's words as
   prosody-matched quacks (port of Microduck's Apache-2.0 `sounds` synth) *plus* a synced beak track.
3. **Embodiment in sim** — tool calls → robot moves; beak sync; barge-in = duck stops and tilts its head.
4. **Ship** — HF Space (talk to a sim duck in the browser), upstream PR, blog post, short video, quickstart.

## Architecture (target)
```
 mic ──► speech-to-speech server (local, OpenAI Realtime protocol)
          VAD ─► STT (Parakeet) ─► LLM (Qwen3-4B, MLX) ─► TTS = creature voice ✱
                                         │ tool calls            │ audio + mouth track
                                         ▼                       ▼
                                   duck bridge (Realtime client) ─► sim duck (moves, beak, quacks)
```
✱ the new piece we contribute upstream.
