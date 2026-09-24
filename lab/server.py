"""Duck Lab: a small local web server around Hugging Face's speech-to-speech agent.

It does three jobs, so nobody has to touch a terminal:

1. Starts and stops the voice agent (`speech-to-speech serve`) as a child process,
   with the language model chosen in the page.
2. Reads the agent's log as it runs and turns the timing lines into events
   ("turn detection took 80 ms", "speech-to-text took 0.30 s", ...) that it
   streams to the page over Server-Sent Events.
3. Serves the page itself, plus test questions spoken by macOS `say`.

The page talks to the agent directly over the OpenAI Realtime WebSocket protocol;
this server never touches the audio.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
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

STATE_FILE = HERE / ".agent-state.json"
LOG_DIR = HERE / "logs"  # one log file per agent run, kept so crashes can be diagnosed  # which model to bring back after a lab restart

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
    {"id": "mlx-community/gemma-3-1b-it-4bit", "label": "Gemma 3 1B", "gb": 0.8,
     "note": "Google's tiniest. Fastest, least clever."},
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

    def start(self, model_id: str) -> None:
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
            self.set_status("starting")
            threading.Thread(target=self._read_log, args=(self.proc,), daemon=True).start()

    def stop(self, forget: bool = True) -> None:
        with self.lock:
            self._stop_locked()
        if forget:
            STATE_FILE.unlink(missing_ok=True)
        self.set_status("stopped")

    def _stop_locked(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

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
            tail = "\n".join(list(self.log_tail)[-8:])
            self.set_status("error", f"The agent stopped unexpectedly.\n{tail}")


agent = Agent()
app = FastAPI(title="Duck Lab")


@app.on_event("startup")
async def _startup() -> None:
    agent.loop = asyncio.get_running_loop()
    await asyncio.to_thread(make_test_prompts)
    await asyncio.to_thread(fetch_moves)
    # If the agent was running when the lab last shut down, bring it back.
    try:
        last = json.loads(STATE_FILE.read_text()).get("model")
    except (OSError, ValueError):
        last = None
    if last in {m["id"] for m in MODELS}:
        await asyncio.to_thread(agent.start, last)


@app.on_event("shutdown")
def _shutdown() -> None:
    agent.stop(forget=False)


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
            print(f"Couldn't download move {name}: {e}")


class StartRequest(BaseModel):
    model: str


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
    await asyncio.to_thread(agent.start, req.model)
    return agent.snapshot()


@app.post("/api/agent/stop")
async def stop() -> dict:
    await asyncio.to_thread(agent.stop)
    return agent.snapshot()


@app.get("/api/events")
async def events() -> StreamingResponse:
    q: asyncio.Queue = asyncio.Queue()
    agent.subscribers.add(q)

    async def stream():
        try:
            yield f"data: {json.dumps({'type': 'status', **agent.snapshot()})}\n\n"
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


def main() -> None:
    url = f"http://127.0.0.1:{LAB_PORT}"
    if not os.environ.get("DUCK_LAB_NO_BROWSER"):
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()
    print(f"Duck Lab running at {url}")
    uvicorn.run(app, host="127.0.0.1", port=LAB_PORT, log_level="warning")


if __name__ == "__main__":
    main()
