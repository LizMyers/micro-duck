// Duck Lab: a browser client for Hugging Face's speech-to-speech agent.
//
// The page speaks the OpenAI Realtime protocol over a WebSocket, straight to the agent:
//   we send  → session.update (settings), input_audio_buffer.append (20 ms of mic audio)
//   we get   ← speech_started/stopped, transcripts, response.output_audio.delta (reply audio)
// Timings for each stage come from the lab server, which reads the agent's log.

import { DuckBody } from "/static/duck-body.js";
import { Inspector } from "/static/inspector.js";
import { PoseTracker, POSE_IDS, POSE_LABELS } from "/static/pose.js";
import { TOOLS, runTool, TOOL_LABELS, perform, setTrace } from "/static/duck-tools.js";
import { SimonOS } from "/static/simon-os.js";
import { MacOS } from "/static/mac-os.js";
import { SimonSaysGame } from "/static/simon-says.js";

const RATE = 24000;            // Audio sample rate we ask the agent for, in and out.
const FRAME = 480;             // 20 ms of audio at 24 kHz.

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

// Added to every personality: small models happily *say* "I'm sitting!" without
// actually calling the tool, so we spell out that they have a body to move.
const BODY_RULES =
  "\n\nYou have a small robot duck body you can really move with your tools: " +
  "sit_down, stand_up, step_forward, step_back, turn_left, turn_right, bow, kick_left_leg, " +
  "kick_right_leg, skates_on, skates_off. Whenever someone asks you to move (sit, stand, step, walk, " +
  "turn, spin, bow, kick, lift a leg, skate), you MUST call the matching tool. " +
  "Never just say you are doing it. Keep what you say about it to a few words. " +
  // Small models happily claim to see. Simon can't: the webcam referee runs separately in the page.
  "You cannot see: you have no eyes or camera. A separate camera referee judges the players' moves; " +
  "you only hear what people say. If asked what you can see, say you can't see.";

const $ = (id) => document.getElementById(id);
const ui = {
  model: $("model"), modelNote: $("model-note"), switchModel: $("switch-model"), switchHint: $("switch-hint"),
  voice: $("voice"), preset: $("preset"), instructions: $("instructions"), apply: $("apply"),
  talk: $("talk"), talkLabel: $("talk-label"), muteWhileSpeaking: $("mute-while-speaking"),
  chat: $("chat"), chatEmpty: $("chat-empty"), clearChat: $("clear-chat"),
  total: $("total"), log: $("log"), toast: $("toast"),
};

const inspector = new Inspector($("inspector"));

setTrace((text, detail) => inspector.note(`🦆 ${text}`, detail, "tool"));

const body = new DuckBody({
  iframe: $("sim"), moodEl: $("mood"), whyEl: $("mood-why"),
  beakBar: $("beak-meter"), beakNum: $("beak-num"), headDot: $("head-dot"), headText: $("head-text"),
});

const state = {
  options: null,
  agentStatus: "stopped",
  ws: null,
  audio: null,          // { ctx, micNode, micStream }
  micOn: false,
  testing: false,
  playing: [],          // scheduled reply audio sources
  playhead: 0,          // when the next reply chunk should start (AudioContext time)
  userBubbles: new Map(),
  botBubble: null,
  turn: null,           // timings for the current turn
  warm: false,          // has the agent answered at least once since starting?
  waiters: [],          // resolve functions waiting for a response.done
  toolOutputs: [],      // results to report back once the current response is done
  followUps: 0,         // spoken follow-ups requested after tools, this turn
};

// ---------- Small helpers ----------------------------------------------------------------

function toast(msg, ms = 4000) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (ui.toast.hidden = true), ms);
}

function fmt(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "–";
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
}

function floatToBase64Pcm16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64Pcm16ToFloat(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Lab server: options, agent start/stop, live events ---------------------------

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

async function startAgent(model = ui.model.value, why = "you pressed Start") {
  savePrefs();
  ui.switchModel.disabled = true;
  disconnect();
  const res = await fetch("/api/agent/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, why }),
  });
  if (!res.ok) toast(`Couldn't start the agent: ${(await res.json()).detail}`);
}

