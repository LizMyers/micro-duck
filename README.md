# Simon Says with Microduck

**A tiny robot duck. A cheeky voice. A game you already know.**

Meet Simon: a virtual [Microduck](https://pollen-robotics.com/microduck/blog/introducing-microduck/) from Pollen Robotics. He calls the moves, tries to catch you out, and celebrates when he wins. Your webcam is the referee.

Open models running on a Mac give Simon his voice and personality. Chat between games, then play seated at your desk, with head turns and raised arms.

[The design story on LizM.dev](https://lizm.dev) · [Development notes](notes/)

## One round with Simon

| Simon says… | Your move | What happens |
| --- | --- | --- |
| **“Simon says, look left.”** | Look left and hold it. | The webcam checks your move. You’re through! |
| **“Raise both arms!”** | Stay still. He didn’t say Simon says. | Nice try, Simon. |
| **“Simon says, raise your right arm.”** | Raise your left arm instead. | He catches you out — and gets his moment to gloat. |

Get all five rounds right to win a game. Make a mistake and Simon wins. The scoreboard keeps your running totals, and he asks for a rematch.

Before you play, camera setup helps you face forward and leave enough room for your arms. Moves must be held for a second; the response timer starts after Simon finishes the command. If you leave the camera’s view mid-round, that round doesn’t count.

Simon has no arms, so he can call arm moves but can’t demonstrate them. 

## Fair rules. Plenty of personality.

**The browser runs the game.** Code chooses commands and traps, checks poses, and records the result. Simon’s language model doesn’t decide whether you won.

**The voice makes it feel alive.** Qwen3-TTS gives Simon his expressive Aiden voice. Repeated commands and score lines use saved, checked audio, avoiding fresh generation on every turn. If a command can’t be spoken cleanly, the game skips it rather than judging you against a broken instruction.

**Conversation leaves room for surprise.** Between games, a local voice agent handles chat. Generated reactions add variety, while head movements, quacks, and a moving beak bring the simulated duck to life.

Speech processing runs on your Mac; webcam pose tracking runs in your browser. No cloud inference or API keys. Model downloads and CDN-hosted pose assets still need internet access.

## Run it on your Mac

Tested on Apple Silicon: M3 Pro, 18 GB memory. The voice agent uses roughly 8 GB; its models download on first use.

One-time setup includes installing [speech-to-speech from source](notes/01-local-voice-agent.md#1-install-from-source-so-we-can-contribute-back-later) with `uv` and Python 3.11, and [building the patched simulator](sim/README.md) with Node/npm. The voice-agent integration also relies on local changes described in the [tool-call notes](notes/upstream-pr-tool-calls.md); this repo does not ship those changes or an automated setup script.

Once those dependencies are installed:

```bash
cd micro-duck
uv run duck-lab
```

Or double-click **Duck Lab.command** in Finder. The launcher opens **http://localhost:8770/play** and starts the voice agent. Wait for **READY**, complete camera setup, and press **Play!**

For conversation, tap the talk button or hold Space. For diagnostics, open **http://localhost:8770**. If your dependency folders are elsewhere, set `S2S_DIR` and `SIM_DIST`; see [running the lab](notes/running-the-lab.md) for logs and restart controls.

<details>
<summary><strong>Under the hood</strong></summary>

| Part | Responsibility |
| --- | --- |
| Silero VAD + Smart Turn | Speech activity and turn detection |
| Parakeet TDT 0.6B v3 | Speech to text via MLX |
| Qwen3 4B Instruct | Local conversation and tool calls |
| Qwen3-TTS 1.7B CustomVoice | Speech and saved voice lines |
| MediaPipe Pose Landmarker | Browser webcam referee |
| MuJoCo + ONNX policies | Microduck simulation and movement |
| FastAPI + speech-to-speech | Local server and voice-agent connection |

Game rules: `lab/static/simon-says.js`. Pose checks: `pose.js`. Voice caching: `voice-lines.js`. Player UI: `play.js`. The Inspector shows messages, movement traces, and voice timings.

Run the game and pose tests with `node --test lab/static/tests/*.test.mjs`.

</details>

## Credits

[Microduck and its simulator](https://huggingface.co/spaces/pollen-robotics/microduck-simulator): Pollen Robotics. Voice pipeline: [Hugging Face speech-to-speech](https://github.com/huggingface/speech-to-speech). Pose tracking: [MediaPipe](https://ai.google.dev/edge/mediapipe). Community bow policy: [fffiloni](https://huggingface.co/fffiloni/microduck-polite-bow-b1d864).

This repo includes a simulator patch, not the simulator itself. See [sim/README.md](sim/README.md) for setup and licence notes.

Made by [Liz Myers](https://github.com/LizMyers), with Claude.
