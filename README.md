# 🤗 Simon Says

**Simon, as we call our virtual [Microduck](https://pollen-robotics.com/microduck/blog/introducing-microduck/), is a biped
robot duck from Pollen Robotics (Hugging Face).** He's 25 cm tall, has no arms, and out of the box he doesn't speak
words; he quacks. We gave him ears and a brain. Tell him *"take two steps forward, turn left, sit down"* and he does it,
using only open models running on a laptop.

Next, Simon will play Simon Says with you. He calls the moves, tries to catch you out, and your webcam is the referee.

> Status: work in progress. Voice control of the simulated duck works end to end. The Simon Says game is next.

## What it does today
- 🎙 **Speak to Simon** in the browser. A fully local voice agent —
  [huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech) with Parakeet (speech-to-text),
  Qwen3-4B via MLX (language model) and Qwen3-TTS (voice) — hears you and decides what to do.
- 🚶 **Simon moves for real (in simulation).** The model calls tools (`step_forward`, `turn_left`, `sit_down`, `bow`,
  `skates_on`, …) which drive Pollen's trained walking policies in their browser simulator (MuJoCo + ONNX).
- 📏 **Honest moves.** Every move is measured (centimetres walked, degrees turned). If Simon didn't actually move,
  he's told — and says so — instead of claiming success.
- 🧍 **Body language.** He looks up at you while listening, glances away while thinking, and his beak moves with his voice.
- 🔎 **The Inspector.** A live, readable log of every message between the page and the agent, plus live move
  traces. Most bugs in this project were found by looking at it.
- 🏁 **The relay race.** Where the time goes, per turn: listening → turn detection → speech-to-text → thinking → voice.
- 📷 **Webcam referee (in progress).** In-browser pose tracking (MediaPipe) — video never leaves your machine.

Everything runs locally: no API keys, nothing sent to the cloud (models download once from the Hugging Face Hub).

## Things we learned (and fixed upstream)
Building a real demo on top of `speech-to-speech` surfaced a few rough edges in the library. Fixes, with tests, on a
branch of the library (full test suite passing):

1. **Positional tool arguments were silently dropped** — small models often write `turn_left(360)`;
   now bound to parameters in order when unambiguous.
2. **Native tool-call syntax was read aloud** — after a few tool turns, Qwen switches to its native
   `<tool_call>{json}</tool_call>` format (because chat templates render earlier calls that way); it's now recognised.
3. **Tool markup leaked into speech when tools were disabled** for a response; now stripped.

And about robots: Pollen's walking policy won't start from a standstill on a pure "walk backwards" or "turn on the spot"
command — but will if you combine them, just like arrow-up + arrow-left on the keyboard. So Simon turns while creeping
forward, and backs up with a gentle zig-zag. (Found by a human with a keyboard, confirmed with a physics-stepped test.)

The full story, with commands, timings and gotchas, is in the devlog: [`notes/`](notes/).

## Run it (macOS, Apple Silicon)
Tested on an M3 Pro with 18 GB. The agent uses about 8 GB of memory.

1. **The voice agent** (from source, so the fixes above are included):
   ```bash
   git clone https://github.com/huggingface/speech-to-speech.git
   cd speech-to-speech && uv sync --python 3.11
   ```
   *(Until the fixes are merged upstream, check out the `tool-call-positional-args` branch from this project's fork.)*
2. **The simulator** — Pollen's browser sim with a small embed patch (see [`sim/README.md`](sim/README.md)):
   download the Space, apply `sim/embed-and-jaw.patch`, `npm ci && VITE_BASE=/sim/ npm run build`.
3. **Duck Lab** (this repo):
   ```bash
   cd micro-duck && uv run duck-lab      # or double-click "Duck Lab.command"
   ```
   Open **http://localhost:8770**, click **Start agent**, wait for green **Ready** (first run downloads ~7.5 GB of
   models), then **Tap to talk**: *"Take two steps forward."*

> ⚠️ If model downloads fail with `CERTIFICATE_VERIFY_FAILED`, your Python lacks root certificates;
> the lab sets `SSL_CERT_FILE` to certifi's bundle for you. See [`notes/01-local-voice-agent.md`](notes/01-local-voice-agent.md).

## How it's built
```
 browser (Duck Lab)                                   your Mac
 ┌───────────────────────────────┐   WebSocket    ┌──────────────────────────────────────┐
 │ mic ─► Realtime client ───────┼──────────────► │ speech-to-speech                     │
 │        ◄─ audio, transcripts, │ ◄───────────── │ VAD → Parakeet → Qwen3-4B → Qwen3-TTS │
 │           tool calls          │                └──────────────────────────────────────┘
 │ tool call ─► duck-tools.js ─► │  window.rl     ┌──────────────────────────────────────┐
 │   (measured, honest)          ├──────────────► │ Pollen's Microduck sim (iframe)       │
 │ Inspector · relay race        │                │ MuJoCo (WASM) + ONNX walking policies │
 └───────────────────────────────┘                └──────────────────────────────────────┘
        ▲ stage timings (SSE) from lab/server.py, which starts/stops the agent
```
| File | Role |
|---|---|
| `lab/server.py` | Starts/stops the agent, streams its timings, serves the page, sim and moves |
| `lab/static/app.js` | Browser voice client (OpenAI Realtime protocol), UI, tool handling |
| `lab/static/duck-tools.js` | Simon's moves, measured |
| `lab/static/duck-body.js` | Head poses, beak, camera, keyboard |
| `lab/static/inspector.js` | The Inspector |
| `lab/static/pose.js` | Webcam pose tracking (tested with `node --test lab/static/tests/pose-rules.test.mjs`) |

## Roadmap — and a mini tutorial series
1. An open voice agent on your laptop — and where the latency goes
2. Talking to a robot: tools, honest agents, and building the Inspector first
3. Your webcam as a referee: body tracking in the browser
4. Build a voice game master: **Simon (the duck) says…**
5. *Take it further:* multiplayer Simon Says over peer-to-peer WebRTC

Also on the list: a creature voice (Simon quacks instead of talking), and a Hugging Face Space to try it in a browser.

## Credits & licences
- **Microduck**, its simulator and trained policies: [Pollen Robotics](https://github.com/pollen-robotics) (Hugging Face).
  Microduck's software stack is open source; its hardware design is not. This repo does **not** redistribute the
  simulator — it ships a small patch (`sim/embed-and-jaw.patch`) applied to your own download.
- The "polite bow" move is a community-trained policy by [fffiloni](https://huggingface.co/fffiloni/microduck-polite-bow-b1d864),
  downloaded at runtime.
- Voice agent: [huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech). Pose tracking:
  [MediaPipe](https://ai.google.dev/edge/mediapipe) (loaded from a CDN).

Made by [Liz Myers](https://github.com/LizMyers), with Claude.