async function stopAgent() {
  disconnect();
  await fetch("/api/agent/stop", { method: "POST" });
}

function listenToLab() {
  const es = new EventSource("/api/events");  // reconnects by itself if the lab restarts
  es.onopen = () => os.connected();
  es.onerror = () => os.disconnected();
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "status") onAgentStatus(ev);
    else if (ev.type === "lab") os.onLab(ev);
    else if (ev.type === "log") appendLog(ev.line);
    else if (ev.type === "stage") {
      onStage(ev);
      const { type, stage, t, ...rest } = ev;
      inspector.note(`stage: ${stage}`, rest);
    }
  };
}

function onAgentStatus(ev) {
  const prev = state.agentStatus;
  state.agentStatus = ev.status;
  state.agentModel = ev.model;
  const model = state.options?.models.find((m) => m.id === ev.model);
  const label = model ? model.label : "";
  os.onStatus(ev, label);
  showModelNote();
  setTalkLabel();
  if (ev.status === "error" && ev.error) toast(ev.error, 10000);
  if (ev.status === "ready" && prev !== "ready") {
    state.warm = false;
    connect();
  }
  if (ev.status !== "ready") disconnect();
}

// The model's raw log, made scannable: keep the time and the message, drop the date and the
// long module name (it's in the tooltip), and colour warnings and errors.
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

// ---------- The relay race ----------------------------------------------------------------

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

// ---------- Talking to the agent (Realtime WebSocket) -------------------------------------

function sessionUpdate() {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: ui.instructions.value + BODY_RULES,
      tools: TOOLS,
      tool_choice: "auto",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: RATE },
          turn_detection: { type: "server_vad", interrupt_response: true },
        },
        output: { format: { type: "audio/pcm", rate: RATE }, voice: ui.voice.value },
      },
    },
  };
}

function connect() {
  if (state.ws) return;
  const ws = new WebSocket(state.options.agent_url);
  state.ws = ws;
  ws.onopen = () => {
    inspector.note(`Connected to the agent at ${state.options.agent_url}`);
    const settings = sessionUpdate();
    ws.send(JSON.stringify(settings));
    inspector.message("out", settings);
    ui.talk.disabled = false;
  };
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    inspector.message("in", ev);
    // The model serves one page at a time; a second page is told so, then closed (code 1008).
    if (ev.type === "error" && ev.error?.type === "session_limit_reached") setBusy(true);
    else if (ev.type === "session.created" || ev.type === "session.updated") setBusy(false);
    onAgentEvent(ev);
  };
  ws.onclose = (e) => {
    if (state.ws === ws) state.ws = null;
    ui.talk.disabled = true;
    setMic(false);
    if (e.code === 1008) setBusy(true);
    // If the model is still up (e.g. the socket dropped), try again: slowly while another tab has it.
    if (state.agentStatus === "ready") setTimeout(connect, state.modelBusy ? 5000 : 1500);
  };
}

function disconnect() {
  const ws = state.ws;
  state.ws = null;
  if (ws) ws.close();
  stopPlayback();
}

function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(obj));
    inspector.message("out", obj);
  } else if (obj.type !== "input_audio_buffer.append") {
    inspector.note(`not sent (not connected): ${obj.type}`, obj, "err");
  }
}

