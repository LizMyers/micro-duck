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
import { measure, evaluatePoseDetailed, NodDetector, POSE_IDS, POSE_LABELS } from "/static/pose.js";
import { calibrationProblem, calibrationIssue, SETUP_LINES } from "/static/simon-says.js";
import { setMic, releaseMicAfterSilence, cancelMicRelease } from "/static/audio.js";
import { clearChat } from "/static/chat.js";
import { cam, startCamera, stopCamera, calibrate } from "/static/camera.js";
import { startAgent, listenToServer, onAgentStatus } from "/static/server-link.js";
import { makeGame } from "/static/game-host.js";

const MODEL = "mlx-community/Qwen3-4B-Instruct-2507-4bit";   // Qwen3 4B: the one Simon Says is tuned on
// Simon's personality in chat (between games). Friendly first, cheeky only lightly: rapport before cheek.
// He never says his own name (players may rename their duck). He loves to host the game, so he invites
// you to play (Liz saw him do it unprompted and loved it; this makes it reliable, not luck).
// (He used to "love hosting games of Simon Says" and invite people to play whenever the chat slowed, so
// all he wanted to do was play, Liz 2026-09-26. Now he's a chatty duck who can host a game.)
const PERSONALITY =
  "You are a small, cheerful robot duck, a Pollen Microduck. " +
  "You are friendly, curious and a little playful, and happy to chat about anything. " +
  "Speak in the first person and never say your own name. Answer in one or two short sentences. " +
  "You can also host a game of Simon Says, but don't push it: mention it only if someone asks what you can do " +
  "or the conversation has clearly run out, and at most once. Otherwise just chat. " +
  "Never use lists, markdown or emoji; everything you write will be spoken aloud.";

const inspector = new Inspector($("inspector"), { plain: true });   // no emojis on this page
const body = new DuckBody({
  iframe: $("sim"),   // (no mood badge or Beak / Head / Why row on this page: the sim fills the card)
});

// ---------- Simon's status: one line under the sim, with Start / Restart ---------------------
const HEALTH = {
  // Leads into the screen below it (Liz): the setup steps, or the big Play! button.
  // During setup: short, and it moves on with you (Liz): camera off, look at him, then the question.
  ready: ["READY", () => $("panel-game").dataset.phase !== "setup" ? "Simon is ready to play! Are you?"
    : !cam.on ? "Simon is ready. Your camera is OFF." : setup.step === "go" ? "Are you ready?" : "Simon is ready. Look at him."],
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
  calibrateHint: "Sit up, and look at Simon",
});

// ---------- The game panel: one big screen at a time -----------------------------------------
// setup (3 steps) → ready (Play!) → playing → over (Play again). data-phase on the panel picks the
// screen; the new one slides in like a page. The game tells us what's happening (makeGame's onGame).
const panel = $("panel-game");
const screens = $("screens");
// Slide `name` in and the current one out, among a container's children (matched by data-<key>).
function slideTo(container, key, name) {
  for (const el of container.children) {
    const on = el.dataset[key] === name;
    if (!on && el.classList.contains("in")) { el.classList.remove("in"); el.classList.add("out"); }
    if (on && !el.classList.contains("in")) {
      el.classList.remove("out");
      el.classList.add("enter");   // on the page, off to the right: where the slide starts from
      void el.offsetWidth;
      el.classList.replace("enter", "in");
    }
  }
  setTimeout(() => { for (const el of container.children) if (!el.classList.contains("in")) el.classList.remove("out"); }, 400);
}
function showScreen(name) {
  if (panel.dataset.phase === name) return;
  panel.dataset.phase = name;
  ctx.os?.render();   // Simon's status line words itself for this screen
  slideTo(screens, "screen", name);
}
// Between games: setup until the camera is set up, then ready (or stay on the result until Play again).
const betweenGames = () => (cam.on && cam.calibrated ? "ready" : "setup");

