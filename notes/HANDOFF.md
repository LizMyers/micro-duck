# HANDOFF — Micro Duck / Duck Lab
*Written 2026-09-23 late evening, before a context compaction. Read this first.*

## Who / why
- **Liz** (GitHub `LizMyers`) is building this as a portfolio piece for Hugging Face's
  *Senior ML Engineer, Voice Agents* role (or a dev-rel "wildcard" application). She's strong on dev rel and
  content and new to building APIs; Claude builds the engineering. Explain things in plain English.
- **Goal:** Simon Says with **Simon, a simulated Pollen Microduck** (a robot duck with no words and no arms), driven by
  HF's open-source `speech-to-speech` voice agent running locally. The work doubles as a 4–5 part tutorial series.
- **Time pressure:** Liz doesn't want to sink too much unpaid time in before applying. Keep to *one thing at a time*,
  limit how long each step takes, then package and apply.

## How Liz likes to work (important)
- **Show, don't hide.** She got frustrated when Claude debugged alone in the terminal. Make things visible in the page
  (the Inspector) and let *her* run the live tests. She pastes Inspector logs (the Copy button) back to you.
- One thing at a time. Plain-English explanations. Keep the devlog (`notes/`) updated for tutorials.
- Commits: author "Liz Myers <elizmyers@gmail.com>", end the message with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. The repo is **private**: github.com/LizMyers/micro-duck.

## Where things live
| Path | What |
|---|---|
| `~/Documents/Development/micro-duck/` | This repo: Duck Lab (`lab/`), notes (`notes/`), sim patch (`sim/`) |
| `~/Documents/Development/speech-to-speech/` | HF library, editable install, branch **`tool-call-positional-args`** (3 upstream fixes, see below). The agent runs from here. |
| `~/Documents/Development/microduck-simulator/` | Pollen's browser sim (HF Space `pollen-robotics/microduck-simulator`) plus our patch (`micro-duck/sim/embed-and-jaw.patch`). Rebuild: `cd app && VITE_BASE=/sim/ npm run build` |
| `micro-duck/microduck-press-kit/` | Pollen press kit (gitignored). Stickers are OK to use; photos are press-only. Never call Microduck "open-source hardware". |

