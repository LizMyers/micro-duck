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
> **Decided (2026-09-24):** the lab always starts the agent. See below.

## Restarting it yourself (the shared way)
1. **Stop:** in the Terminal window running the lab, press **Ctrl+C** (or close the window).
   The lab shuts the agent down on its way out.
2. **Start:** double-click **Duck Lab.command**, or in Terminal:
   ```
   cd ~/Documents/Development/micro-duck
   uv run duck-lab
   ```
   The server writes its own `lab/logs/lab.log` (same lines as the Terminal), so Claude can read it.
   Once it's running, restart from the page: Simon OS → **Restart server**.
   *(Earlier today we used `uv run duck-lab 2>&1 | tee lab/logs/lab.log`: `2>&1` merges output and
   errors, `tee` copies them to a file. Not needed any more.)*
3. Open **http://localhost:8770** (`localhost`, not 127.0.0.0).

## Simon OS and Help: the same thing, in the page
Starting the lab now **always** starts the agent too, with the model it used last
(remembered in `lab/.agent-state.json`; Qwen3 4B the first time). So "start the lab" is the only step.

- **Simon OS** (the first tab, read-only): one status row, **health first**
  (READY / LOADING / STOPPED / CRASHED, or **?** when the page can't reach the lab), then the
  relay race (Listen / Turn / Hear / Think / Speak, and "Reply in"). Below it: what's running
  (lab, agent with pid and memory, leftovers), then **system messages**. The lab narrates everything
  it does, and each message shows the Terminal command it stands in for. The same lines go to the
  Terminal as `[lab] 11:26:03 …`, so `lab/logs/lab.log` has them too.
- **Help** (the last tab): the buttons that fix things, each with *when* to use it and its Terminal command:
  🔍 Check system · ↻ Restart agent · ■ Stop agent · 🧹 Clean up leftovers · ⟳ Restart lab.
- **Brain** only switches models now. The **Tap to talk** button says why it's disabled
  ("Simon is waking up…"), so health is visible from every tab. The header is just 🦆 Duck Lab.

⟳ Restart lab replaces the lab with a fresh copy of itself (same Terminal, same log, same pid:
Python's `os.execv`), starts the agent again and reloads the page.

**Why simplify:** we had three things answering "can I talk to Simon?" (a top-right badge, a health
badge and the talk button) and start/stop buttons in two places. Now each fact and each control has
one home, and nothing is hidden: every process, port, command and timing is still on screen.

## Gotcha: two copies of the lab (2026-09-24)
> ⚠️ Gotcha: we started a second lab while last night's copy was still running in the background.
> The second copy auto-started the agent first, which stopped the first copy's agent. Then it found port
> 8770 taken (`[Errno 48] ... address already in use`) and exited, taking its own agent with it.
> The page showed "Agent crashed" and Tap to talk stayed disabled.
> **Why:** the web server runs its startup steps (including auto-start) *before* it claims the port.
> **Fix:** `main()` now checks the port first and stops with "Duck Lab is already running at
> http://localhost:8770 (pid …)". The lab also lists leftover copies at startup, and Simon OS → Clean up
> stops them (politely with `kill`, then with `kill -9` if they ignore it).

> ⚠️ Gotcha: `lab.log` was empty even with `tee`. Python holds printed text back in large batches
> when its output goes into a pipe instead of the screen, and the web server was set to warnings only.
> **Fix:** every lab message is printed with `flush=True`.

## Where the logs are
| Log | Written by | Where |
|---|---|---|
| Lab log | The server | Your Terminal, plus `lab/logs/lab.log` (written by the server itself) |
| Model log | speech-to-speech | `lab/logs/agent-<date>-<time>.log`, also the page's **Model log (raw)** tab (time + message; hover for level and module; warnings amber, errors red) |

## Is it running? (handy checks)
```
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":8770|:8765"   # which ports are open: 8770 = lab, 8765 = agent
cat lab/.agent-state.json                               # will the agent auto-start next time?
ls -t lab/logs | head -3                                # newest logs first
```

## Tutorial seeds
- "Two programs, one page": a good first diagram for the series.
- `tee` is a small trick that makes pairing (human and AI, or two humans) much easier.