function onAgentEvent(ev) {
  switch (ev.type) {
    case "input_audio_buffer.speech_started":
      state.followUps = 0;
      // Barge-in: if you start talking while it's replying, it stops.
      const wasTalking = isPlaying() || (state.botBubble && !state.botBubble.done);
      stopPlayback();
      if (state.botBubble && !state.botBubble.done) finishBotBubble("interrupted");
      if (wasTalking) body.setMood("interrupted", { holdMs: 700, then: "listening" });
      else body.setMood("listening");
      if (!state.turn || state.turn.done) newTurn();
      break;
    case "input_audio_buffer.speech_stopped":
      if (state.turn) state.turn.stoppedAt = performance.now();
      body.setMood("thinking");
      break;
    case "conversation.item.input_audio_transcription.delta":
      userBubble(ev.item_id).text += ev.delta;
      renderUser(ev.item_id);
      break;
    case "conversation.item.input_audio_transcription.completed":
      userBubble(ev.item_id).text = ev.transcript;
      userBubble(ev.item_id).final = true;
      renderUser(ev.item_id);
      state.lastHeard = ev.transcript;
      break;
    case "response.created":
      state.responding = true;
      botBubble();
      break;
    case "response.output_audio_transcript.delta":
      botBubble().text += ev.delta;
      renderBot();
      break;
    case "response.output_audio.delta":
      if (state.turn && !state.turn.firstAudioAt) state.turn.firstAudioAt = performance.now();
      if (state.line) {
        const l = state.line;
        if (l.cut) break;
        l.onAudio(); l.onAudio = () => {};
        const samples = base64Pcm16ToFloat(ev.delta);
        l.chunks.push(samples);
        l.samples += samples.length;
        if (l.samples > l.max * RATE) {   // the voice model ran on: stop it
          l.cut = true;
          send({ type: "response.cancel" });
          inspector.note(`✂️ cut "${l.text}" at ${l.max} s (the voice model ran on)`);
        }
        if (body.mood !== "speaking") body.setMood("speaking");
        playChunk(samples);
        break;
      }
      if (body.mood !== "speaking") body.setMood("speaking");
      playChunk(base64Pcm16ToFloat(ev.delta));
      break;
    case "response.function_call_arguments.done": {
      // The model wants the duck to move. Start the move, tell the model
      // straight away that it has started (the agent won't talk again until it
      // hears back), and follow up only if the move turns out to fail.
      let args = {};
      try { args = JSON.parse(ev.arguments || "{}"); } catch {}
      const chip = addAction(ev.name, args);
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
      break;
    }
    case "response.done": {
      const status = ev.response?.status;
      if (state.line) {
        const l = state.line;
        state.line = null;
        if (!l.improvise && l.chunks.length && (status === "completed" || l.cut)) lineCache.set(l.text, l.chunks);
        l.onDone(status);
      }
      const spoke = !!state.botBubble?.text;
      state.responding = false;
      if (state.toolOutputs.length) {
        for (const o of state.toolOutputs.splice(0)) {
          send({ type: "conversation.item.create",
            item: { type: "function_call_output", call_id: o.call_id, output: JSON.stringify(o.output) } });
        }
        // It acted without saying anything: let it say a few words, once.
        if (status === "completed" && !spoke && state.followUps < 1 && !state.testing) {
          state.followUps++;
          sayOnly("Say a few words about what you just did. Don't call any tools.");
        }
      }
      flushIdle();
      finishBotBubble(status === "cancelled" ? "interrupted" : null);
      if (state.turn) { setStage("voice", "done"); state.turn.done = true; }
      state.warm = true;
      whenQuiet(() => { if (body.mood === "speaking" || body.mood === "thinking") body.setMood("idle"); });
      const waiters = state.waiters.splice(0);
      for (const w of waiters) w(status);
      break;
    }
    case "error": {
      const msg = ev.error?.message || ev.error?.code || "Unknown error";
      if (ev.error?.code === "session_limit_reached") {
        toast("The agent is busy with another tab. Close other Duck Lab tabs and reload.", 8000);
      } else {
        toast(`Agent error: ${msg}`);
      }
      break;
    }
  }
}

// ---------- Chat bubbles ------------------------------------------------------------------

function addBubble(cls) {
  ui.chatEmpty.hidden = true;
  const el = document.createElement("div");
  el.className = `bubble ${cls}`;
  ui.chat.append(el);
  return el;
}

