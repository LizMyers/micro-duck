// Duck Lab: a browser client for Hugging Face's speech-to-speech agent.
//
// The page speaks the OpenAI Realtime protocol over a WebSocket, straight to the agent:
//   we send  → session.update (settings), input_audio_buffer.append (20 ms of mic audio)
//   we get   ← speech_started/stopped, transcripts, response.output_audio.delta (reply audio)
// Timings for each stage come from the lab server, which reads the agent's log.

import { DuckBody } from "/static/duck-body.js";
import { Inspector } from "/static/inspector.js";
import { TOOLS, runTool, TOOL_LABELS, perform, setTrace } from "/static/duck-tools.js";

const RATE = 24000;            // Audio sample rate we ask the agent for, in and out.
const FRAME = 480;             // 20 ms of audio at 24 kHz.

const PRESETS = {
  "Helpful & brief":
    "You are a friendly voice assistant. Answer in one or two short sentences. " +
    "Never use lists, markdown or emoji; everything you write will be spoken aloud.",
  "Chatty":
    "You are a warm, curious voice assistant who enjoys a chat. Answer in three or four sentences " +
    "and ask a follow-up question. No lists, markdown or emoji.",
  "A duck":
    "You are Microduck, a small, cheerful robot duck. You are curious, a little mischievous, " +
    "and easily delighted. Keep replies to one short sentence. No lists, markdown or emoji.",
};

// Added to every personality: small models happily *say* "I'm sitting!" without
// actually calling the tool, so we spell out that they have a body to move.
const BODY_RULES =
  "\n\nYou have a small robot duck body you can really move with your tools: " +
  "sit_down, stand_up, step_forward, step_back, turn_left, turn_right, bow, kick_left_leg, " +
  "kick_right_leg, skates_on, skates_off. Whenever someone asks you to move (sit, stand, step, walk, " +
  "turn, spin, bow, kick, lift a leg, skate), you MUST call the matching tool. " +
  "Never just say you are doing it. Keep what you say about it to a few words.";

const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"), statusText: $("status-text"),
  model: $("model"), modelNote: $("model-note"), start: $("start"), stop: $("stop"),
  voice: $("voice"), preset: $("preset"), instructions: $("instructions"), apply: $("apply"),
  talk: $("talk"), talkLabel: $("talk-label"), muteWhileSpeaking: $("mute-while-speaking"),
  chat: $("chat"), chatEmpty: $("chat-empty"), clearChat: $("clear-chat"),
  runTests: $("run-tests"), results: $("results"),
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
  showModelNote();
}

function showModelNote() {
  const m = state.options.models.find((x) => x.id === ui.model.value);
  if (!m) return;
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

async function startAgent() {
  savePrefs();
  ui.start.disabled = true;
  disconnect();
  const res = await fetch("/api/agent/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ui.model.value }),
  });
  if (!res.ok) toast(`Couldn't start the agent: ${(await res.json()).detail}`);
}

async function stopAgent() {
  disconnect();
  await fetch("/api/agent/stop", { method: "POST" });
}

function listenToLab() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "status") onAgentStatus(ev);
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
  ui.status.dataset.state = ev.status;
  const model = state.options?.models.find((m) => m.id === ev.model);
  const label = model ? model.label : "";
  ui.statusText.textContent = {
    stopped: "Agent stopped",
    starting: `Starting ${label}… (loading models)`,
    ready: `Ready · ${label}`,
    error: "Agent crashed",
  }[ev.status];
  ui.start.textContent = ev.status === "stopped" || ev.status === "error" ? "Start agent" : "Restart with this model";
  ui.start.disabled = ev.status === "starting";
  ui.stop.disabled = ev.status === "stopped";
  if (ev.status === "error" && ev.error) toast(ev.error, 10000);
  if (ev.status === "ready" && prev !== "ready") {
    state.warm = false;
    connect();
  }
  if (ev.status !== "ready") disconnect();
}

