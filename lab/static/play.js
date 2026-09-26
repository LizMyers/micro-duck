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
import { setMic, releaseMicAfterSilence, cancelMicRelease } from "/static/audio.js";
import { clearChat } from "/static/chat.js";
import { cam, startCamera, calibrate } from "/static/camera.js";
import { startAgent, listenToServer, onAgentStatus } from "/static/server-link.js";
import { makeGame } from "/static/game-host.js";

const MODEL = "mlx-community/Qwen3-4B-Instruct-2507-4bit";   // Qwen3 4B: the one Simon Says is tuned on
// Simon's personality in chat (between games). Friendly first, cheeky only lightly: rapport before cheek.
// He never says his own name (players may rename their duck). He loves to host the game, so he invites
// you to play (Liz saw him do it unprompted and loved it; this makes it reliable, not luck).
const PERSONALITY =
  "You are a small, cheerful robot duck, a Pollen Microduck, who loves hosting games of Simon Says. " +
  "You are friendly, curious and a little playful. Speak in the first person and never say your own name. " +
  "Answer in one or two short sentences. When the chat winds down, or someone seems bored, " +
  "invite them to play Simon Says. " +
  "Never use lists, markdown or emoji; everything you write will be spoken aloud.";

const inspector = new Inspector($("inspector"), { plain: true });   // no emojis on this page
const body = new DuckBody({
  iframe: $("sim"),   // (no mood badge or Beak / Head / Why row on this page: the sim fills the card)
});

// ---------- Simon's status: one line under the sim, with Start / Restart ---------------------
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
    $("simon-start").onclick = () => startAgent(MODEL, "you pressed Start Simon");
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
    // Only when Simon isn't running (asleep, crashed, or the server lost): a player never needs Restart.
    $("simon-start").hidden = st === "ready" || st === "starting" || st === "busy";
    $("simon-start").textContent = "Start Simon";
  }
}

Object.assign(ctx, {
  inspector, body,
  instructions: () => PERSONALITY,
  voice: () => "aiden",
  muteWhileSpeaking: () => false,
  tools: [],          // no duck moves by voice here: just the game (play_simon_says)
  os: new SimonSettings(),
  // Player words, not lab words, on the talk button and the busy message.
  // The talk button is only a button: Simon's status lives under the sim (the button just greys out).
  talkLabels: { starting: "Tap to talk", stopped: "Tap to talk", error: "Tap to talk", busy: "Tap to talk" },
  busyMessage: "Simon is busy in another tab: close it, then reload this page.",
  // Your moves in the Inspector only during a game, when they're evidence; otherwise every glance shows up.
  logPoses: () => !!(ctx.game?.running || ctx.game?.starting),
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
    cam.calibrated = false;   // an unusable stance doesn't count as set up (the game started on one, 2026-09-26)
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

// ---------- Inspector / chat divider: drag the chat's title bar to share the space ----------
// The Inspector's height is remembered as a share of the column, so it survives a resize or reload.
{
  const top = document.querySelector(".split-top"), col = document.querySelector(".side.split"), bar = $("chat-head");
  const MIN = 120;   // px: neither panel shrinks to nothing
  const setTop = (px) => {
    const max = col.clientHeight - MIN - bar.offsetHeight;
    const h = Math.max(MIN, Math.min(max, px));
    top.style.flex = `0 0 ${h}px`;
    return h;
  };
  // Every visit starts aligned (Liz); a drag lasts for the visit only.
  const save = () => {};
  try { localStorage.removeItem("play-split"); } catch {}
  // Default: the chat bar's top edge level with the top of the left tab bar (measured, so it holds at any size).
  const tabsBar = document.querySelector(".controls .tabs");
  const align = () => setTop(tabsBar.getBoundingClientRect().top - col.getBoundingClientRect().top);
  let saved = null;   // true once you've dragged it this visit
  align();
  new ResizeObserver(() => { if (!saved) align(); }).observe(col);
  let drag = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;   // Clear is still a button
    drag = { y: e.clientY, h: top.offsetHeight };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag || Math.abs(e.clientY - drag.y) < 3) return;   // a click isn't a drag
    drag.moved = true;
    setTop(drag.h + e.clientY - drag.y);
  });
  const end = () => { if (!drag) return; if (drag.moved) saved = true; drag = null; bar.classList.remove("dragging"); };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("dblclick", () => { saved = null; align(); });
  // Keyboard: arrow keys move the divider.
  bar.addEventListener("keydown", (e) => {
    const step = { ArrowUp: -24, ArrowDown: 24 }[e.key];
    if (!step) return;
    e.preventDefault();
    setTop(top.offsetHeight + step);
    save();
    saved = true;
  });
}

// ---------- The rest of the page ------------------------------------------------------------
// Tabs, with a duck-yellow underline that slides to the active one.
function moveInk(tablist) {
  const ink = tablist.querySelector(".tab-ink"), on = tablist.querySelector('[aria-selected="true"]');
  if (!ink || !on) return;
  ink.style.width = `${on.offsetWidth}px`;
  ink.style.transform = `translateX(${on.offsetLeft}px)`;
}
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.onclick = () => {
    const list = tab.closest('[role="tablist"]');
    for (const t of list.querySelectorAll('[role="tab"]')) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
    moveInk(list);
  };
}
for (const list of document.querySelectorAll('[role="tablist"]')) {
  moveInk(list);
  new ResizeObserver(() => moveInk(list)).observe(list);   // stays under its tab when fonts load or the page resizes
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
// The RAM banner's height, for play.css: the right column shrinks by it so nothing goes off screen.
{
  const banner = $("ram-warning");
  const setH = () => document.documentElement.style.setProperty("--banner-h", banner.hidden ? "0px" : `${banner.offsetHeight}px`);
  new MutationObserver(setH).observe(banner, { attributes: true, attributeFilter: ["hidden"] });
  new ResizeObserver(setH).observe(banner);
  setH();
}
ctx.game = makeGame({
  setupOnPage: true,
  isSetUp: () => cam.on && cam.calibrated,
  needSetup: () => { $("tab-game").click(); showSetup(true); if (cam.on) turnOnCamera(); },
});
$("talk").onclick = () => setMic(!state.micOn);

// Hold the space bar to talk (a walkie-talkie). Tap to talk still works as a toggle. Not during a game:
// the mic is off while Simon referees, so you talk to him only between games.
{
  const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  let holding = false;
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || typing(document.activeElement)) return;
    e.preventDefault();                // no page scroll, and no "click" on a focused button
    if (e.repeat || holding) return;
    if ($("talk").disabled) return;
    if (ctx.game?.running) { toast("The mic is off during a game: talk to Simon when it's over."); return; }
    if (state.micOn) return;           // already on via Tap to talk: leave it alone
    holding = state.holdToTalk = true;
    cancelMicRelease();
    setMic(true);
  });
  const release = () => {
    if (!holding) return;
    holding = state.holdToTalk = false;
    releaseMicAfterSilence();
  };
  window.addEventListener("keyup", (e) => { if (e.code === "Space" && !typing(document.activeElement)) { e.preventDefault(); release(); } });
  window.addEventListener("blur", release);   // let go outside the window: stop too
}
$("clear-chat").onclick = clearChat;

state.options = await (await fetch("/api/options")).json();
if (state.options.sim_url) $("sim").src = state.options.sim_url;
else $("sim-missing").hidden = false;
listenToServer();
onAgentStatus(await (await fetch("/api/status")).json());
if (state.agentStatus === "stopped") toast("Simon is asleep: press Start Simon on the Simon Says tab.", 8000);