// ---------- Setup: one step at a time (1 Turn on camera, 2 Sit up and face me, 3 Yes, let's go!) ----------
const setup = { live: null, ok: false, okSince: null };   // ok: the camera likes how you're sitting
const OK_HOLD_MS = 1000;   // "Perfect!" for this long before step 3 slides in (no flicker while you settle)
function showStep(step) {
  setup.step = step;
  slideTo($("setup-steps"), "step", step);
  ctx.os?.render();   // the status line moves on with you
}
function showSetupSteps() {
  setup.ok = false; setup.okSince = null;
  $("setup-camera").disabled = false;
  showStep(cam.on ? "adjust" : "camera");
}

function stanceNow() {
  const m = measure(cam.tracker?.latest?.landmarks, cam.tracker?.aspect);
  return calibrationIssue(m);
}
// Step 2's words: a fun line for what the camera sees, a new wording each time a problem comes back.
const setupTurn = {};
let lastIssue;
function setupLine(issue) {
  const key = issue ?? "ok";
  if (key !== lastIssue) { setupTurn[key] = (setupTurn[key] ?? -1) + 1; lastIssue = key; }
  const lines = SETUP_LINES[key];
  return lines[setupTurn[key] % lines.length];
}

async function turnOnCamera() {
  showScreen("setup");
  $("setup-camera").disabled = true;
  $("setup-check").textContent = "Starting the camera… (allow access)";
  if (!cam.on) await startCamera({ forGame: true });
  showSetupSteps();
  if (!cam.on) { $("setup-check").textContent = "The camera didn't start: allow camera access in Chrome's address bar."; return; }
  // Live feedback while you get into position; once it's been "Perfect!" for a second, step 3 slides in.
  clearInterval(setup.live);
  setup.live = setInterval(() => {
    const problem = stanceNow();
    $("setup-check").textContent = setupLine(problem);
    $("setup-adjust").dataset.ok = String(!problem);
    setup.ok = !problem;
    setup.okSince = problem ? null : setup.okSince ?? performance.now();
    if (setup.step === "adjust" && setup.okSince && performance.now() - setup.okSince >= OK_HOLD_MS) {
      clearInterval(setup.live);
      showStep("go");
    }
  }, 200);
}

async function calibrateNow() {
  $("setup-calibrate").disabled = true;
  for (const n of ["3", "2", "1"]) { $("setup-ready-sub").textContent = `Hold still… ${n}`; await sleep(700); }
  $("setup-ready-sub").textContent = "";
  $("setup-calibrate").disabled = false;
  const base = calibrate();
  const problem = calibrationProblem(base);
  if (problem) {
    cam.calibrated = false;   // an unusable stance doesn't count as set up (the game started on one, 2026-09-26)
    inspector.note(`📷 page: calibration not usable: ${problem}`, base, "warn");
    await turnOnCamera();   // back to step 2, with live feedback
    return;
  }
  // "Yes, let's go!" means go (Liz: don't ask twice): straight into the game. The Ready screen is for
  // between games, or if Simon isn't ready yet.
  showScreen("ready");
  if (!ctx.game.app.ready()) ctx.game.start();
}

$("setup-camera").onclick = turnOnCamera;
$("setup-calibrate").onclick = calibrateNow;
$("setup-again").onclick = () => { cam.calibrated = false; turnOnCamera(); };
// Put the game away: camera off (and any game stopped); the panel goes back to step 1.
for (const b of document.querySelectorAll("[data-camera-off]")) b.onclick = () => {
  if (ctx.game?.running) ctx.game.stop("Stopped.");
  if (cam.on) stopCamera();
};
$("play-again").onclick = () => sayYes();
$("play-stop").onclick = () => ctx.game.stop("Stopped.");