## How to run
- Double-click **`Duck Lab.command`** (or `cd micro-duck && uv run duck-lab`), then open **http://localhost:8770**
  (it's `localhost`: Liz once typed 127.0.0.0 by mistake).
- Brain tab → **Start agent** (Qwen3 4B), about 1–3 min until the green "Ready". The lab remembers the model and
  restarts the agent itself after a lab restart (`lab/.agent-state.json`).
- Agent logs go to `lab/logs/agent-*.log`. The agent accepts **one connection at a time**: Liz's tab holds it.
- Headless-Chrome checks: use `--timeout=12000 --screenshot` (not `--virtual-time-budget`, which hangs on the SSE
  connection); give each run its own `--user-data-dir` and always `pkill` it afterwards. Physics runs slowly headless,
  so for movement tests use `lab/static/policy-test.html` (it steps physics with `rl.step`). Watch memory:
  18 GB Mac, the agent takes about 8 GB.

## Architecture (as of now)
- `lab/server.py`: FastAPI. Starts and stops `speech-to-speech serve --mac-optimal-settings`, parses its logs into
  stage events (SSE `/api/events`), serves the sim at `/sim/`, the moves at `/moves/` (the polite-bow ONNX plus our manifest)
  and the test prompts. It sends `Cache-Control: no-store`: Chrome once cached old JS.
- `lab/static/app.js`: Realtime WebSocket client (24 kHz PCM), chat, relay-race timings, tools, tests, webcam wiring.
  - `sessionUpdate()` sends `instructions + BODY_RULES`, `tools: TOOLS`, `tool_choice: "auto"`.
  - On a tool call: start the move, report `{status:"started"}` at `response.done` straight away (the agent blocks
    otherwise), and follow up only if the move fails. Follow-ups use `sayOnly()` = `response.create` with `tool_choice:"none"`.
- `lab/static/duck-tools.js`: 11 tools (sit_down, stand_up, step_forward/back{steps}, turn_left/right{degrees}, bow,
  kick_left/right_leg, skates_on/off). Every move is **measured** (cm / degrees) and reported honestly.
  **The policy won't start moving from a standstill for a pure back or pure turn command:** turning = creep forward
  0.12 while turning; backwards = zig-zag wz ±1 every 0.5 s; forward = full 0.25 speed. The move queue runs one at a time.
- `lab/static/duck-body.js`: moods set head poses via `rl.headTarget`, the beak follows reply loudness, the camera faces
  the duck, the Sky colourway, arrow keys forwarded from anywhere (stuck keys released on blur).
- `lab/static/inspector.js`: the right-hand "Inspector" tab. `lab/static/pose.js`: MediaPipe pose tracker
  (tests: `node --test lab/static/tests/pose-rules.test.mjs`, 19 pass).
- Sim hooks we added (`window.rl`): `setJaw`, `setTwist`, `yaw`, `velLimits`, `sit/stand/sitting`, `unlockInputs`;
  `?embed=1` = just the duck, entrance auto-plays, controls unlocked after 3 s, **multiplayer ghosts disabled**.

## Layout (current)
Top bar: brand · relay race strip (Listen/Turn/Hear/Think/Speak · "Reply in") · status.
Left: **Simon the duck** (📷 Camera, 🛼 Skates, mood) with webcam picture-in-picture + pose chips; below it the
Brain / Voice & personality / Tests tabs. Right: **Conversation | Inspector | Agent log** tabs, Tap-to-talk at the bottom.

## Upstream (HF speech-to-speech), branch `tool-call-positional-args`, not pushed / no PR yet
- d48083e: bind purely positional tool-call args by parameter order
- ce56257: recognise native `<tool_call>{json}</tool_call>` blocks (Qwen falls back to them after tool turns)
- 6e117d4: strip tool markup from speech when `tool_choice="none"`
Full suite 1702 passed; ruff clean. Liz decides if and when to open a PR (she may just link the branch in the application).
Other candidates: `notes/research/upstream-candidates.md` (Gemma end-of-turn and role-alternation, and others).

## Known issues
- **Buttons aren't clear (Liz, end of day):** Start agent / "Restart with this model" / Stop / Camera / Skates /
  Calibrate / Apply are confusing. → Tomorrow item 1.
- Gemma 3 1B doesn't work (marked in the dropdown). SmolLM3 and Llama 3.2 are untested.
- Replies slow down as the conversation grows (2k-token prompts → 9–13 s), and then Liz talks over the wait and
  replies get cancelled. Ideas: a "🤔 thinking…" indicator, trimming the history, and a Clear button that also resets
  the agent's conversation.
- Pose thresholds come from synthetic test data; they haven't been tuned on Liz yet.
- `recordings/` is gitignored (screenshots live only locally).

## Plan for tomorrow (in order, one at a time)
1. **Make the buttons clear.** Ask Liz what confuses her; likely: one clear agent control (●Start → Loading… →
   ■Stop, with "switch model" separate), labelled toggles ("📷 Camera: off/on"), explain Calibrate inline, and group
   Apply with the personality. Keep it small.
2. **Simon's new moves** for the v1 vocabulary (decided, in `notes/ideas.md`):
   *take 1–2 steps forward|back, turn left|right, look up|down|left|right, sit down, stand up.*
   Add `look_up/down/left/right` (head poses via `rl.headTarget`; hold ~1.5 s, then back to neutral). Update the tools
   and BODY_RULES. Remember: Simon faces you, so **his left is your right** (that's the trap).
3. **New pose checks** in `pose.js` (with node tests): look L/R/U/D (face landmarks relative to shoulders),
   turned L/R (shoulder-width shrink / face turned), stepped forward/back (shoulder width vs calibration),
   sat (head drop, the existing crouch), stood (back to baseline). Liz tests them live with the pose chips.
4. **Game master (single player):** a Simon Says tab. Simon calls a command (spoken via `sayOnly`-style exact
   lines), sometimes with "Simon says…" and sometimes not (the trap); he demonstrates some moves; the webcam judges a
   ~2.5 s window; score and streak; speeds up. Anyone who moves without "Simon says" is OUT.
5. **Package and apply:** a 60–90 s video of Liz playing (Inspector visible), the README, make the repo public, apply
   (the first answer must start "GPU-poor and proud 🤗").

**Later / tutorial finale:** multiplayer Simon Says via the sim's ghost channel (`notes/ideas.md`). Also the creature
voice (quacks via Pollen's Apache-2.0 `sounds` synth, `notes/research/microduck-voice-synth.md`) and an HF Space.

## Notes index
`notes/README.md`, `00-plan.md`, `01-local-voice-agent.md`, `02-duck-lab-and-voice-moves.md`, `ideas.md`,
`research/*` (voice synth, sim + Reachy pattern, webcam pose, upstream candidates).
