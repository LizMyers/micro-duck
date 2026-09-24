# Running the lab (and seeing what it does)

*Written 2026-09-24. How we start, stop and watch the Duck Lab so we both see the same thing.*

## Two programs, not one
| Program | What it is | Port | What starts it |
|---|---|---|---|
| **The lab** | The web page plus a small FastAPI server behind it (`lab/server.py`) | 8770 | You: `uv run duck-lab` or double-click `Duck Lab.command` |
| **The agent** | HF speech-to-speech: listens, thinks (Qwen3 4B), speaks. About 8 GB of memory | 8765 | The **Start agent** button, *or the lab on its own* (see below) |

The web page itself never starts anything. It asks the lab, and the lab starts or stops the agent.

## The hidden rule: auto-restart
When the lab starts, it reads `lab/.agent-state.json`:
- If the agent **was running when the lab last shut down**, the lab starts it again with the same model.
- If you pressed **Stop** first, that file is deleted, so the agent stays off next time.

That's why the page is sometimes already "Loading…" before you've touched anything.
(Code: `_startup()` and `Agent.stop(forget=...)` in `lab/server.py`.)

> ⚠️ Gotcha: the page doesn't explain any of this yet. "Start agent" silently becomes "Restart with this model".
> Open question: always auto-start (one status line plus a Stop button) or never auto-start (one Start/Stop button)?
> Claude leans towards always auto-starting. Decide as part of "make the buttons clear".

## Restarting it yourself (the shared way)
1. **Stop:** in the Terminal window running the lab, press **Ctrl+C** (or close the window).
   The lab shuts the agent down on its way out.
2. **Start** in a fresh Terminal window:
   ```
   cd ~/Documents/Development/micro-duck
   uv run duck-lab 2>&1 | tee lab/logs/lab.log
   ```
   - `uv run duck-lab`: starts the lab (same as the double-click file).
   - `2>&1`: merges normal output and error messages into one stream.
   - `| tee lab/logs/lab.log`: sends that stream to the screen *and* a file, so you watch it live
     and Claude reads the same thing from the file.
3. Open **http://localhost:8770** (`localhost`, not 127.0.0.0).

## Where the logs are
| Log | Written by | Where |
|---|---|---|
| Lab log | The lab server | Your Terminal, plus `lab/logs/lab.log` (when started with `tee`) |
| Agent log | speech-to-speech | `lab/logs/agent-<date>-<time>.log`, also the page's **Agent log** tab |

## Is it running? (handy checks)
```
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":8770|:8765"   # which ports are open: 8770 = lab, 8765 = agent
cat lab/.agent-state.json                               # will the agent auto-start next time?
ls -t lab/logs | head -3                                # newest logs first
```

## Tutorial seeds
- "Two programs, one page": a good first diagram for the series.
- `tee` is a small trick that makes pairing (human and AI, or two humans) much easier.