function addAction(name, args) {
  const el = addBubble("action pending");
  el.textContent = `🦆 ${TOOL_LABELS[name] ? TOOL_LABELS[name](args) : name}…`;
  ui.chat.scrollTop = ui.chat.scrollHeight;
  return el;
}

function finishAction(el, r) {
  el.classList.remove("pending");
  const facts = [];
  if (r.moved_cm !== undefined) facts.push(`moved ${Math.abs(r.moved_cm)} cm`);
  if (r.turned_degrees !== undefined) facts.push(`turned ${Math.abs(r.turned_degrees)}°`);
  el.textContent = el.textContent.replace(/…$/, "") +
    (r.ok ? ` ✓${facts.length ? ` (${facts.join(", ")})` : ""}` : ` ✗ ${r.error}`);
  el.classList.toggle("failed", !r.ok);
}

// Ask for a spoken reply that can't trigger another move.
function sayOnly(instructions) {
  send({ type: "response.create", response: { tool_choice: "none", instructions: ui.instructions.value + "\n\n" + instructions } });
}

// Simon Says lines. Simon speaks an exact line, out-of-band (conversation "none"), so game lines never
// grow his conversation history. Each line's audio is kept the first time, so repeats play instantly
// with no model involved. Two guards, from the logs:
// - the model sometimes *answered* a line instead of repeating it ("Look up!" -> "Sure, here's my
//   best look up."), so the request shows it two examples of repeating word for word;
// - the voice model sometimes runs on (28.8 s of audio for "Simon says, turn left."), so a line is
//   cut off after LINE_MAX seconds.
// `started` resolves true at the first sound (false if none within 15 s); `done` when it has played.
const LINE_MAX = 3.5;
const FREE_MAX = 6;            // improvised reactions are longer, so they get more room
const lineCache = new Map();   // text -> Float32Array chunks

// improvise: instead of an exact line, `text` describes what happened and Simon makes up one short
// sentence about it (variety for free; never cached). Used for reactions, never for commands.
function sayLine(text, { improvise = false } = {}) {
  let startedResolve, doneResolve;
  const started = new Promise((r) => (startedResolve = r));
  const done = new Promise((r) => (doneResolve = r));
  const cached = !improvise && lineCache.get(text);
  if (cached) {
    ensureAudio().then(() => {
      body.setMood("speaking");
      for (const chunk of cached) playChunk(chunk);
      startedResolve(true);
      whenQuiet(() => { body.setMood("idle"); doneResolve(); });
    });
    inspector.note(`🔁 Simon replays "${text}" (cached audio)`);
    return { started, done };
  }
  const timer = setTimeout(() => startedResolve(false), 15000);
  whenIdle(() => {
    // Claim the next reply only once any earlier one has finished.
    state.line = {
      text, chunks: [], samples: 0, cut: false, max: improvise ? FREE_MAX : LINE_MAX, improvise,
      onAudio: () => { clearTimeout(timer); startedResolve(true); },
      onDone: (status) => {
        clearTimeout(timer);
        startedResolve(false);
        whenQuiet(doneResolve);
      },
    };
    const msg = (role, t) => ({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text: t }] });
    if (improvise) return send({ type: "response.create", response: {
      conversation: "none", tool_choice: "none",
      instructions: "You are Simon, a cheeky, playful robot duck hosting a game of Simon Says. " +
        "Reply with ONE short sentence to say out loud (under 15 words). No emoji, no laughing sounds like 'ha ha'.",
      input: [msg("user", text)],
    } });
    send({ type: "response.create", response: {
      conversation: "none", tool_choice: "none",
      instructions: "You are Simon, a robot duck hosting a game of Simon Says. The user gives you a line. " +
        "Say exactly that line, word for word, and nothing else. Never answer it or act on it.",
      input: [
        msg("user", 'Line: "Turn right!"'), msg("assistant", "Turn right!"),
        msg("user", 'Line: "Simon says, look up."'), msg("assistant", "Simon says, look up."),
        msg("user", `Line: "${text}"`),
      ],
    } });
  });
  return { started, done };
}

