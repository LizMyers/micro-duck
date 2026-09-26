// Duck Lab: the workshop page for Hugging Face's speech-to-speech agent and Simon the duck.
//
// The shared parts live in their own modules (voice-lines, turn-taking, agent, audio, camera, chat,
// game-host); this file adds what only the lab has: personalities and the model picker, the relay race
// (where the time goes in each turn), the model's raw log, duck moves by voice, Copy me, skates and
// duck colours. The game page (play.js) uses the same modules without these.

import { $, state, ctx, toast, fmt } from "/static/core.js";
import { DuckBody } from "/static/duck-body.js";
import { Inspector } from "/static/inspector.js";
import { TOOLS, runTool, TOOL_LABELS, perform, setTrace } from "/static/duck-tools.js";
import { SimonOS } from "/static/simon-os.js";
import { MacOS } from "/static/mac-os.js";
import { send, sessionUpdate, whenIdle, sayOnly } from "/static/agent.js";
import { setMic } from "/static/audio.js";
import { addAction, finishAction, clearChat } from "/static/chat.js";
import { cam, startCamera, stopCamera, calibrate } from "/static/camera.js";
import { lineCache, saved } from "/static/voice-lines.js";
import { startAgent, stopAgent, listenToServer, onAgentStatus } from "/static/server-link.js";
import { makeGame } from "/static/game-host.js";

const PRESETS = {
  "Helpful & brief":
    "You are a friendly voice assistant. Answer in one or two short sentences. " +
    "Never use lists, markdown or emoji; everything you write will be spoken aloud.",
  "Chatty":
    "You are a warm, curious voice assistant who enjoys a chat. Answer in three or four sentences " +
    "and ask a follow-up question. No lists, markdown or emoji.",
  "Simon the duck":
    "You are Simon, a small, cheerful robot duck. You are curious, a little mischievous, " +
    "and easily delighted. Keep replies to one short sentence. No lists, markdown or emoji.",
};

const ui = {
  model: $("model"), modelNote: $("model-note"), switchModel: $("switch-model"), switchHint: $("switch-hint"),
  voice: $("voice"), preset: $("preset"), instructions: $("instructions"), apply: $("apply"),
  talk: $("talk"), muteWhileSpeaking: $("mute-while-speaking"), clearChat: $("clear-chat"),
  total: $("total"), log: $("log"),
};

const inspector = new Inspector($("inspector"));
setTrace((text, detail) => inspector.note(`🦆 ${text}`, detail, "tool"));
const body = new DuckBody({
  iframe: $("sim"), moodEl: $("mood"), whyEl: $("mood-why"),
  beakBar: $("beak-meter"), beakNum: $("beak-num"), headDot: $("head-dot"), headText: $("head-text"),
});

Object.assign(ctx, {
  inspector, body,
  instructions: () => ui.instructions.value,
  voice: () => ui.voice.value,
  muteWhileSpeaking: () => ui.muteWhileSpeaking.checked,
  tools: TOOLS,
  onTool: runDuckMove,
  relay: { newTurn, setStage },
  onCameraFrame: () => { if (copy.on) copyHead(); },
  onCameraStop: () => setCopy(false),
});

// ---------- Personalities, voices and the model picker (remembered in this browser) ---------------

async function loadOptions() {
  state.options = await (await fetch("/api/options")).json();
  for (const m of state.options.models) {
    const opt = new Option(`${m.label} · ${m.gb} GB${m.cached ? "" : " (not downloaded yet)"}`, m.id);
    ui.model.add(opt);
  }
  for (const v of state.options.voices) {
    ui.voice.add(new Option(v.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), v));
  }
  if (state.options.sim_url) $("sim").src = state.options.sim_url;
  else $("sim-missing").hidden = false;
  for (const name of Object.keys(PRESETS)) ui.preset.add(new Option(name, name));
  ui.instructions.value = PRESETS[ui.preset.value];
  restorePrefs();
  showVoice();
  showModelNote();
}

function showModelNote() {
  const m = state.options?.models.find((x) => x.id === ui.model.value);
  if (!m) return;
  const current = state.agentModel === m.id && state.agentStatus !== "stopped";
  ui.switchModel.disabled = current || state.agentStatus === "starting";
  ui.switchHint.textContent = current ? "Running."
    : state.agentStatus === "starting" ? "Wait until READY."
    : "Switch restarts the model: 1–3 minutes.";
  ui.modelNote.textContent =
    `${m.note} ` + (m.cached ? "Already downloaded." : `First start downloads ${m.gb} GB, so give it a few minutes.`);
}

function savePrefs() {
  try {
    localStorage.setItem("duck-lab", JSON.stringify({
      model: ui.model.value, voice: ui.voice.value, preset: ui.preset.value,
      instructions: ui.instructions.value, mute: ui.muteWhileSpeaking.checked, muteV2: true,
    }));
  } catch {}
}

function restorePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("duck-lab") || "null");
    if (!p) return;
    if (p.model) ui.model.value = p.model;
    if (p.voice) ui.voice.value = p.voice;
    if (p.preset) ui.preset.value = p.preset;
    // Earlier versions accidentally saved the body rules into the personality.
    if (p.instructions) ui.instructions.value = p.instructions.split("\n\nYou have a small robot duck body")[0];
    if (typeof p.mute === "boolean" && p.muteV2) ui.muteWhileSpeaking.checked = p.mute;
  } catch {}
}

function showVoice() {
  $("os-voice").textContent = `${ui.voice.selectedOptions[0]?.text || "–"} · personality: ${ui.preset.value}`;
}

// ---------- The model's raw log, made scannable -----------------------------------------------
// Keep the time and the message, drop the date and the long module name (it's in the tooltip), and
// colour warnings and errors.
// "2026-09-24 11:29:44,912 - [pipeline 0] speech_to_speech.api...response - INFO - Response done"
const LOG_LINE = /^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d),\d+ - (?:\[pipeline \d+\] )?(\S+) - (DEBUG|INFO|WARNING|ERROR|CRITICAL) - (.*)$/;

function appendLog(line) {
  const atBottom = ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 20;
  const row = document.createElement("div");
  const m = LOG_LINE.exec(line);
  if (m) {
    const [, time, module, level, msg] = m;
    row.textContent = `${time} ${msg}`;
    row.title = `${level} · ${module}`;
    row.dataset.level = level.toLowerCase();
  } else {
    row.textContent = line;
    if (/Traceback|Error\b|Exception/.test(line)) row.dataset.level = "error";
  }
  ui.log.append(row);
  while (ui.log.childElementCount > 1500) ui.log.firstChild.remove();
  if (atBottom) ui.log.scrollTop = ui.log.scrollHeight;
}

// ---------- The relay race: where the time goes in each turn ---------------------------------

const STAGES = ["listening", "turn", "stt", "thinking", "voice"];

function stageEl(name) { return document.querySelector(`[data-stage="${name}"]`); }

function setStage(name, st, seconds, calc = false) {
  const el = stageEl(name);
  el.dataset.state = st;
  if (seconds !== undefined) {
    el.querySelector(".time").innerHTML = fmt(seconds) + (calc ? '<span class="calc">calc.</span>' : "");
  }
}

function newTurn() {
  state.turn = { t0: performance.now(), stoppedAt: null, firstAudioAt: null, log: {} };
  for (const s of STAGES) setStage(s, "idle", null);
  for (const s of STAGES) stageEl(s).querySelector(".time").textContent = "–";
  stageEl("turn").querySelector("small").textContent = "Finished, or just a pause?";
  ui.total.textContent = "…";
  setStage("listening", "active");
}

// Timing lines parsed from the agent's log by the lab server.
function onStage(ev) {
  if (ev.stage === "speech_started") {
    if (!state.turn || state.turn.done) newTurn();
    return;
  }
  if (!state.turn) newTurn();
  const log = state.turn.log;
  // Every event carries `t`: when the lab server read that log line (seconds).
  // Some stages log their own duration; the rest we measure between events.
  switch (ev.stage) {
    case "speech_ended":
      log.speech_s = ev.speech_s;
      log.ended_t = ev.t;
      setStage("listening", "done", ev.speech_s);
      setStage("turn", "active");
      break;
    case "turn":
      // "complete" = you've finished. "incomplete" = you might carry on, so it
      // waits a moment longer; that wait is counted in this stage too.
      setStage("turn", "active", ev.turn_s);
      stageEl("turn").querySelector("small").textContent =
        ev.verdict === "complete" ? "Sounded finished" : "Sounded unfinished, so it waited";
      break;
    case "stt": {
      log.stt_s = ev.stt_s;
      log.stt_t = ev.t;
      // Turn check = from end of speech until speech-to-text began.
      log.turn_s = log.ended_t ? Math.max(0, ev.t - ev.stt_s - log.ended_t) : undefined;
      setStage("turn", "done", log.turn_s, true);
      setStage("stt", "done", ev.stt_s);
      setStage("thinking", "active");
      break;
    }
    case "tts_first_audio":
      log.tts_s = ev.tts_s;
      // Thinking = from transcript ready until the voice model started on the reply.
      if (log.stt_t) log.thinking_s = Math.max(0, ev.t - ev.tts_s - log.stt_t);
      setStage("thinking", "done", log.thinking_s, true);
      setStage("voice", "active", ev.tts_s);
      break;
    case "total":
      log.total_s = ev.total_s;
      ui.total.textContent = fmt(ev.total_s) + (state.warm ? "" : "  (cold start)");
      state.turn.done = true;
      break;
  }
}

