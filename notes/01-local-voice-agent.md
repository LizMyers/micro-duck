# 01 · An open voice agent, fully local on a Mac

*2026-09-23 · Apple M3 Pro 18 GB · macOS 27.0 · speech-to-speech 1.0.0 (commit a657659) · Python 3.11 via uv 0.8.4*

**Goal:** get Hugging Face's `speech-to-speech` running with open models only — no API keys, no cloud — and
measure how fast it answers. This is the "brain" the duck will use.

## What gets downloaded, and why (plain English)
A voice agent is a relay race of small specialist models. Each one does a single job:

| Stage | Job | Model | Size | Why this one |
|---|---|---|---|---|
| VAD (voice activity detection) | "Is someone talking right now?" | Silero VAD v5 | ~2 MB | Tiny, runs on CPU, industry standard |
| Turn detection | "Have they *finished* their thought, or just paused?" | Smart Turn v3.2 (pipecat) | ~8 MB | Listens to *how* you stopped (intonation), not just silence — fewer rude interruptions |
| STT (speech-to-text) | Turns your voice into text | Parakeet TDT 0.6B v3 (MLX) | ~2.5 GB | Very fast, accurate, runs on Apple's GPU |
| LLM (language model) | Decides what to say | Qwen3-4B Instruct, 4-bit (MLX) | ~2.3 GB | Small enough for a laptop, smart enough to chat; 4-bit = compressed to fit in memory |
| TTS (text-to-speech) | Turns the reply into a human voice | Qwen3-TTS 1.7B CustomVoice, 6-bit (MLX) | ~2.7 GB | Natural voice that streams |

"MLX" = Apple's framework for running models on Apple Silicon. Models download once into
`~/.cache/huggingface/hub` and are reused.

> 🦆 For the duck, the **TTS model gets replaced** by Microduck's creature voice — which is pure maths
> (additive synthesis), not a neural network. Nothing to download, near-zero latency, and it runs on the
> robot's own 1 GB board.

## Steps

### 1. Install (from source, so we can contribute back later)
```bash
cd ~/Documents/Development
git clone https://github.com/huggingface/speech-to-speech.git
cd speech-to-speech
uv sync --python 3.11
```

### 2. Start the server, fully local
```bash
cd ~/Documents/Development/speech-to-speech
export SSL_CERT_FILE=$(.venv/bin/python -c "import certifi; print(certifi.where())")   # see gotcha 1
.venv/bin/speech-to-speech serve \
    --mac-optimal-settings \
    --model_name mlx-community/Qwen3-4B-Instruct-2507-4bit
```
First run: ~4 min (downloads + warm-up). Ready when you see
`Uvicorn running on http://127.0.0.1:8765`. The server speaks the **OpenAI Realtime protocol** at
`ws://127.0.0.1:8765/v1/realtime` — any Realtime client can connect.

> Want to just talk to it? Use `local` instead of `serve` — it opens your mic and speaker. Wear headphones.

### 3. Talk to it without a microphone (repeatable benchmark)
The repo ships a client that synthesises questions with macOS `say` and streams them in:
```bash
HF_TOKEN=local-unused .venv/bin/python scripts/synthetic_conversation_realtime_client.py \
    --turns 3 --interval 20 --log-dir /tmp/bench1
```
(See gotcha 2 for the fake token.) Outputs a transcript + the assistant's audio as a WAV.

## Gotchas

> ⚠️ **Gotcha 1 — `CERTIFICATE_VERIFY_FAILED` on startup.**
> `urllib.error.URLError: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate>`
> while downloading Silero VAD from GitHub (and NLTK data).
> **Why:** uv picked the python.org build of Python 3.11, which ships without root certificates until you run its
> `Install Certificates.command`. **Fix (no system change):** point Python at certifi's bundle:
> `export SSL_CERT_FILE=$(.venv/bin/python -c "import certifi; print(certifi.where())")`

> ⚠️ **Gotcha 2 — benchmark client demands `HF_TOKEN` even for localhost.**
> `HF_TOKEN env var is not set.` The local server doesn't check it; any value works. (Candidate tiny upstream PR:
> only require the token for `--lb-url`.)

> ℹ️ `DeepFilterNet not available` — harmless; it's an optional noise-cleanup add-on.

## Results (baseline, 3 turns)
Transcript:
```
USER: What is the capital of France?     STT: What is the capital of France?
BOT:  The capital of France is Paris.
USER: Tell me a joke about robots.       STT: Tell me I joke about robots.
BOT:  Sure, here's my best robot laugh!
USER: How does photosynthesis work?      STT: How does photo centers this work?
BOT:  Photo centers use auto-focus and image processing to center your photo in the frame.
```

**Latency — end of your speech → first audio out**

| Turn | Total | Notes |
|---|---|---|
| 1 | 9.8 s | cold: first LLM call warms up |
| 2 | 2.5 s | turn detect 0.08 s · STT 0.30 s · **LLM ≈ 2.1 s** · TTS first audio 0.18 s |
| 3 | 2.6 s | turn detect 0.06 s · STT 0.28 s · **LLM ≈ 2.0 s** · TTS first audio 0.21 s |

**Takeaways**
1. **The LLM is ~80% of the wait.** Speech in/out is already fast. That's where to optimise (smaller model,
   shorter replies, streaming the first words sooner).
2. **Errors cascade.** "photosynthesis" → "photo centers" (STT) → a confident answer about cameras (LLM).
   A pipeline is only as good as its first link. (Partly our fault: macOS `say` is not a real human voice.)
3. Hypothesis for the duck: dropping neural TTS for a synthesised creature voice removes ~0.2 s and ~2.7 GB.

## Demo
"An open-source voice assistant running entirely on my laptop — no cloud, no API key — answers in ~2.5 s."

## Tutorial seeds
- *"What's actually inside a voice agent?"* — the relay-race table above, with a diagram.
- *"Fixing CERTIFICATE_VERIFY_FAILED on macOS Python"* — tiny, very searchable.
- *"Where does voice-agent latency go?"* — the timing table; why the LLM dominates.
- *"The photosynthesis bug"* — how errors cascade through a pipeline.