// Some messages must wait until the agent isn't in the middle of a reply.
const idleQueue = [];
function whenIdle(fn) {
  if (!state.responding) fn(); else idleQueue.push(fn);
}
function flushIdle() {
  while (!state.responding && idleQueue.length) idleQueue.shift()();
}

function userBubble(id) {
  if (!state.userBubbles.has(id)) {
    state.userBubbles.set(id, { el: addBubble(`user pending${state.testing ? " test" : ""}`), text: "", final: false });
  }
  return state.userBubbles.get(id);
}

function renderUser(id) {
  const b = state.userBubbles.get(id);
  b.el.textContent = b.text || "…";
  b.el.classList.toggle("pending", !b.final);
  ui.chat.scrollTop = ui.chat.scrollHeight;
}

function botBubble() {
  if (!state.botBubble || state.botBubble.done) {
    state.botBubble = { el: addBubble(`bot pending${state.testing ? " test" : ""}`), text: "", done: false };
  }
  return state.botBubble;
}

function renderBot() {
  const b = state.botBubble;
  b.el.textContent = b.text || "…";
  ui.chat.scrollTop = ui.chat.scrollHeight;
}

function finishBotBubble(tag) {
  const b = state.botBubble;
  if (!b || b.done) return;
  b.done = true;
  b.el.classList.remove("pending");
  if (!b.text) {
    if (b.acted) { b.el.remove(); state.botBubble = null; return; }
    b.el.textContent = "(no reply)";
  }
  if (tag) {
    const t = document.createElement("span");
    t.className = "tag";
    t.textContent = tag === "interrupted" ? "✋ interrupted" : tag;
    b.el.append(t);
  }
  state.lastReply = b.text;
}

// ---------- Audio: microphone in, reply out -----------------------------------------------

async function ensureAudio() {
  if (state.audio) return state.audio;
  const ctx = new AudioContext({ sampleRate: RATE });
  await ctx.audioWorklet.addModule("/static/capture-worklet.js");
  state.audio = { ctx, micNode: null, micStream: null };
  return state.audio;
}

async function ensureMic() {
  const audio = await ensureAudio();
  if (audio.micNode) return audio;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const src = audio.ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audio.ctx, "capture");
  node.port.onmessage = (e) => {
    if (!state.micOn || state.testing) return;
    // Without headphones the mic hears the reply and thinks you're interrupting.
    // Sending silence instead keeps the agent's clock ticking without the echo.
    const quiet = ui.muteWhileSpeaking.checked && isPlaying();
    if (quiet !== state.micMuted) {
      state.micMuted = quiet;
      inspector.note(quiet ? "🔇 mic muted while the duck speaks (sending silence)" : "🎙 mic live again");
    }
    send({ type: "input_audio_buffer.append", audio: floatToBase64Pcm16(quiet ? new Float32Array(FRAME) : e.data) });
  };
  src.connect(node);
  audio.micNode = node;
  audio.micStream = stream;
  return audio;
}

async function setMic(on) {
  if (on) {
    try {
      const audio = await ensureMic();
      await audio.ctx.resume();
    } catch (err) {
      toast("Couldn't use the microphone. Allow microphone access for this page in Chrome's address bar.");
      return;
    }
  }
  state.micOn = on;
  ui.talk.setAttribute("aria-pressed", String(on));
  setTalkLabel();
}

function setBusy(busy) {
  if (state.modelBusy === busy) return;
  state.modelBusy = busy;
  inspector.note(busy ? "Model busy: another Duck Lab tab is connected to it" : "Connected to the model", null, busy ? "err" : undefined);
  os.setBusy(busy);
  setTalkLabel();
}

// The talk button says why it's disabled, so the status is visible from every tab.
function setTalkLabel() {
  ui.talkLabel.textContent = state.micOn ? "Listening… tap to stop"
    : state.agentStatus === "ready" && state.modelBusy ? "Model busy: close other Duck Lab tabs"
    : state.agentStatus === "ready" ? "Tap to talk"
    : state.agentStatus === "starting" ? "Model loading…"
    : state.agentStatus === "error" ? "Model crashed"
    : "Model stopped";
}

