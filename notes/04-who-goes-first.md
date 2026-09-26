# 04 · Who goes first: dropped turns, silent takes, and an Inspector for both ends

*2026-09-26 · Apple M3 Pro, 18 GB RAM · Qwen3 4B (MLX) · Qwen3-TTS, voice Aiden · Parakeet STT*

We tested every way a game of Simon Says can end: wrong move, falling for a trap, too slow, you win,
getting a trap right, and a tied score. None of the bugs were in the game rules. Every one was about
**timing and turn-taking**: who is allowed to talk, when, and what happens when two things want the
voice at once. That's voice UX engineering, and a simple game turned out to be a good way to find it.

## Bug 1: "I want a rematch" was ignored

**What Liz saw:** after a game she said "All right, let's have a rematch." Nothing happened. She tried
again 17 s later with "I want to play again." That worked. It looked as if Simon didn't know the word
"rematch".

**What really happened:** the wording was fine. Simon's instructions and the game tool's description
both mention a rematch. The problem was timing. Step by step, from the Inspector and the agent's log:

1. The game ended, and the page started **pre-warming**: quietly making the next two score lines in the
   background, so they'd play instantly later (see [03](03-saved-voice-lines.md)).
2. Liz started talking. The agent always gives way to a human who's speaking, so it cancelled that
   background line (`status: cancelled, reason: turn_detected`).
3. **Our page pushed in the next background line straight away.** The agent's "you started talking"
   message reached the page a moment *after* the cancel, so the page didn't know yet.
4. Liz's words were transcribed while the agent was busy with that line. The agent did start on her
   answer 6 s later, once the line was done, but by then it treated the answer as out of date and threw
   it away (agent log: `LLM generation cancelled (interruption)` then `stale response complete`).

**The key idea: one lane.** The voice agent works on one reply at a time. Answering you and making
Simon's lines in the background both go through that same lane. A background job that doesn't check
who's talking will push in front of the human.

**The fix (`lab/static/app.js`):** the person always goes first.
- When the agent cancels a line because it heard you (`turn_detected`), the page pauses pre-warming
  right then, without waiting for the separate "speech started" message.
- No background line starts while you're talking (`state.userSpeaking`) or waiting for an answer.
- Once Simon has answered you, pre-warming carries on by itself (`resumeWarm`).

## Bug 2: Simon never said the score

**What Liz heard:** "Wrong move!", a gloat, then… nothing where the score should be.

**What really happened:** the transcript said "Seven for me, zero for you. Come on, show me what you've
got!", but **the transcript is only the text the voice model was given, not what came out of it.** We
measured the saved audio (loudness every half second):

| Saved take | Sound | Then silence |
|---|---|---|
| Six for me, one for you. Come on, show me what you've got! | 0.7 s | 11.1 s |
| Seven for me, zero for you. Come on, show me what you've got! | 1.6 s | 10.2 s |
| It's eight to zero in my favor. Come on, try harder! | 1.8 s | 8.2 s |

Six score takes had the same problem. Qwen3-TTS said the first few words of these two-sentence lines and
then made silence until our run-on cutter stopped it. Worse, the takes had been **saved**. So the same
silence would have played at every game with that score.

> ⚠️ Gotcha: a transcript that matches the words is not proof the words were spoken. Check the audio.

**The fixes:**
- **Split the score into two short lines:** "Seven for me, zero for you." then "Show me what you've got!"
  (`scoreLine` in `simon-says.js` now returns both). Short lines have been reliable with this voice. The
  second line has no numbers in it, so it's saved once and reused for every score.
- **A take that goes silent isn't saved.** It's made again next time.
- Deleted the six silent takes from `lab/lines/aiden/`.

## An Inspector for the front end and the back end

Liz: *"The UX has to be the priority, and the Inspector needs to show what's happening in both front and
back end."* Both bugs were invisible from the conversation alone. You only saw them by lining up the
page's events with the agent's log. So now the Inspector does that for you, in plain words, in amber
rows, labelled by side:

| Row | Side | Means |
|---|---|---|
| 🛑 page: stopped "…" | front end | a line was stopped, and why (you spoke, or we cut it) |
| ⚠️ page: no answer to "…" | front end | you got no answer within 10 s, and what Simon was busy with when you spoke |
| 🔇 page: "…": 1.6 s of sound, then 10.2 s of silence | front end | the voice model dropped the words (also shown each time a bad saved take replays) |
| ✂️ page: cut "…" | front end | the voice model ran on and we cut it (improvised lines now show what he said, not our instructions) |
| 💾 page: not saved "…" | front end | a take went silent, so it's made again next time |
| 🧠 agent: heard speech while replying… | back end | HF speech-to-speech cancelled its reply because it heard you |
| 🧠 agent: threw away a reply that was out of date | back end | the answer was ready too late and was dropped |
| 🧠 agent: stopped the voice mid-line | back end | the voice model was interrupted |

The 🧠 rows come from the agent's log: `server.py` matches four more log lines (`LOG_PATTERNS`) and sends
them to the page, which puts them in plain words (`AGENT_WHY` in `app.js`). With both sides in one place,
you can follow a single failure end to end: page stops the line → agent cancels → page's next line
pushes in → agent throws your answer away.

