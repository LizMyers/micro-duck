# 02 · Duck Lab: talking a simulated Microduck around by voice

*2026-09-23 (evening) · same machine as 01 · speech-to-speech branch `tool-call-positional-args`*

**Result:** in the browser, you say *"take two steps forward… turn right… step back…"* and a simulated
Microduck (Pollen's official MuJoCo-in-the-browser sim) does it. Liz steered it to the ball by voice.
Everything is local and open: Parakeet STT → Qwen3-4B (MLX) → tool calls → Pollen's trained walking policy.

## What we built
| Piece | File | What it does |
|---|---|---|
| Lab server | `lab/server.py` | Starts/stops the agent, streams its timing logs to the page, serves the sim + test prompts. No terminal needed (`Duck Lab.command`). |
| Browser voice client | `lab/static/app.js` | Speaks the OpenAI Realtime protocol over WebSocket: mic → agent, reply audio → speakers, barge-in. |
| The duck | `sim/` patch + `lab/static/duck-body.js` | Embeds Pollen's sim; head poses per mood (listening/thinking/speaking/interrupted); beak follows reply loudness; Sky colourway; arrow keys work from anywhere. |
| Moves | `lab/static/duck-tools.js` | 11 tools (sit, stand, step fwd/back, turn L/R, bow, kick L/R, skates on/off). Each move is **measured** (cm / degrees) and reported honestly. |
| Inspector | `lab/static/inspector.js` | Every message page↔agent, plus live move traces. This is how we found most bugs. |

## The debugging story (tutorial gold)
Each row: symptom → how we saw it → cause → fix.

1. **Duck ignored voice *and* keys.** → headless test showed `locked=true` forever → sim's intro (BIOS/title) normally unlocks
   controls; embed mode skipped it → unlock explicitly after the entrance.
2. **Duck *said* "sitting down" but didn't.** → Inspector: agent's `session.updated` had `"tools": null` → my edit had
   put tools into the *save-preferences* function by mistake → moved to the session message. **Lesson: build the inspector first.**
3. **Small model narrated instead of acting.** → added "body rules" to the instructions ("you MUST call the tool").
   Measured offline: 10/10 correct tool calls with Qwen3-4B.
4. **`step(forward=1)`, `turn('left', 360)`** — small models fill multi-field tools badly. → one action per tool, ≤1 number;
   and **upstream fix #1**: bind purely positional args by parameter order.
5. **Duck read `<tool_call>{json}</tool_call>` aloud.** → Qwen falls back to its native format once tool calls are in the
   history (chat templates render them that way). → **upstream fix #2**: recognise native blocks; **#3**: strip them even
   when `tool_choice="none"`.
6. **"Cannot generate a response while function call outputs are pending."** → page waited for the move to *finish* before
   reporting → report "started" immediately, follow up only on failure.
7. **Step forward moved 0.5 cm.** → trace showed command arriving → policy ignores gentle commands (0.15 m/s) → use arrow-key speed.
8. **Step back / turn right did nothing.** → Liz found it with the keyboard: pure ↓ or pure ←/→ don't start the gait, but
   ↑+→ and ↓+→ do. → measured recipes with a physics-stepped test page (`policy-test.html`):
   turn = creep forward 0.12 m/s while turning (−106° in 3 s); back = zig-zag the turn every 0.5 s (28.6 cm straight back).
9. **Fix didn't show up.** → Inspector showed the *old* commands → Chrome cached the JS module → `Cache-Control: no-store`.
10. **Gemma 3 1B babbled `<end_of_turn>` ×400** and crashed on "roles must alternate" → library isn't Gemma-ready yet
    (candidate upstream #4/#5). Marked "not working yet".
11. **Long chats stall** → prompt grows to 2k tokens → 9–13 s replies → human fills silence → reply cancelled → loop. (Open.)

## Numbers
- Voice → first sound: ~2.5 s fresh, grows with conversation length (LLM dominates).
- Step forward ×1/×2/×3: 6 / 13 / 18 cm. Turn left 90°: 91°. Turn left 180°: 174°.
- Tool-call accuracy (offline, Qwen3-4B, 10 commands): 10/10 after body rules + simple tools.

## Upstream (huggingface/speech-to-speech), branch `tool-call-positional-args`
| Commit | Change | Tests |
|---|---|---|
| d48083e | Bind purely positional tool-call args by parameter order | 8 new |
| ce56257 | Recognise native `<tool_call>{json}</tool_call>` blocks | 5 new |
| 6e117d4 | Strip tool markup from speech when `tool_choice="none"` | 1 new |
Full suite: 1702 passed.

## Demo
"I talk to a robot duck on my laptop and it walks where I tell it — all open models, nothing in the cloud."

## Tutorial seeds
- *Build the inspector first* — how one log view found 6 bugs.
- *Your robot has habits* — policies that won't turn from standstill, and how to work with them (Liz's keyboard discovery).
- *Tool calling with small local models* — simple tools, body rules, positional args, native formats.
- *Honest agents* — measure what the body actually did; never let the model claim success.
- *Contributing upstream from a demo* — three library fixes found by using it for real.
EOF
cd /Users/liz/Documents/Development/micro-duck && sed -i '' 's/| 2 | Creature voice: a TTS that quacks | 02-creature-voice.md | – |/| 2 | Duck Lab: voice-controlled sim duck | [02-duck-lab-and-voice-moves.md](02-duck-lab-and-voice-moves.md) | done |\n| 3 | Creature voice: a TTS that quacks | – | – |/' notes/README.md && git add -A notes && git -c user.name="Liz Myers" -c user.email="elizmyers@gmail.com" commit -q -m "Devlog 02: Duck Lab, voice moves, debugging story, upstream fixes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" && git push -q && echo pushed