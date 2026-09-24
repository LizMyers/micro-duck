"""Duck Lab: a small local web server around Hugging Face's speech-to-speech agent.

It does three jobs, so nobody has to touch a terminal:

1. Starts and stops the voice agent (`speech-to-speech serve`) as a child process,
   with the language model chosen in the page.
2. Reads the agent's log as it runs and turns the timing lines into events
   ("turn detection took 80 ms", "speech-to-text took 0.30 s", ...) that it
   streams to the page over Server-Sent Events.
3. Serves the page itself, plus test questions spoken by macOS `say`.
4. Narrates what it does ("[lab] agent ready after 97 s") to the Terminal and to the
   page's Simon OS tab, and can check for, and clean up, leftover copies of itself.

The page talks to the agent directly over the OpenAI Realtime WebSocket protocol;
this server never touches the audio.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).parent
STATIC = HERE / "static"
PROMPTS = HERE / "prompts"
MOVES = HERE / "moves"
# Community-trained Microduck moves we host locally (policy downloaded on start;
# the manifest is ours because the Hub repo doesn't include one).
MOVE_SOURCES = {
    "polite-bow": "https://huggingface.co/fffiloni/microduck-polite-bow-b1d864/resolve/main/policy.onnx",
}
S2S_DIR = Path(os.environ.get("S2S_DIR", Path.home() / "Documents/Development/speech-to-speech"))
# Pollen's Microduck browser simulator, built with VITE_BASE=/sim/ (see notes/02).
SIM_DIST = Path(os.environ.get("SIM_DIST", Path.home() / "Documents/Development/microduck-simulator/app/dist"))
HF_CACHE = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache/huggingface/hub"))

STATE_FILE = HERE / ".agent-state.json"  # the model the agent last ran, so the next launch uses it
STATE_FILE_REL = "lab/.agent-state.json"  # how the Terminal commands we show refer to it
LOG_DIR = HERE / "logs"  # one log file per agent run, kept so crashes can be diagnosed

LAB_PORT = 8770
AGENT_PORT = 8765

# Language models offered in the page. All are small "instruct" models converted to
# MLX (Apple's framework) and compressed to 4-bit so they fit comfortably on a laptop.
MODELS = [
    {"id": "mlx-community/Qwen3-4B-Instruct-2507-4bit", "label": "Qwen3 4B", "gb": 2.3,
     "note": "The library's default. Smartest of the four."},
    {"id": "mlx-community/SmolLM3-3B-4bit", "label": "SmolLM3 3B", "gb": 1.8,
     "note": "Hugging Face's own small model."},
    {"id": "mlx-community/Llama-3.2-3B-Instruct-4bit", "label": "Llama 3.2 3B", "gb": 1.8,
     "note": "Meta's small model."},
    {"id": "mlx-community/gemma-3-1b-it-4bit", "label": "Gemma 3 1B (not working yet)", "gb": 0.8,
     "note": "Not working yet: the library doesn't stop at Gemma's <end_of_turn> marker and "
             "Gemma rejects two user turns in a row. Candidate upstream fix (see notes)."},
]

# Built-in voices of the Qwen3-TTS CustomVoice model (read from its config.json).
VOICES = ["aiden", "ryan", "eric", "dylan", "uncle_fu", "serena", "vivian", "ono_anna", "sohee"]

TEST_PROMPTS = [
    "What is the capital of France?",
    "Tell me a joke about robots.",
    "How does photosynthesis work?",
    "Can you recommend a good book for a rainy day?",
    "What should I name my pet duck?",
]

# --- Reading the agent's log ------------------------------------------------------------
# Each pattern turns one log line into a small event for the page's "relay race".
LOG_PATTERNS = [
    ("speech_started", re.compile(r"- INFO - Speech started"), None),
    ("speech_ended", re.compile(r"Speech soft-ended \(segment=(\d+)ms, active=(\d+)ms"),
     lambda m: {"speech_s": int(m.group(2)) / 1000}),
    ("turn", re.compile(r"Smart Turn: (\w+) \(p=([\d.]+), ([\d.]+)ms\)"),
     lambda m: {"verdict": m.group(1), "p": float(m.group(2)), "turn_s": float(m.group(3)) / 1000}),
    ("stt", re.compile(r"final STT done .*?total=([\d.]+)s"),
     lambda m: {"stt_s": float(m.group(1))}),
    ("tts_first_audio", re.compile(r"TTFA: ([\d.]+)s"),
     lambda m: {"tts_s": float(m.group(1))}),
    ("total", re.compile(r"Last speech detected to first speech out: ([\d.]+)s"),
     lambda m: {"total_s": float(m.group(1))}),
]
READY_LINE = "Uvicorn running on"


def is_cached(model_id: str) -> bool:
    return (HF_CACHE / f"models--{model_id.replace('/', '--')}").exists()


def free_agent_port() -> None:
    """Stop a leftover agent (e.g. orphaned by a hard lab restart) holding our port."""
    try:
        pids = subprocess.run(["lsof", "-t", f"-iTCP:{AGENT_PORT}", "-sTCP:LISTEN"],
                              capture_output=True, text=True).stdout.split()
    except OSError:
        return
    for pid in pids:
        cmd = subprocess.run(["ps", "-o", "command=", "-p", pid], capture_output=True, text=True).stdout
        if "speech-to-speech" in cmd:
            lab_log(f"A stray model process (pid {pid}) was holding port {AGENT_PORT}, so we stopped it.",
                    cmd=f"kill {pid}", level="warn")
            subprocess.run(["kill", pid])
    if pids:
        time.sleep(2)


class Agent:
    """Owns the speech-to-speech child process and fans its events out to the page."""

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.status = "stopped"  # stopped | starting | ready | error
        self.model: str | None = None
        self.error: str | None = None
        self.log_tail: deque[str] = deque(maxlen=400)
        self.subscribers: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.lock = threading.Lock()

    # Events go to every open page.
    def publish(self, event: dict) -> None:
        event["t"] = time.time()
        if self.loop is None:
            return
        for q in list(self.subscribers):
            self.loop.call_soon_threadsafe(q.put_nowait, event)

    def set_status(self, status: str, error: str | None = None) -> None:
        self.status, self.error = status, error
        self.publish({"type": "status", **self.snapshot()})

    def snapshot(self) -> dict:
        return {"status": self.status, "model": self.model, "error": self.error}

    def start(self, model_id: str, why: str = "you pressed Start") -> None:
        lab_log(f"Starting model {model_label(model_id)} ({why}). Loading takes 1–3 minutes.",
                cmd=f"speech-to-speech serve --mac-optimal-settings --model_name {model_id} --port {AGENT_PORT}")
        with self.lock:
            self._stop_locked()
            free_agent_port()
            python = S2S_DIR / ".venv/bin/python"
            if not python.exists():
                raise HTTPException(500, f"speech-to-speech not installed at {S2S_DIR}")
            env = dict(os.environ)
            # Gotcha from milestone 1: python.org builds of Python ship without root
            # certificates, so model downloads fail. Point them at certifi's bundle.
            env["SSL_CERT_FILE"] = subprocess.check_output(
                [str(python), "-c", "import certifi; print(certifi.where())"], text=True
            ).strip()
            env["PYTHONUNBUFFERED"] = "1"
            cmd = [
                str(S2S_DIR / ".venv/bin/speech-to-speech"), "serve",
                "--mac-optimal-settings",
                "--model_name", model_id,
                "--port", str(AGENT_PORT),
                "--enable_live_transcription",
            ]
            self.model = model_id
            self.log_tail.clear()
            LOG_DIR.mkdir(exist_ok=True)
            self.log_file = open(LOG_DIR / time.strftime("agent-%Y%m%d-%H%M%S.log"), "a", buffering=1)
            self.proc = subprocess.Popen(
                cmd, cwd=S2S_DIR, env=env, text=True, bufsize=1,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            )
            STATE_FILE.write_text(json.dumps({"model": model_id}))
            self.started_at = time.time()
            self.set_status("starting")
            threading.Thread(target=self._read_log, args=(self.proc,), daemon=True).start()

    def stop(self, why: str = "you pressed Stop") -> None:
        with self.lock:
            pid = self.proc.pid if self.proc and self.proc.poll() is None else None
            self._stop_locked()
        if pid:
            lab_log(f"Stopped model, pid {pid} ({why}). About 8 GB of memory freed.",
                    cmd=f"kill {pid}")
        self.set_status("stopped")

    def _stop_locked(self) -> None:
        # Forget the process *before* stopping it: its log reader treats "exited while still
        # self.proc" as a crash, and a clean stop must not look like one.
        proc, self.proc = self.proc, None
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    def _read_log(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        log_file = getattr(self, "log_file", None)
        for raw in proc.stdout:
            if log_file:
                log_file.write(raw)
            line = raw.rstrip()
            if not line or "nltk_data" in line or "httpx - INFO" in line:
                continue
            self.log_tail.append(line)
            self.publish({"type": "log", "line": line[-300:]})
            if READY_LINE in line:
                took = time.time() - getattr(self, "started_at", time.time())
                lab_log(f"Model ready after {took:.0f} s: {model_label(self.model)} on port {AGENT_PORT}, "
                        f"pid {proc.pid}.", level="good")
                self.set_status("ready")
            for name, pattern, extract in LOG_PATTERNS:
                m = pattern.search(line)
                if m:
                    self.publish({"type": "stage", "stage": name, **(extract(m) if extract else {})})
        # The process ended. If we didn't stop it on purpose, say why.
        code = proc.wait()
        if log_file:
            log_file.write(f"\n[duck-lab] agent exited with code {code}\n")
        if proc is self.proc:
            reason = {-15: "another process told it to stop (signal 15)",
                      -9: "another process force-stopped it (signal 9)"}.get(code, "it crashed")
            lab_log(f"Model exited unexpectedly with code {code}: {reason}. "
                    f"Details: lab/logs/{Path(log_file.name).name if log_file else 'agent-*.log'}", level="bad")
            tail = "\n".join(list(self.log_tail)[-8:])
            self.set_status("error", f"The model stopped unexpectedly.\n{tail}")


agent = Agent()
app = FastAPI(title="Duck Lab")
LAB_STARTED = time.time()


# --- The lab narrates what it does ----------------------------------------------------------
# Every message goes to the Terminal, to lab/logs/lab.log (so Claude can read it too)
# and to the page's Simon OS tab. `cmd` is the Terminal command a human would
# type to do or check the same thing: that's what the tab teaches.
lab_messages: deque[dict] = deque(maxlen=200)


def lab_log(text: str, cmd: str | None = None, level: str = "info") -> None:
    msg = {"type": "lab", "text": text, "cmd": cmd, "level": level}
    line = f"[lab] {time.strftime('%H:%M:%S')} {text}" + (f"\n        $ {cmd}" if cmd else "")
    print(line, flush=True)
    write_lab_log(line)
    agent.publish(msg)  # adds the timestamp
    msg.setdefault("t", time.time())
    lab_messages.append(msg)


def write_lab_log(line: str) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    with open(LOG_DIR / "lab.log", "a") as f:
        f.write(line + "\n")


def model_label(model_id: str | None) -> str:
    return next((m["label"] for m in MODELS if m["id"] == model_id), model_id or "no model")


# --- Looking at what's running (the same checks as lsof and ps in a Terminal) --------------

def listening_pids(port: int) -> list[int]:
    out = subprocess.run(["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout
    return [int(p) for p in out.split()]


def process_info(pid: int) -> dict | None:
    out = subprocess.run(["ps", "-o", "rss=,lstart=,command=", "-p", str(pid)],
                         capture_output=True, text=True).stdout.strip()
    if not out:
        return None
    rss, rest = out.split(None, 1)
    started = time.mktime(time.strptime(rest[:24], "%a %b %d %H:%M:%S %Y"))
    return {"pid": pid, "mb": int(rss) // 1024, "started": started, "command": rest[25:]}


def footprint_mb(pid: int) -> int | None:
    """Real memory use, including the GPU memory MLX models live in (ps's RSS leaves that out)."""
    out = subprocess.run(["footprint", str(pid)], capture_output=True, text=True).stdout
    m = re.search(r"Footprint: ([\d.]+) ([KMG])B", out)
    if not m:
        return None
    return round(float(m.group(1)) * {"K": 1 / 1024, "M": 1, "G": 1024}[m.group(2)])


def find_pids(pattern: str) -> list[int]:
    out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True).stdout
    return [int(p) for p in out.split()]