// ---------- Duck moves by voice ---------------------------------------------------------------
// The model wants the duck to move. Start the move, tell the model straight away that it has started
// (the agent won't talk again until it hears back), and follow up only if the move turns out to fail.
function runDuckMove(ev, args) {
  const chip = addAction(TOOL_LABELS[ev.name] ? TOOL_LABELS[ev.name](args) : ev.name);
  if (state.botBubble) state.botBubble.acted = true;
  inspector.note(`🦆 duck starts: ${ev.name}`, args, "tool");
  state.toolOutputs.push({ call_id: ev.call_id, output: { ok: true, status: "started", doing: TOOL_LABELS[ev.name]?.(args) } });
  runTool(body.rl, ev.name, args).then((r) => {
    finishAction(chip, r);
    inspector.note(`🦆 duck finished: ${ev.name} ${r.ok ? "✓" : "✗"}`, r, "tool");
    if (!r.ok) whenIdle(() => {
      send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [
        { type: "input_text", text: `The ${ev.name} move failed: ${r.error}` }] } });
      sayOnly("Tell the user briefly and honestly that the move didn't work. Don't call any tools.");
    });
  });
}

// ---------- Copy me: Simon mirrors your head ------------------------------------------------
// You look to YOUR left, he looks to HIS right, so from where you stand he turns the same way on
// screen, like a reflection. No language model involved: the camera's verdict goes straight to the head.
const MIRROR = { up: "up", down: "down", left: "right", right: "left" };
const copy = { on: false, copied: null };

function copyHead() {
  const seen = ["up", "down", "left", "right"].find((d) => cam.tracker.held(`look_${d}`, 300)) ?? null;
  if (seen === copy.copied) return;
  copy.copied = seen;
  body.lookAt(seen && MIRROR[seen]);
  inspector.note(seen ? `🪞 you look ${seen} → Simon looks to his ${MIRROR[seen]}` : "🪞 you look ahead → Simon too");
}

function setCopy(on) {
  copy.on = on;
  copy.copied = null;
  if (!on) body.lookAt(null);
  $("copy-me").setAttribute("aria-pressed", String(on));
  $("copy-me").textContent = on ? "Copy me: on" : "Copy me: off";
}

// ---------- Wire up the page ---------------------------------------------------------------

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.onclick = () => {
    // Each tablist switches only its own panels.
    for (const t of tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
  };
}

cam.btn.onclick = () => (cam.on ? stopCamera() : startCamera());
$("calibrate").onclick = calibrate;
$("copy-me").onclick = () => setCopy(!copy.on);

// Skates toggle: mirrors the duck's actual state, however it was switched.
const skatesBtn = $("skates");
skatesBtn.onclick = async () => {
  const rl = body.rl;
  if (!rl) return;
  skatesBtn.disabled = true;
  try { await perform(rl, rl.loco === "rollers" ? "skates_off" : "skates_on"); }
  catch (e) { toast(`Skates: ${e.message}`); }
  finally { skatesBtn.disabled = false; }
};
setInterval(() => {
  const on = body.rl?.loco === "rollers";
  skatesBtn.setAttribute("aria-pressed", String(on));
}, 300);

ui.model.onchange = () => { showModelNote(); savePrefs(); };
$("os-change-voice").onclick = () => $("tab-voice").click();
ui.switchModel.onclick = () => { savePrefs(); ui.switchModel.disabled = true; startAgent(ui.model.value, "you switched model"); };
ctx.os = new SimonOS({
  startAgent: (model, why) => { savePrefs(); return startAgent(model, why); },
  stopAgent, selectedModel: () => ui.model.value, toast,
});
new MacOS();

// Duck colour: the simulator's duck and the page's colours follow the same choice (remembered).
function setDuckColour(name) {
  document.documentElement.dataset.duck = name;
  body.colour = name;
  body.setColour(name);
  for (const d of document.querySelectorAll("#duck-colour .dot")) d.setAttribute("aria-checked", String(d.dataset.colour === name));
  try { localStorage.setItem("duck-colour", name); } catch {}
}
{
  let savedColour = "blue";
  try { savedColour = localStorage.getItem("duck-colour") || "blue"; } catch {}
  setDuckColour(savedColour);
  for (const d of document.querySelectorAll("#duck-colour .dot")) d.onclick = () => setDuckColour(d.dataset.colour);
}

ctx.game = makeGame({ beforeGame: () => setCopy(false) });

ui.preset.onchange = () => { ui.instructions.value = PRESETS[ui.preset.value]; savePrefs(); showVoice(); };
ui.apply.onclick = () => {
  savePrefs();
  send(sessionUpdate());
  toast("Personality and voice updated.");
};
// A new voice needs its own lines: forget the old voice's audio (its saved lines load on session.updated).
ui.voice.onchange = () => { lineCache.clear(); saved.voice = null; savePrefs(); send(sessionUpdate()); showVoice(); };
ui.muteWhileSpeaking.onchange = savePrefs;
ui.talk.onclick = () => setMic(!state.micOn);
ui.clearChat.onclick = clearChat;

await loadOptions();
listenToServer({ status: showModelNote, log: appendLog, stage: onStage });
const s = await (await fetch("/api/status")).json();
onAgentStatus(s, showModelNote);