## Less repetition: openers and taunts
Replaying showed two lines wearing thin: "Let's play Simon Says!" before every game, and "Show me what
you've got!" coming round every third loss (the taunt was picked by the score total, so always in the
same order). Now (`simon-says.js`):
- **"Let's play Simon Says!" only for the first game** after the page loads. A rematch gets a short line
  that fits who won last, never the same one twice running: "Back for more?" / "Again? You're on!" /
  "Brave. Let's go!" when Simon won; "Revenge time!" / "Rematch! I'm ready this time." / "Okay, no more
  Mr Nice Duck." when you won.
- **The score every time, a taunt about one game in three**, picked at random and never the same one twice
  running (🎭 in the Inspector says when there's no taunt). Heard less often, a taunt lands better.
- None of these lines contain numbers, so each is made once, saved and plays instantly.

## Rapport before cheek
Simon teases, but Liz's rule is that he builds rapport and trust first. The first game after the page loads opens with a plain, polite "Let's adjust the camera,
please." Only after that come the cheeky face-front nudges ("Stop squirming and face front!"). He never
announces his personality: players discover it.

## Afternoon: pause, don't drop; mumbles; a fair referee; defensive code

**Pause, don't drop (tested live).** Liz's idea: when you speak while Simon is busy, he should pause and
answer when ready, not throw his work away. HF's agent has a setting for it, `interrupt_response`. We turn it
off only while Simon makes a silent background line, and back on afterwards (so talking over him out loud
still stops him). Result: the line finished and was saved, and Liz's "Let's play again" was answered 2.2 s
after her words were transcribed, with no line thrown away. Simon also nods, so you know he heard you.

**Mumbles, not just silence.** The 6–1 score take was 5.6 s of flat hum, loud enough to pass the silence check.
Real speech gets loud within the first second, so a line that hasn't by 1 s is stopped. Clean lines peak at
0.10–0.2 in their first second; the mumble at 0.04. We started the cut-off at 0.08, which also stopped a quiet
but real "Let's adjust the camera, please." (0.065) three times, so it's now 0.05.

**The voice model is deterministic.** Same sentence in, same audio out, every time: a bad take never
improves by trying again. So a wording that runs on, mumbles or goes silent goes on an avoid list
(`lab/lines/<voice>/bad.json`) and the score switches to another wording. Takes that were cut are never saved.
The local LLM is deterministic too: the same request gave the same congratulation word for word, so each
request now carries one random example (and a comment that had hidden three of the seven moods is fixed).

**A fair referee.**
- Calibration before every game, with a 3-2-1 countdown. A stance taken while turned (body turn 0.17)
  made normal sitting read as "look right" all game; an unusable one is retaken, and after 3 tries the
  game starts anyway rather than refusing.
- A move counts only when held for 1 s (Liz: "make them hold it"), with the full countdown always
  available. Camera tracking flickers, so dropouts under 0.3 s don't reset the hold (Liz held her arm up
  and still lost "Too slow" before this).
- A move that starts under 0.6 s after Simon begins talking isn't a reaction: it's ignored (a trap once
  caught Liz 0.35 s in).
- Look up/down were hard to trigger: the tilt check compares the nose with the ears, which are often hidden.
  We loosened it (0.15 → 0.12) and log a second measure beside it, where the nose sits between the eyes and
  the mouth, so real games decide which is better (📏 rows).

**Defensive code.** Races found by playing: the Start button came back on during setup, so a second click
started a second game on top of the first; the camera also calibrated twice. Now: one game at a time, one
calibration per game, each game has an id so a stopped game's leftover steps give up, a line that never
finishes can't freeze the game (15 s limit), and leaving the camera's view voids the round instead of
"Too slow!". `tests/game-lifecycle.test.mjs` runs the game against a fake camera and voice to keep these fixed.

**Voice for the game, the page for setup.** Liz: a spoken "Let's adjust the camera, please." can't say what
to do; the page can show it. Next (V2): camera setup moves into the page, and the page focuses on the game.

## Other things we measured
- **Free memory is not memory pressure.** macOS showed 41% free while the Duck Lab's memory bar was
  yellow. It was compressing 8.5 GB and had moved 6.3 GB to disk (swap), and the bar measures that
  strain. Before recording, restart the Mac and run only the lab and the recorder.
- Improvised gloats still run on sometimes ("Oh wow, your right arm knows a secret handshake! I win."
  ran to 10 s before we cut it). The new 🔇 row will show if that's silence or babble.

## Demo
Say "let's have a rematch" right after a game ends. Simon now starts the game. In the Inspector you can
watch the pre-warm pause ("you spoke: you go first") and pick up again afterwards.

## Tutorial seeds
- **"One lane: why your voice agent ignores you."** Background work and the conversation share one
  pipeline, so the person must always go first. Tell it with the rematch story and the side-by-side log.
- **"The transcript lies."** Check the audio, not the text, before trusting or caching a TTS take.
  Includes the loudness trick.
- **"An Inspector for both ends."** Show the page's reasons and the agent's reasons side by side, so
  voice UX bugs can be seen instead of guessed.