function isPlaying() {
  return state.audio && state.playhead > state.audio.ctx.currentTime;
}

// Run fn once the reply has finished playing.
function whenQuiet(fn) {
  if (!isPlaying()) return fn();
  setTimeout(() => whenQuiet(fn), 100);
}

function playChunk(samples) {
  const { ctx } = state.audio || {};
  if (!ctx) return;
  const buf = ctx.createBuffer(1, samples.length, RATE);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(body.attachAudio(ctx));
  // A small cushion (60 ms) on the first chunk so playback doesn't stutter.
  const startAt = Math.max(state.playhead, ctx.currentTime + 0.06);
  src.start(startAt);
  state.playhead = startAt + buf.duration;
  state.playing.push(src);
  src.onended = () => { state.playing = state.playing.filter((s) => s !== src); };
}

function stopPlayback() {
  for (const s of state.playing) { try { s.stop(); } catch {} }
  state.playing = [];
  if (state.audio) state.playhead = state.audio.ctx.currentTime;
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

// ---------- Webcam referee (pose tracking runs entirely in this browser) ----------
const cam = {
  tracker: null, on: false, held: new Set(), copy: false, copied: null,
  btn: $("camera"), pip: $("cam-pip"), chips: $("pose-chips"), status: $("cam-status"),
};
for (const id of POSE_IDS) {
  const li = document.createElement("li");
  li.dataset.pose = id;
  // Each chip shows the live measurement next to its name, so thresholds can be tuned on a real person.
  li.innerHTML = `${POSE_LABELS[id]} <span class="num">–</span>`;
  cam.chips.append(li);
}

async function startCamera() {
  cam.pip.hidden = false;
  cam.chips.hidden = false;
  cam.status.textContent = "Starting camera… (allow access)";
  cam.tracker ??= new PoseTracker();
  try {
    await cam.tracker.start($("cam-video"), $("cam-canvas"));
  } catch (e) {
    cam.status.textContent = cam.tracker.error || "Camera failed";
    inspector.note(`📷 camera failed: ${cam.tracker.error || e.message}`, null, "err");
    return;
  }
  cam.on = true;
  cam.btn.setAttribute("aria-pressed", "true");
  inspector.note("📷 camera on (video stays in this browser)");
  cam.status.textContent = "Stand normally, then Calibrate";
  // Calibrate automatically once a body is in view: every check compares you with this stance.
  setTimeout(() => { if (cam.on && !cam.calibrated) calibrate(); }, 2500);
  cam.unsubscribe = cam.tracker.onFrame(({ poses }) => {
    for (const li of cam.chips.children) {
      const id = li.dataset.pose;
      const p = poses[id];
      li.querySelector(".num").textContent = p.value == null ? "–" : p.value.toFixed(2);
      li.title = `${POSE_LABELS[id]}: ${p.reason}`;
      const on = cam.tracker.held(id, 300);
      li.classList.toggle("on", on);
      if (on && !cam.held.has(id)) { cam.held.add(id); inspector.note(`🧍 you: ${POSE_LABELS[id]}`); }
      if (!on) cam.held.delete(id);
    }
    if (cam.calibrated) cam.status.textContent = `${Math.round(cam.tracker.fps || 0)} fps · watching`;
    if (cam.copy) copyHead();
  });
}

// Copy me: Simon mirrors your head. You look to YOUR left, he looks to HIS right, so from where
// you stand he turns the same way on screen, like a reflection. No language model involved:
// the camera's verdict goes straight to the head.
const MIRROR = { up: "up", down: "down", left: "right", right: "left" };

function copyHead() {
  const seen = ["up", "down", "left", "right"].find((d) => cam.tracker.held(`look_${d}`, 300)) ?? null;
  if (seen === cam.copied) return;
  cam.copied = seen;
  body.lookAt(seen && MIRROR[seen]);
  inspector.note(seen ? `🪞 you look ${seen} → Simon looks to his ${MIRROR[seen]}` : "🪞 you look ahead → Simon too");
}

function setCopy(on) {
  cam.copy = on;
  cam.copied = null;
  if (!on) body.lookAt(null);
  $("copy-me").setAttribute("aria-pressed", String(on));
  $("copy-me").textContent = on ? "Copy me: on" : "Copy me: off";
}

function stopCamera() {
  cam.unsubscribe?.();
  cam.tracker?.stop();
  cam.on = false;
  cam.calibrated = false;
  setCopy(false);
  cam.pip.hidden = true;
  cam.chips.hidden = true;
  cam.btn.setAttribute("aria-pressed", "false");
  inspector.note("📷 camera off");
}

function calibrate() {
  const base = cam.tracker?.calibrate();
  cam.calibrated = !!base;
  cam.status.textContent = base ? "Calibrated ✓" : "Can't see you: step back so head and shoulders show";
  inspector.note(base ? "📷 calibrated to your normal stance" : "📷 calibration failed (no body in view)", base);
}

cam.btn.onclick = () => (cam.on ? stopCamera() : startCamera());
$("calibrate").onclick = calibrate;
$("copy-me").onclick = () => setCopy(!cam.copy);

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
function showVoice() {
  $("os-voice").textContent = `${ui.voice.selectedOptions[0]?.text || "–"} · personality: ${ui.preset.value}`;
}
$("os-change-voice").onclick = () => $("tab-voice").click();
ui.switchModel.onclick = () => startAgent(ui.model.value, "you switched model");
const os = new SimonOS({ startAgent, stopAgent, selectedModel: () => ui.model.value, toast });
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
  let saved = "blue";
  try { saved = localStorage.getItem("duck-colour") || "blue"; } catch {}
  setDuckColour(saved);
  for (const d of document.querySelectorAll("#duck-colour .dot")) d.onclick = () => setDuckColour(d.dataset.colour);
}
new SimonSaysGame({
  tracker: () => cam.tracker,
  ready: () => state.agentStatus !== "ready" || state.modelBusy ? "Waiting for the model: STATUS must be READY." : null,
  // Starting a game turns the camera on and calibrates it (it calibrates itself 2.5 s after starting).
  prepare: async () => {
    await ensureAudio(); await state.audio.ctx.resume(); await setMic(false); setCopy(false);
    if (!cam.on) await startCamera();
    for (let t = 0; t < 8000 && cam.on && !cam.calibrated; t += 200) await sleep(200);
    if (!cam.calibrated) calibrate();
    return cam.calibrated ? null : "The camera can't see you: sit where your head and shoulders are in view, then start again.";
  },
  sayLine,
  lookAt: (dir) => body.lookAt(dir),
  // Simon celebrates winning: a happy head bob (up, down, up) while he gloats.
  celebrate: () => ["up", "down", "up", null].forEach((d, i) => setTimeout(() => body.lookAt(d), i * 350)),
  note: (text, data) => inspector.note(text, data),
});
ui.preset.onchange = () => { ui.instructions.value = PRESETS[ui.preset.value]; savePrefs(); showVoice(); };
ui.apply.onclick = () => {
  savePrefs();
  send(sessionUpdate());
  toast("Personality and voice updated.");
};
ui.voice.onchange = () => { savePrefs(); send(sessionUpdate()); showVoice(); };
ui.muteWhileSpeaking.onchange = savePrefs;
ui.talk.onclick = () => setMic(!state.micOn);
ui.clearChat.onclick = () => {
  ui.chat.querySelectorAll(".bubble").forEach((b) => b.remove());
  state.userBubbles.clear();
  state.botBubble = null;
  ui.chatEmpty.hidden = false;
};

await loadOptions();
listenToLab();
const s = await (await fetch("/api/status")).json();
onAgentStatus(s);