def leftovers() -> list[dict]:
    """Other copies of the lab, and agents that no lab owns (e.g. from a hard restart)."""
    ours = {os.getpid(), agent.proc.pid if agent.proc else -1}
    found = []
    for kind, pattern in (("lab", "bin/duck-lab"), ("agent", "speech-to-speech serve")):
        for pid in find_pids(pattern):
            info = process_info(pid)
            if pid in ours or not info or (kind == "lab" and "bin/duck-lab" not in info["command"]):
                continue
            found.append({**info, "kind": kind})
    return found


def scan() -> dict:
    try:
        auto = json.loads(STATE_FILE.read_text()).get("model")
    except (OSError, ValueError):
        auto = None
    agent_pid = agent.proc.pid if agent.proc and agent.proc.poll() is None else None
    agent_info = process_info(agent_pid) if agent_pid else None
    return {
        "lab": {"pid": os.getpid(), "started": LAB_STARTED, "port": LAB_PORT,
                "url": f"http://localhost:{LAB_PORT}"},
        "agent": {**agent.snapshot(), "label": model_label(agent.model) if agent.model else None,
                  "pid": agent_pid, "mb": (footprint_mb(agent_pid) or agent_info["mb"]) if agent_info else None,
                  "port": AGENT_PORT,
                  "port_pids": listening_pids(AGENT_PORT)},
        "remembered": {"model": auto, "label": model_label(auto) if auto else None},
        "leftovers": leftovers(),
    }


