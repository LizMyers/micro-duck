# Tutorial mini-series — "Simon Says: build a voice-controlled robot duck"
*Draft outline by Liz, 2026-09-23. A possible series to make if hired — ready to hit the ground running with 4–5 episodes.*

## The idea
Five short tutorials. Each ends with something that **works and can be shared** (a clip, a Space, a pull request),
and each teaches one idea about **robots**, **reinforcement learning (RL)** or **Hugging Face** along the way.
By the end, readers have built Simon Says with a robot duck — and understand what's going on under the hood.

## How we share the code *and* teach something real
**Code: one repo, one checkpoint per episode.**
- Tags/branches `ep1-sim`, `ep2-move`, `ep3-voice`, `ep4-camera`, `ep5-simon-says`. Each runs on its own.
- Each episode starts from the previous checkpoint and changes only a few files, so the diff *is* the lesson.
- "Stuck? `git checkout ep3-voice`" — nobody gets left behind.

**Learning: every episode has the same four parts.**
1. **Build** — the steps, copy-pasteable, ending in a demo.
2. **Understand** — one concept box (robots / RL / HF), in plain English, with a picture.
3. **Try it** — a small exercise that changes behaviour (not just "run it").
4. **Take it further** — an optional deeper path for the curious.

**Three threads running through the series**
| Thread | What readers come away understanding |
|---|---|
| 🤖 Robots | Simulation, sim-to-real, a 50 Hz control loop, what a policy *sees* (61 numbers) and *does* (14 motor targets) |
| 🎓 Reinforcement learning | How Simon learned to walk (4,096 simulated ducks, rewards, PPO), why a policy has "habits", how to train your own move |
| 🤗 Hugging Face | The Hub (policies and models as repos, model cards), Spaces (share a demo), open models, the `speech-to-speech` library, community contributions |

No GPU required for episodes 1–5: they use pretrained policies and small local models.
Training your own move is a "Take it further" (Colab / HF Jobs).

---

## Episode 1 — Meet Simon: get the simulator running
- **Build:** Run Pollen's Microduck simulator in the browser (or Duck Lab). Drive with the arrow keys. Change colourway.
- **Understand (🤖 + 🤗):** What a simulator is and why robots learn in one (safe, fast, thousands at once).
  The sim runs **MuJoCo physics + an ONNX policy** entirely in your browser; it's an HF **Space**.
- **Try it:** Find a move the duck *can't* do from standing still. (Pure ↓ or pure ←/→ — it just stands there!)
- **Take it further:** Open the policy file: 61 numbers in, 14 out, 50 times a second (`notes/…` table).
- **Share:** a GIF of your duck.

## Episode 2 — Get moving: forward, back, left, right, sit, stand
- **Build:** Control Simon from code (`window.rl`): step forward/back, turn left/right, sit, stand — and *measure*
  what actually happened (centimetres, degrees).
- **Understand (🎓):** **A policy has habits.** Why won't Simon back up or turn from a standstill? Because of what he
  saw in training — command ranges, standing-still curriculum, rewards. Combining commands (creep forward while
  turning, zig-zag backwards) stays "in distribution". The bug is the RL lesson.
- **Try it:** Tune the turn recipe; measure degrees turned vs forward creep.
- **Take it further:** Load a **community-trained move** from the Hub (the polite bow). Read its training card
  (4,096 envs, 1,000 PPO iterations).
- **Share:** "Simon walks a square" clip.

## Episode 3 — Add voice: talk to Simon
- **Build:** Run HF's `speech-to-speech` locally (open models, no API key). Connect the browser over the Realtime
  protocol. Give the model **tools** so "take two steps forward" becomes `step_forward(steps=2)`.
- **Understand (🤗 + agents):** The voice relay race (VAD → turn detection → speech-to-text → language model → voice) and
  where the time goes. Tool calling with *small* models: simple tools, "body rules", and **honest agents** (report what
  the body really did).
- **Try it:** Swap the language model or personality; compare latency and obedience in the Inspector.
- **Take it further:** The Inspector as a debugging habit — and the real library bugs we found with it (upstream PRs).
- **Share:** a clip of you steering Simon to the ball by voice.

## Episode 4 — Add the camera: your webcam as a referee
- **Build:** In-browser pose tracking (MediaPipe): detect look up/down/left/right, turn, step, sit — privately,
  video never leaves the browser. Calibrate to your normal stance.
- **Understand (🤖):** Perception: landmarks, visibility, "held for 300 ms", thresholds relative to *your* body.
  **Left vs right** from the camera's view vs yours (the mirror trap).
- **Try it:** Add a new pose check with a unit test.
- **Take it further:** Why robots need perception *and* control — closing the loop.
- **Share:** a GIF of the pose chips lighting up.

## Episode 5 — Bring it together: Simon Says
- **Build:** A game master: Simon calls commands (sometimes without "Simon says…"), demonstrates some, and the
  webcam judges you. Score, streak, speeding up.
- **Understand (agents):** Turn-taking and timing in voice interaction — rhythm, interruptions, when the agent should
  *not* talk. Game state outside the model; the model gives personality.
- **Try it:** Make Simon sneakier (trap rate, tempo) or kinder (practice mode).
- **Share:** publish your Simon Says as an **HF Space**.

## Take it further (finale)
- **Multiplayer Simon Says** over peer-to-peer WebRTC (the sim's hidden "ghost" channel) — `notes/ideas.md`.
- **Train your own move** (e.g. a proper "look around" or a dance) with Pollen's `microduck_rl`, publish it to the Hub,
  and load it into Simon.
- **Simon's own voice:** quacks instead of words, beak synced to the sound (Pollen's `sounds` synth).
- **Sim-to-real:** the same code on a real Microduck.

## Field notes: short investigation posts (Liz, 2026-09-25)
Small, self-contained posts alongside the main series. Each has the same shape: **a question, a measurement, a
finding, and what we changed**. Most of the raw material is already in `lab/logs/` and the devlog. Home: the
Tutorials section on lizm.dev (or a "Field notes" subsection), cross-posted as HF community articles.

1. **Where does the time go in a local voice agent?** Hear / Turn / Think / Speak, measured. Finding: Think is the
   bottleneck (1.3–2 s per uncached game line); Hear (Parakeet) is 0.05–0.3 s.
2. **Picking a voice for your agent: Kokoro vs Qwen3-TTS.** RAM, time to first sound, run-ons, how it sounds.
3. **Nine voices, one duck: a listening test.** All Qwen3-TTS preset voices on the same line, incl. the dialect
   voices (eric: Sichuan, dylan: Beijing). Liz's verdict: **Aiden, by a mile**. The post can explain
   what made the difference.
4. **Local vs hosted: where should each stage run?** RAM, latency, cost, privacy; a hybrid setup (hosted Think via
   HF Inference Providers, local Hear/Speak).
5. **When the voice model won't stop talking.** The Qwen3-TTS run-on (28.8 s for "Simon says, turn left."), the
   ✂️ cut-off, and the "digits at the end" hypothesis.
6. **Scripted vs improvised: making a small model play fair.** Exact commands, improvised reactions, moods, the
   "Sure, here's my best look up" answer, and the runaway "Ohhhh…".
7. **Can a voice model change its tone?** Qwen3-TTS style instructions: fixed per session vs per reply.
8. **Small models and tool calls.** Positional arguments, native `<tool_call>` blocks, and the upstream fixes.
9. **Your webcam as a fair referee.** Left vs right, head turns vs body turns, strict traps and arms.