// ---------- The game's moments, drawn big ----------
const game = { pose: null };
function onGame(ev) {
  if (ev.type === "playing") { game.pose = null; $("play-round").textContent = "Get ready"; showScreen("playing"); }
  if (ev.type === "round") {
    game.pose = ev.pose;
    game.hold = 0;
    $("play-round").textContent = `Round ${ev.round} of ${ev.rounds}`;
    setMove(ev.move);
  }
  if (ev.type === "hold") game.hold = ev.progress;
  if (ev.type === "result") { game.pose = null; game.hold = 0; setMove(ev.text); }
  if (ev.type === "say") game.lastSaid = ev.big;   // for a stop without a message ("Simon didn't answer…")
  if (ev.type === "lost") { game.pose = null; setMove("I can't see you!"); }
  if (ev.type === "back") setMove("There you are!");
  if (ev.type === "over") {
    game.pose = null;
    const simon = ev.winner === "simon";
    $("over-headline").textContent = simon ? "Simon wins!" : "You win!";
    $("over-headline").classList.toggle("simon", simon);
    $("over-why").textContent = ev.why || "";
    showScreen("over");
  }
  if (ev.type === "stopped") {
    game.pose = null;
    $("ss-start").textContent = "Play!";   // (the game renames its Start button "Start game")
    if (panel.dataset.phase === "playing") showScreen(betweenGames());
    const why = ev.message || game.lastSaid;
    if (why) $("ss-ready").textContent = why;
  }
}
// First screen: setup (or ready, if the camera is somehow already set up). Camera off later: back to setup.
showSetupSteps();
showScreen(betweenGames());
ctx.onCameraStop = () => { clearInterval(setup.live); showSetupSteps(); ctx.os?.render(); if (!ctx.game?.running) showScreen("setup"); };

// The move pops in like a new card being dealt.
function setMove(text) {
  const m = $("play-move");
  m.textContent = text;
  m.classList.remove("pop"); void m.offsetWidth; m.classList.add("pop");
}

// "I see": the move the camera reads right now (ready and playing screens). During a round it goes green
// when it's the move Simon called, and fills while you hold it for the second.
setInterval(() => {
  const d = cam.on && cam.calibrated ? evaluatePoseDetailed(cam.tracker?.latest?.landmarks, cam.tracker?.baseline, cam.tracker?.aspect) : null;
  const seenIds = d ? POSE_IDS.filter((id) => d[id]?.ok) : [];
  const word = !cam.on ? "Camera off" : seenIds.length ? seenIds.map((id) => POSE_LABELS[id]).join(" + ") : "No move";
  const match = !!game.pose && seenIds.includes(game.pose);
  const hold = game.pose ? game.hold || 0 : 0;   // the referee's own count (the "hold" event)
  for (const chip of document.querySelectorAll("[data-seen]")) {
    chip.querySelector("strong").textContent = word;
    chip.classList.toggle("match", match);
    chip.querySelector(".meter").style.width = `${hold * 100}%`;
  }
  // Play again only once Simon has finished talking about the last game.
  const busy = !!(ctx.game?.running || ctx.game?.starting);
  $("play-again").disabled = busy;
  // A nod is a yes (Ready and Game over screens): the same as pressing the big button.
  const asking = !busy && cam.on && cam.calibrated && ["ready", "over"].includes(panel.dataset.phase);
  if (!asking) { nod.samples = []; return; }
  const m = measure(cam.tracker?.latest?.landmarks, cam.tracker?.aspect);
  if (m && cam.tracker.baseline && nod.feed(performance.now(), m.pitch - cam.tracker.baseline.pitch)) {
    inspector.note("🙂 page: you nodded: that's a yes");
    sayYes();
  }
}, 100);
const nod = new NodDetector();
// Yes (a nod, the big button, or saying so): play.
function sayYes() {
  if (ctx.game?.running || ctx.game?.starting) return;
  ctx.game.start();
}

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

new MacOS({ labels: { "Duck Lab server": "Simon's server" } });
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
  needSetup: () => { $("tab-game").click(); turnOnCamera(); },
  onGame,
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
