// What every part of the page shares: the audio format, small helpers, the page's state, and `ctx`,
// the few things that differ between pages. The lab (app.js) and the game page (play.js) each fill in
// ctx at start-up; the modules only ever reach them through it, so a page can leave parts out.

export const RATE = 24000;     // Audio sample rate we ask the agent for, in and out.
export const FRAME = 480;      // 20 ms of audio at 24 kHz.

export const $ = (id) => document.getElementById(id);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const state = {
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
  turn: null,           // timings for the current turn (the lab's relay race)
  warm: false,          // has the agent answered at least once since starting?
  waiters: [],          // resolve functions waiting for a response.done
  toolOutputs: [],      // results to report back once the current response is done
  followUps: 0,         // spoken follow-ups requested after tools, this turn
};

export const ctx = {
  inspector: null,      // the Inspector (both pages)
  body: null,           // Simon's body in the simulator (DuckBody)
  game: null,           // the Simon Says game
  os: null,             // the Simon OS tab
  instructions: () => "",          // Simon's personality
  voice: () => "aiden",            // the voice's name
  muteWhileSpeaking: () => true,   // send silence while Simon speaks (no headphones)
  tools: [],                       // tools offered besides play_simon_says (the lab's duck moves)
  onTool: null,                    // (ev, args) => handles one of those tools
  relay: { newTurn() {}, setStage() {} },   // the lab's relay race (timings); the game page has none
  logPoses: null,                  // () => whether to log "🧍 you: …" rows now (default: always)
  calibrateHint: null,             // under the camera before calibrating (default: "Sit normally, facing the camera")
  onCameraFrame: null,             // the lab's Copy me
  onCameraStop: null,
};

export function toast(msg, ms = 4000) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

export function fmt(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "–";
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
}

export function floatToBase64Pcm16(float32) {
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

export function base64Pcm16ToFloat(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

// During a game only game lines may speak: a chat reply (it has a conversation id; game lines are made
// outside the conversation) is cut. (Liz, 2026-09-26: a chat reply to what she said just before a nod ran
// 14 s over round 1, "Simon says touch your nose!" included, and she lost on the next trap.)
export function hushDuringGame({ conversationId, gameActive, line }) {
  return !!conversationId && !!gameActive && !line;
}
