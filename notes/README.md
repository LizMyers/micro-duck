# Micro Duck devlog

Working notes written *while* building, so they can become getting-started tutorials later.
Each milestone file records what we ran, what broke, how we fixed it, and what we measured.

## Conventions
- **Commands are copy-pasteable** and include the directory they run from.
- **Gotchas** get their own callout: `> ⚠️ Gotcha:` with the exact error text and the fix.
- **Timings/measurements** are recorded with machine + versions, never rounded into vibes.
- **Why** is written down next to every decision, so a tutorial can explain it.
- Each milestone ends with **Demo** (what you can show) and **Tutorial seeds** (angles worth writing up).

## Index
| # | Milestone | File | Status |
|---|---|---|---|
| 0 | Plan & reasoning | [00-plan.md](00-plan.md) | done |
| 1 | Open voice agent running locally on a Mac | [01-local-voice-agent.md](01-local-voice-agent.md) | in progress |
| 2 | Creature voice: a TTS that quacks | 02-creature-voice.md | – |
| 3 | Embodiment in sim: moves, beak, barge-in | 03-embodiment.md | – |
| 4 | Ship: Space, upstream PR, blog, video | 04-ship.md | – |

Research notes: [research/](research/)

## Machine
Apple M3 Pro, 18 GB RAM, macOS 27.0 · Python 3.11 (via uv 0.8.4)
