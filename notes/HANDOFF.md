# HANDOFF — Micro Duck / Duck Lab
*Written 2026-09-23, updated 2026-09-24 end of day (see "Update 2026-09-24"). Read this first.*

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
- **Start here:** [running-the-lab.md](running-the-lab.md). Double-click `Duck Lab.command` (or `uv run duck-lab`);
  the server writes `lab/logs/lab.log` itself, so Claude reads what Liz sees. Restart from the page (Simon OS → Restart server).
- Double-click **`Duck Lab.command`** (or `cd micro-duck && uv run duck-lab`), then open **http://localhost:8770**
  (it's `localhost`: Liz once typed 127.0.0.0 by mistake).
- Brain tab → **Start agent** (Qwen3 4B), about 1–3 min until the green "Ready". The lab remembers the model and
  restarts the agent itself after a lab restart (`lab/.agent-state.json`).
- Agent logs go to `lab/logs/agent-*.log`. The agent accepts **one connection at a time**: Liz's tab holds it.
- Headless-Chrome checks: use `--timeout=12000 --screenshot` (not `--virtual-time-budget`, which hangs on the SSE
  connection); give each run its own `--user-data-dir` and always `pkill` it afterwards. Physics runs slowly headless,
  so for movement tests use `lab/static/policy-test.html` (it steps physics with `rl.step`). Watch memory:
  18 GB Mac, the agent takes about 8 GB.

## Architecture (as of 09-23; see the 09-24 update below for what changed)
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

## Layout (as of 09-23; superseded by the 09-24 update below)
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

## Update 2026-09-24 (end of day) — read this first
*Replaces the "plan for tomorrow" from 09-23: items 1–4 are done or under way.*

### Built today
- **Simon OS** (first tab): rows STATUS / SERVER / MODEL / VOICE / COLOUR / STRAY PROCESSES, each with its
  controls; system messages with the Terminal command each stands in for; relay race at the bottom.
  The server narrates to the Terminal and `lab/logs/lab.log`, always starts the model, refuses to start twice,
  finds/stops stray processes, and "Restart server" (os.execv) works from the page. Header hidden.
  Details: `notes/running-the-lab.md`.
- **Simon Says tab**: 5 rounds; one mistake and Simon wins (gloats + head bob); all 5 right and you win.
  Spoken "OK!" after each correct move. Start game turns the camera on and calibrates. Page is the game master
  (`lab/static/simon-says.js`), webcam referees, the model only speaks lines **out-of-band**
  (`conversation: "none"`, so history doesn't grow). Lines are cached client-side after first use (🔁 in Inspector).
  Commands: look up/down/left/right, turn left/right, step forward/back, raise left/right/both arms.
- **Camera** (`pose.js`, 23 tests): v1 checks relative to calibration (look, turn, step, sit/stand, arms), each chip
  shows its live number for tuning. Thresholds in `THRESHOLDS` are geometry guesses, **not tuned on Liz yet**.
- **Copy me** (camera bar): Simon mirrors your head looks, no model involved.
- **Mac OS tab** (replaced Tests): memory per part (macOS, Model, Chrome incl. sim, server, other apps) from `top`;
  a banner on every tab when macOS reports memory pressure. **Duck colour** dots (Sky default, Cream, Lavender,
  Graphite) recolour the sim duck plus only the page background, Tap to talk and the RAM banner.
- **Model log (raw)** tab: short lines, warnings amber, errors red. Simon's instructions now say he can't see.

### Learned today (gotchas, with fixes)
- The model **answers** trap lines instead of repeating them ("Look up!" → "Sure, here's my best look up.").
  Fix: two word-for-word examples in the out-of-band request. Watch for it.
- **Qwen3-TTS runs on** for some short lines (28.8 s of audio for "Simon says, turn left." and "…take a step
  forward.", deterministic). Fix: lines cut at 3.5 s with `response.cancel` (✂️ in Inspector). Upstream candidate.
- The model accepts **one connection**; extra Duck Lab tabs are rejected in a loop. Page now shows MODEL BUSY.
- "Crashed" on Restart model was a race in our code (exit code 0); fixed. Model memory is ~8.5 GB, which `ps`
  RSS doesn't show (MLX/GPU memory); we use `footprint`/`top`.
- Liz's Mac is tight: 18 GB, 16 GB swap in use, two Chromes (Canary + Chrome) + Cursor + Figma open.

### How Liz wants to work (added today)
Change only what she names; ask one short question when a request could mean two things; plain labels, no
nicknames or emoji. **UI is parked**: she'll redesign it in Figma and hand over the file.

### Late additions (2026-09-24, after the first handoff)
- Game vocabulary is now **9 desk-friendly commands**: look up/down/left/right, turn left/right,
  raise left/right/both arms. Step/lean and sit/stand were removed from the game **and** the camera checks
  (Liz: standing up and stepping take too long; "take a step" then "too slow" felt unfair).
- The move clock now starts when Simon **finishes** the command (3 s), not when he starts (log showed a
  1.3 s command left only ~2.4 s). Big seconds countdown + timer bar in the duck colour.
- Wrong move is named ("Wrong move: that was your left arm!") instead of "Too slow".
- Turn check uses shoulder width only (looking up used to fake a turn).
- **Scripted vs improvised lines:** commands stay exact (judged, cached); reactions (gloat, congratulate) are
  improvised by the model from a description of what happened, so every game sounds different. OKs rotate.
  Simon is told not to make laughing sounds: Qwen3-TTS turned "Ha!" into a laugh that swallowed the words.
  Good tutorial point: script where words must be exact, improvise where variety adds charm.
- **Arms verified on Liz:** left/right are the right way round.
- **Arms are strict (Liz decided):** she noticed raising both arms also lit Left and Right arm up. Now one arm
  means only that arm; both arms lights "Both arms up" alone, and on a single-arm command it's
  "Wrong move: that was both arms!".

- **Liz: "The trick to starting the game is that you have to look right into the camera."** Calibration (2.5 s
  after the camera starts) records where the head points as neutral; if you're looking elsewhere, looks are
  skewed. Idea: a "Look at Simon: 3… 2… 1…" countdown before round 1, calibrating on "1", so neutral is where
  players actually look during play (Simon on screen).

- **Voice rematch:** after a game Liz said "I want a rematch" and Simon bowed ("Sure, here's my best bow").
  Now Simon has a `play_simon_says` tool: "rematch" / "let's play again" starts a game hands-free.
- **Traps are strict (Liz decided):** any clear move during a trap is out ("Simon didn't say! (You did look
  right.)"), not just the called move. Prompted by round 3 of her log, where looking right on "Turn right!" survived.
- **All-time scoreboard** (flip cards, localStorage) and a fixed spoken result line after Simon's improvised one.

- **Voice model drops sentence endings with digits (hypothesis):** "You win! All-time score: Simon 3, you 2." was
  fully received (7.2 s of audio) but Liz heard it stop at "Simon 3". Now: "You win!" then "The score is Simon
  three, you two." (numbers as words, separate short line). Verify; if it holds, an upstream TTS note.

### Open questions for Liz
- Look chips: check head looks aren't mirrored the wrong way (arms are fine).
- The Colour row label: keep or remove?


## Plan for next session (in order, one at a time)
1. **Play-test Simon Says** with Liz; read the Inspector/logs: which commands judge well, which lines misbehave.
2. **Tune camera thresholds on Liz** (chips show the numbers; compare with `THRESHOLDS` in `pose.js`).
3. **Hand model: hold up 1–5 fingers** (MediaPipe HandLandmarker, 21 points/hand; ~1 h + tuning; watch CPU/RAM).
   Simon can call finger commands but can't demonstrate them.
4. **Simon walks to his spot at game start** (Liz's idea): from wherever he is, turn towards the centre, walk
   there (measured moves + `rl.data.qpos` position/heading), check, then turn to face the front. Level 1 is done
   (Start game swings the sim camera in front of him, head level, via `faceCamera`). This is also the right
   design for a real Microduck, where the camera can't move, so the robot must.
5. "Look at Simon: 3… 2… 1…" calibration countdown (see late additions).
6. Maybe: pre-warm all game lines at game start, so the first game is as fast as later ones.
7. **Package and apply** (unchanged): video of Liz playing (Inspector visible), README, make public, push the
   `tool-call-positional-args` branch to Liz's fork, apply (first answer starts "GPU-poor and proud 🤗").

**Later / tutorial finale:** multiplayer Simon Says via the sim's ghost channel; creature voice; HF Space.

## Notes index
`notes/README.md`, `00-plan.md`, `01-local-voice-agent.md`, `02-duck-lab-and-voice-moves.md`, `ideas.md`,
`research/*` (voice synth, sim + Reachy pattern, webcam pose, upstream candidates).
