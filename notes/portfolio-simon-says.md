# Portfolio section draft: Simon Says (for lizm.dev)

*Draft 2026-09-25. Replaces Quiz-Genie in Featured (Quiz-Genie moves to a new Lab page). Same shape as
LondonLore / LingoWise / Quiz-Genie. [Brackets] = fill in once it exists.*

---

## Simon Says

**Play Simon Says with a robot duck: Hugging Face's open-source voice agent, a webcam referee and a
simulated Pollen Microduck, running entirely on a laptop.**

Simon calls the commands out loud. My webcam judges whether I really looked left, turned right or raised
the correct arm, and a strict "Simon didn't say!" catches me out on the traps. He congratulates me when I win,
gloats when he does, and keeps an all-time score on a train-station flip board. Say "I want a rematch" and he
starts a new game himself. No API keys, no cloud: every model runs locally on an 18 GB MacBook.

The interesting part was making a small local voice agent *play fair and feel alive*. The page is the game
master and the language model is the voice: commands are scripted word for word (they are judged), while
Simon's reactions are improvised from what actually happened, with a different mood each time. Along the way
I found and fixed issues in the open-source stack itself, and contributed them upstream.

**Skills shown:** voice-agent design (scripted vs improvised speech, turn-taking, latency), real-time
computer vision in the browser, game design and fairness tuning, embodied AI (a voice model with a body and
tools), debugging an open-source ML stack, contributing upstream.

**Key stat:** [e.g. "3 fixes contributed to Hugging Face speech-to-speech" / video views once posted]

**Links:** [Watch the demo] · [GitHub repo] · [Upstream pull request] · [Tutorial series: in progress]

**Notable tech:**
- **Hugging Face speech-to-speech**, run locally over its OpenAI-Realtime-compatible WebSocket:
  Parakeet (speech to text), Smart Turn (end-of-turn detection), **Qwen3 4B** (4-bit, MLX) and **Qwen3-TTS**
- **Out-of-band replies** for game lines, so they never grow the conversation history; line audio cached
  after first use, so repeats play instantly
- **MediaPipe pose tracking** in the browser: head turns, body turns and arms measured against a calibrated
  stance, with the "your left is the camera's right" trap covered by tests (30 unit tests)
- **Pollen's Microduck simulator** (MuJoCo in the browser) with a small patch for the beak, embed mode and a
  ball-free stage; Simon's moves (sit, step, turn, bow, kick, skates) are tools the model can call
- A **tool** for starting games by voice ("rematch!") and an Inspector that shows every event live
- Upstream: tool-call argument binding, native `<tool_call>` parsing, tool markup stripped from speech
  [+ per-reply `max_output_tokens` for local MLX, if merged/opened]

---

### Notes for Liz
- **Honesty line** (your call where it goes, here or in the application): *"Built with Claude Code as my pair
  programmer."* It fits "one person's work: designed, coded, and shipped" (you designed, directed, tested and
  shipped it) and HF will respect it.
- **Hero image:** a GIF of one round (Simon says a command → you move → "OK!"), or the video thumbnail.
- **Quiz-Genie on the Lab page:** keep its one-liner and link; it still shows developer-docs instincts
  (worth mentioning in the application).
- Don't quote a reply-time number yet: the logs mix cold starts and long chats (median 4.8 s over 173
  turns). Game lines are faster (out-of-band, cached). Measure a clean number before publishing one.

### Site navigation (Liz's idea, 2026-09-25)
```
Liz Myers        Work ▾      Lab      Tutorials            [ Let's chat ]
                 ├ LondonLore
                 ├ LingoWise
                 └ Simon Says
```
- **Let's chat** stays the highlighted button on the right (the call to action).
- **Work** is clickable (home = the three featured); the dropdown is a shortcut. On mobile, a plain list.
- **Tutorials** (not "Writing"/"Blog"): specific, fits the dev-rel story.
- Don't launch an empty page: leave Tutorials out until part 1 is live, or open it with the series outline and
  "first part coming soon".
- **Lab** starts with Quiz-Genie plus any smaller experiments, as dated cards (image, one line, links).