function appendLog(line) {
  const atBottom = ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 20;
  ui.log.textContent += line.replace(/^\d{4}-\d\d-\d\d /, "") + "\n";
  if (ui.log.textContent.length > 60000) ui.log.textContent = ui.log.textContent.slice(-40000);
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
    ui.runTests.disabled = false;
  };
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    inspector.message("in", ev);
    onAgentEvent(ev);
  };
  ws.onclose = () => {
    if (state.ws === ws) state.ws = null;
    ui.talk.disabled = true;
    ui.runTests.disabled = true;
    setMic(false);
    // If the agent is still up (e.g. the socket dropped), try again shortly.
    if (state.agentStatus === "ready") setTimeout(connect, 1500);
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
            { type: "input_text", text: `The ${ev.name} move failed: ${r.error} Tell the user briefly and honestly.` }] } });
          send({ type: "response.create" });
        });
      });
      break;
    }
    case "response.done": {
      const status = ev.response?.status;
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
          send({ type: "response.create" });
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
  ui.talkLabel.textContent = on ? "Listening… tap to stop" : "Tap to talk";
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

// ---------- Test questions ----------------------------------------------------------------

function waitForResponse(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    state.waiters.push((status) => { clearTimeout(timer); resolve(status); });
  });
}

// Plays a recorded question out loud *and* streams the same audio to the agent,
// at real-time speed, as if someone were saying it into the mic.
async function speakInto(url) {
  const { ctx } = await ensureAudio();
  await ctx.resume();
  const data = await (await fetch(url)).arrayBuffer();
  const buf = await ctx.decodeAudioData(data);
  const samples = buf.getChannelData(0);
  const player = ctx.createBufferSource();
  player.buffer = buf;
  player.connect(ctx.destination);
  player.start();
  const started = performance.now();
  for (let i = 0, n = 0; i < samples.length; i += FRAME, n++) {
    const frame = new Float32Array(FRAME);
    frame.set(samples.subarray(i, i + FRAME));
    send({ type: "input_audio_buffer.append", audio: floatToBase64Pcm16(frame) });
    const due = started + (n + 1) * 20;
    await sleep(Math.max(0, due - performance.now()));
  }
  // Trailing silence so the agent notices the question has ended.
  for (let n = 0; n < 75; n++) {
    send({ type: "input_audio_buffer.append", audio: floatToBase64Pcm16(new Float32Array(FRAME)) });
    await sleep(20);
  }
}

function words(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
}

function heardMark(asked, heard) {
  const a = words(asked), h = new Set(words(heard));
  const hit = a.filter((w) => h.has(w)).length / Math.max(1, a.length);
  if (hit === 1 && words(heard).length === a.length) return ["ok", "✓"];
  if (hit >= 0.7) return ["meh", "~"];
  return ["bad", "✗"];
}

async function runTests() {
  if (state.testing) return;
  const wasMicOn = state.micOn;
  await setMic(false);
  state.testing = true;
  ui.runTests.disabled = true;
  ui.talk.disabled = true;
  ui.results.hidden = false;
  const tbody = ui.results.querySelector("tbody");
  tbody.innerHTML = "";

  for (const [i, test] of state.options.tests.entries()) {
    const row = tbody.insertRow();
    row.innerHTML = `<td class="num">${i + 1}</td><td>${test.text}</td><td>…</td><td></td><td class="num"></td>`;
    const cold = !state.warm;
    state.lastHeard = "";
    state.lastReply = "";
    const done = waitForResponse(45000);
    await speakInto(test.url);
    const status = await done;
    // Let the reply finish playing before asking the next question.
    while (isPlaying()) await sleep(100);
    const total = state.turn?.log.total_s;
    const [cls, sym] = heardMark(test.text, state.lastHeard);
    row.cells[2].innerHTML = `<span class="mark ${cls}">${sym}</span>${state.lastHeard || "<em>nothing</em>"}`;
    row.cells[3].textContent = status === "timeout" ? "(timed out)" : state.lastReply;
    row.cells[4].textContent = fmt(total) + (cold ? " ❄" : "");
    await sleep(800);
  }

  state.testing = false;
  ui.runTests.disabled = false;
  ui.talk.disabled = false;
  if (wasMicOn) setMic(true);
}

// ---------- Wire up the page ---------------------------------------------------------------

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('[role="tab"]')) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
  };
}

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
ui.start.onclick = startAgent;
ui.stop.onclick = stopAgent;
ui.preset.onchange = () => { ui.instructions.value = PRESETS[ui.preset.value]; savePrefs(); };
ui.apply.onclick = () => {
  savePrefs();
  send(sessionUpdate());
  toast("Personality and voice updated.");
};
ui.voice.onchange = () => { savePrefs(); send(sessionUpdate()); };
ui.muteWhileSpeaking.onchange = savePrefs;
ui.talk.onclick = () => setMic(!state.micOn);
ui.runTests.onclick = runTests;
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