def describe(pid_info: dict) -> str:
    when = time.strftime("%a %H:%M", time.localtime(pid_info["started"]))
    what = "an old server" if pid_info["kind"] == "lab" else "a model process no server owns"
    return f"{what} (pid {pid_info['pid']}, since {when}, {pid_info['mb']} MB)"


@app.middleware("http")
async def no_cache(request, call_next):
    # The page's JS modules change often while we build; never let the browser
    # keep a stale copy (it once kept old movement code after a reload).
    response = await call_next(request)
    if not request.url.path.startswith("/sim/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
async def _startup() -> None:
    agent.loop = asyncio.get_running_loop()
    lab_log(f"Server started: pid {os.getpid()}, http://localhost:{LAB_PORT}.",
            cmd="uv run duck-lab   (or double-click Duck Lab.command)")
    for p in await asyncio.to_thread(leftovers):
        lab_log(f"Stray process: {describe(p)}. Stop strays stops it.", cmd=f"kill {p['pid']}", level="warn")
    await asyncio.to_thread(make_test_prompts)
    await asyncio.to_thread(fetch_moves)
    # Starting the lab starts the agent too, with the model it used last time.
    try:
        last = json.loads(STATE_FILE.read_text()).get("model")
    except (OSError, ValueError):
        last = None
    if last not in {m["id"] for m in MODELS}:
        last = MODELS[0]["id"]
    await asyncio.to_thread(agent.start, last, "started with the server; last model used")


@app.on_event("shutdown")
def _shutdown() -> None:
    agent.stop(why="server shutting down")


def make_test_prompts() -> None:
    """Speak each test question with macOS `say` into a 24 kHz, 16-bit mono WAV."""
    PROMPTS.mkdir(exist_ok=True)
    for i, text in enumerate(TEST_PROMPTS):
        out = PROMPTS / f"prompt_{i:02d}.wav"
        if not out.exists():
            subprocess.run(
                ["say", "-o", str(out), "--file-format=WAVE", "--data-format=LEI16@24000", text],
                check=True,
            )


def fetch_moves() -> None:
    import urllib.request
    for name, url in MOVE_SOURCES.items():
        out = MOVES / name / "policy.onnx"
        if out.exists():
            continue
        try:
            urllib.request.urlretrieve(url, out)
        except Exception as e:  # the lab still works without the move
            lab_log(f"Couldn't download move {name}: {e}", level="warn")


class StartRequest(BaseModel):
    model: str
    why: str = "you pressed Start"


@app.get("/api/options")
def options() -> dict:
    return {
        "models": [{**m, "cached": is_cached(m["id"])} for m in MODELS],
        "voices": VOICES,
        "sim_url": "/sim/?embed=1" if SIM_DIST.exists() else None,
        "agent_url": f"ws://127.0.0.1:{AGENT_PORT}/v1/realtime",
        "tests": [{"text": t, "url": f"/prompts/prompt_{i:02d}.wav"} for i, t in enumerate(TEST_PROMPTS)],
    }


@app.get("/api/status")
def status() -> dict:
    return agent.snapshot()


@app.post("/api/agent/start")
async def start(req: StartRequest) -> dict:
    if req.model not in {m["id"] for m in MODELS}:
        raise HTTPException(400, "Unknown model")
    await asyncio.to_thread(agent.start, req.model, req.why)
    return agent.snapshot()


@app.post("/api/agent/stop")
async def stop() -> dict:
    await asyncio.to_thread(agent.stop)
    return agent.snapshot()


@app.get("/api/system")
async def system(check: bool = False) -> dict:
    """What's running. With check=1 the lab also narrates the result, like running lsof and ps."""
    s = await asyncio.to_thread(scan)
    if check:
        a = s["agent"]
        lab_log(f"Server: running, pid {s['lab']['pid']}, port {LAB_PORT}.",
                cmd=f'lsof -nP -iTCP -sTCP:LISTEN | grep -E ":{LAB_PORT}|:{AGENT_PORT}"')
        if a["pid"]:
            lab_log(f"Model: {a['status']}, {a['label']}, pid {a['pid']}, {a['mb']:,} MB of memory.",
                    cmd=f"footprint {a['pid']}")
        elif a["port_pids"]:
            lab_log(f"Model: not ours, pid {a['port_pids'][0]} holds port {AGENT_PORT}.",
                    level="warn")
        else:
            lab_log("Model: not running.")
        lab_log(f"Next server start loads {s['remembered']['label']}.",
                cmd=f"cat {STATE_FILE_REL}")
        if s["leftovers"]:
            for p in s["leftovers"]:
                lab_log(f"Stray process: {describe(p)}.", cmd='ps -ef | grep -E "duck-lab|speech-to-speech"', level="warn")
        else:
            lab_log("No stray processes.", cmd='ps -ef | grep -E "duck-lab|speech-to-speech"',
                    level="good")
    return s


# --- Memory: who is using the Mac's RAM (the numbers Activity Monitor shows) ----------------

UNITS = {"B": 1 / 1024 / 1024, "K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024}


def to_mb(text: str) -> float:
    m = re.match(r"([\d.]+)([BKMGT])", text)
    return float(m.group(1)) * UNITS[m.group(2)] if m else 0.0


def sysctl(name: str) -> str:
    return subprocess.run(["sysctl", "-n", name], capture_output=True, text=True).stdout.strip()


def app_name(path: str) -> str:
    m = re.search(r"/([^/]+)\.app/", path)
    return m.group(1) if m else Path(path).name


def is_macos(path: str) -> bool:
    return path.startswith(("/System/", "/usr/", "/sbin/", "/bin/", "/Library/Apple/")) or "/" not in path


def memory_report() -> dict:
    # `top`'s MEM column is each process's real footprint, including GPU memory (what MLX uses).
    top = subprocess.run(["top", "-l", "1", "-stats", "pid,mem", "-n", "2000"],
                         capture_output=True, text=True).stdout
    mem = {}
    for line in top.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit():
            mem[int(parts[0])] = to_mb(parts[1].rstrip("+-"))
    paths = {}
    for line in subprocess.run(["ps", "-axo", "pid=,comm="], capture_output=True, text=True).stdout.splitlines():
        pid, _, path = line.strip().partition(" ")
        paths[int(pid)] = path.strip()

    model_pids = set(listening_pids(AGENT_PORT))
    if agent.proc and agent.proc.poll() is None:
        model_pids.add(agent.proc.pid)
    groups = {"macOS": 0.0, "Model": 0.0, "Chrome": 0.0, "Duck Lab server": 0.0}
    chromes: dict[str, float] = {}
    others: dict[str, float] = {}
    for pid, mb in mem.items():
        path = paths.get(pid, "kernel_task")
        if pid in model_pids:
            groups["Model"] += mb
        elif pid == os.getpid():
            groups["Duck Lab server"] += mb
        elif "/Google Chrome" in path:   # Chrome and Chrome Canary; the simulator and camera run in here
            groups["Chrome"] += mb
            name = app_name(path)
            chromes[name] = chromes.get(name, 0.0) + mb
        elif is_macos(path):
            groups["macOS"] += mb
        else:
            name = app_name(path)
            others[name] = others.get(name, 0.0) + mb
    top_others = sorted(others.items(), key=lambda kv: -kv[1])
    total_mb = int(sysctl("hw.memsize")) / 1024 / 1024
    swap = re.search(r"used = ([\d.]+)M", sysctl("vm.swapusage"))
    phys = re.search(r"PhysMem: (\S+) used \((\S+) wired, (\S+) compressor\), (\S+) unused", top)
    level = int(sysctl("kern.memorystatus_vm_pressure_level") or 1)
    return {
        "total_mb": round(total_mb),
        "used_mb": round(to_mb(phys.group(1))) if phys else None,
        "compressed_mb": round(to_mb(phys.group(3))) if phys else None,
        "swap_mb": round(float(swap.group(1))) if swap else 0,
        "free_percent": int(sysctl("kern.memorystatus_level") or 0),
        "pressure": {1: "normal", 2: "warning", 4: "critical"}.get(level, "normal"),
        "groups": [{"name": k, "mb": round(v),
                    **({"top": [{"name": n, "mb": round(m)} for n, m in chromes.items()]} if k == "Chrome" else {})}
                   for k, v in groups.items()]
                  + [{"name": "Other apps", "mb": round(sum(others.values())),
                      "top": [{"name": n, "mb": round(v)} for n, v in top_others[:5]]}],
    }


@app.get("/api/memory")
async def memory() -> dict:
    return await asyncio.to_thread(memory_report)


@app.post("/api/system/cleanup")
async def cleanup() -> dict:
    def work() -> None:
        found = leftovers()
        if not found:
            lab_log("No stray processes.", level="good")
        for p in found:
            lab_log(f"Stopping {describe(p)}…", cmd=f"kill {p['pid']}")
            os.kill(p["pid"], signal.SIGTERM)
        deadline = time.time() + 5
        while found and time.time() < deadline and any(process_info(p["pid"]) for p in found):
            time.sleep(0.25)
        for p in found:
            if process_info(p["pid"]):
                lab_log(f"pid {p['pid']} ignored kill, so we used kill -9.",
                        cmd=f"kill -9 {p['pid']}", level="warn")
                os.kill(p["pid"], signal.SIGKILL)
            else:
                lab_log(f"pid {p['pid']} has stopped.", level="good")
    await asyncio.to_thread(work)
    return await asyncio.to_thread(scan)


@app.post("/api/system/restart-lab")
def restart_lab() -> dict:
    """Replace this lab with a fresh copy of itself (same pid, same Terminal, same log)."""
    lab_log("Restarting server: stopping the model, loading fresh code, starting the model again. "
            "The page reloads when it's back.",
            cmd="Ctrl+C in the server's Terminal, then: uv run duck-lab")

    def later() -> None:
        time.sleep(0.5)
        if agent.proc is not None and agent.proc.poll() is None:
            agent.stop(why="server restarting")
        os.environ["DUCK_LAB_NO_BROWSER"] = "1"
        sys.stdout.flush()
        os.execv(sys.executable, [sys.executable, *sys.argv])

    threading.Thread(target=later, daemon=True).start()
    return {"ok": True}


@app.get("/api/events")
async def events() -> StreamingResponse:
    q: asyncio.Queue = asyncio.Queue()
    agent.subscribers.add(q)

    async def stream():
        try:
            yield f"data: {json.dumps({'type': 'status', **agent.snapshot()})}\n\n"
            for msg in list(lab_messages)[-60:]:
                yield f"data: {json.dumps({**msg, 'replay': True})}\n\n"
            for line in list(agent.log_tail)[-40:]:
                yield f"data: {json.dumps({'type': 'log', 'line': line[-300:]})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            agent.subscribers.discard(q)

    return StreamingResponse(stream(), media_type="text/event-stream")


app.mount("/moves", StaticFiles(directory=MOVES), name="moves")
app.mount("/prompts", StaticFiles(directory=PROMPTS), name="prompts")
if SIM_DIST.exists():
    app.mount("/sim", StaticFiles(directory=SIM_DIST, html=True), name="sim")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


def port_busy(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    url = f"http://localhost:{LAB_PORT}"
    # Check our port *before* anything else. The startup step (auto-starting the agent) runs
    # before the web server claims the port, so a second copy of the lab used to stop the
    # first copy's agent and then fail. Now it stops here and points you at the first one.
    if port_busy(LAB_PORT):
        pids = ", ".join(map(str, listening_pids(LAB_PORT))) or "unknown"
        write_lab_log(f"[lab] {time.strftime('%H:%M:%S')} Refused to start: the server is already running (pid {pids}).")
        print(f"[lab] The Duck Lab server is already running at {url} (pid {pids}).\n"
              f"      Use that one, or stop it first: Ctrl+C in its Terminal, or Simon OS → Restart server.\n"
              f"      $ lsof -nP -iTCP:{LAB_PORT} -sTCP:LISTEN", flush=True)
        if not os.environ.get("DUCK_LAB_NO_BROWSER"):
            webbrowser.open(url)
        sys.exit(1)
    if not os.environ.get("DUCK_LAB_NO_BROWSER"):
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()
    write_lab_log(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} server starting =====")
    print(f"[lab] Duck Lab running at {url}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=LAB_PORT, log_level="warning")


if __name__ == "__main__":
    main()
