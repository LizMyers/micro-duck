// The game page: Simon Says with Simon the Microduck, and nothing else.
//
// It uses the same modules as the lab (voice lines, turn-taking, the agent, audio, camera, chat, the
// game) and adds only what this page needs: camera setup before Start, a small Simon settings tab
// (status, Start/Restart, colour), and its own layout (play.html, play.css). Simon runs one fixed,
// tested model: choosing others is one of the "taking it further" ideas in the README.

import { $, state, ctx, toast, sleep } from "/static/core.js";
import { DuckBody } from "/static/duck-body.js";
import { Inspector } from "/static/inspector.js";
import { MacOS } from "/static/mac-os.js";
import { measure } from "/static/pose.js";
import { calibrationProblem } from "/static/simon-says.js";
import { setMic } from "/static/audio.js";
import { clearChat } from "/static/chat.js";
import { cam, startCamera, calibrate } from "/static/camera.js";
import { startAgent, listenToServer, onAgentStatus } from "/static/server-link.js";
import { makeGame } from "/static/game-host.js";

const MODEL = "mlx-community/Qwen3-4B-Instruct-2507-4bit";   // Qwen3 4B: the one Simon Says is tuned on
const PERSONALITY =
  "You are a friendly voice assistant. Answer in one or two short sentences. " +
  "Never use lists, markdown or emoji; everything you write will be spoken aloud.";

const inspector = new Inspector($("inspector"));
const body = new DuckBody({
  iframe: $("sim"), moodEl: $("mood"), whyEl: $("mood-why"),
  beakBar: $("beak-meter"), beakNum: $("beak-num"), headDot: $("head-dot"), headText: $("head-text"),
});

// ---------- Simon settings: one clear status line, and Start / Restart ----------------------
const HEALTH = {
  ready: ["READY", () => "Simon is ready to play."],
  busy: ["BUSY", () => "Another tab is connected to Simon (he talks to one page at a time). Close the other tabs."],
  starting: ["LOADING", (s) => `Simon is waking up: ${s.secs} s (usually 1–3 minutes).`],
  stopped: ["STOPPED", () => "Simon is asleep. Press Start Simon."],
  error: ["CRASHED", () => "Simon's voice agent stopped unexpectedly. Press Start Simon."],
  unknown: ["?", () => "No connection to the server. Start it in Terminal, then reload."],
};

class SimonSettings {
  constructor() {
    this.status = "unknown";
    this.busy = false;
    this.startingSince = null;
    $("simon-start").onclick = () => {
      const running = this.status === "ready" || this.status === "starting";
      startAgent(MODEL, running ? "you pressed Restart Simon" : "you pressed Start Simon");
    };
    setInterval(() => { if (this.status === "starting") this.render(); }, 1000);
  }
  connected() {}
  disconnected() { this.status = "unknown"; this.render(); }
  onLab() {}   // the server's narration stays in the lab
  onStatus(ev) {
    if (ev.status === "starting" && this.status !== "starting") this.startingSince = Date.now();
    this.status = ev.status;
    this.render();
  }
  setBusy(busy) { this.busy = busy; this.render(); }
  render() {
    const st = this.status === "ready" && this.busy ? "busy" : this.status;
    const [word, detail] = HEALTH[st] || HEALTH.unknown;
    const secs = this.startingSince ? Math.round((Date.now() - this.startingSince) / 1000) : 0;
    $("health").dataset.state = st;
    $("health-word").textContent = word;
    $("health-detail").textContent = detail({ secs });
    $("simon-start").textContent = st === "ready" || st === "starting" || st === "busy" ? "Restart Simon" : "Start Simon";
  }
}

Object.assign(ctx, {
  inspector, body,
  instructions: () => PERSONALITY,
  voice: () => "aiden",
  muteWhileSpeaking: () => false,
  tools: [],          // no duck moves by voice here: just the game (play_simon_says)
  os: new SimonSettings(),
});

// ---------- Camera setup: before Start, on the page ----------------------------------------
// Turn on the camera, see live whether your stance is usable, then calibrate with a 3-2-1.
// Start appears in its place once you're calibrated.
const setup = { live: null };

function showSetup(on) {
  $("setup").hidden = !on;
  $("start-row").hidden = on;
}

function stanceNow() {
  const m = measure(cam.tracker?.latest?.landmarks, cam.tracker?.aspect);
  return calibrationProblem(m);
}

async function turnOnCamera() {
  $("setup-camera").disabled = true;
  if (!cam.on) await startCamera({ forGame: true });
  $("setup-camera").disabled = false;
  if (!cam.on) { $("setup-check").textContent = "The camera didn't start: allow camera access in Chrome's address bar."; return; }
  $("setup-camera").hidden = true;
  $("setup-calibrate").hidden = false;
  // Live feedback while you get into position.
  clearInterval(setup.live);
  setup.live = setInterval(() => {
    const problem = stanceNow();
    $("setup-check").textContent = problem ? problem.replace(/\bme\b/g, "the camera") : "Looks good. Press I'm ready.";
    $("setup-check").dataset.ok = String(!problem);
  }, 300);
}

async function calibrateNow() {
  $("setup-calibrate").disabled = true;
  clearInterval(setup.live);
  for (const n of ["3", "2", "1"]) { $("setup-check").textContent = `Hold still… ${n}`; await sleep(700); }
  const base = calibrate();
  const problem = calibrationProblem(base);
  $("setup-calibrate").disabled = false;
  if (problem) {
    inspector.note(`📷 page: calibration not usable: ${problem}`, base, "warn");
    await turnOnCamera();   // back to live feedback
    return;
  }
  $("setup-check").textContent = "";
  showSetup(false);
}

$("setup-camera").onclick = turnOnCamera;
$("setup-calibrate").onclick = calibrateNow;
$("setup-again").onclick = async () => { showSetup(true); await turnOnCamera(); };

// ---------- The rest of the page ------------------------------------------------------------
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.onclick = () => {
    for (const t of tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
  };
}

// Duck colour: the simulator's duck and the page's colours follow the same choice (remembered).
function setDuckColour(name) {
  document.documentElement.dataset.duck = name;
  body.colour = name;
  body.setColour(name);
  for (const d of document.querySelectorAll("#duck-colour .dot")) d.setAttribute("aria-checked", String(d.dataset.colour === name));
  try { localStorage.setItem("duck-colour", name); } catch {}
}
{
  let saved = "blue";
  try { saved = localStorage.getItem("duck-colour") || "blue"; } catch {}
  setDuckColour(saved);
  for (const d of document.querySelectorAll("#duck-colour .dot")) d.onclick = () => setDuckColour(d.dataset.colour);
}

new MacOS();
ctx.game = makeGame({ setupOnPage: true });
$("talk").onclick = () => setMic(!state.micOn);
$("clear-chat").onclick = clearChat;

state.options = await (await fetch("/api/options")).json();
if (state.options.sim_url) $("sim").src = state.options.sim_url;
else $("sim-missing").hidden = false;
listenToServer();
onAgentStatus(await (await fetch("/api/status")).json());
if (state.agentStatus === "stopped") toast("Simon is asleep: open Simon settings and press Start Simon.", 8000);
