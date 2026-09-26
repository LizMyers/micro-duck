// Audio: microphone in (20 ms frames to the agent), Simon's voice out (scheduled so it never stutters),
// and the Tap to talk button.

import { RATE, FRAME, $, state, ctx, toast, floatToBase64Pcm16 } from "/static/core.js";
import { send } from "/static/agent.js";

export async function ensureAudio() {
  if (state.audio) return state.audio;
  const ac = new AudioContext({ sampleRate: RATE });
  await ac.audioWorklet.addModule("/static/capture-worklet.js");
  state.audio = { ctx: ac, micNode: null, micStream: null };
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
    const quiet = ctx.muteWhileSpeaking() && isPlaying();
    if (quiet !== state.micMuted) {
      state.micMuted = quiet;
      ctx.inspector.note(quiet ? "🔇 mic muted while the duck speaks (sending silence)" : "🎙 mic live again");
    }
    // Hold to talk: after you let go, a moment of silence goes out so the agent hears you've finished.
    const silent = quiet || state.trailingSilence;
    send({ type: "input_audio_buffer.append", audio: floatToBase64Pcm16(silent ? new Float32Array(FRAME) : e.data) });
  };
  src.connect(node);
  audio.micNode = node;
  audio.micStream = stream;
  return audio;
}

export async function setMic(on) {
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
  $("talk")?.setAttribute("aria-pressed", String(on));
  setTalkLabel();
}

// Hold to talk (the game page's space bar): the agent decides you've finished by hearing a pause after
// you, so switching the mic straight off would leave it waiting. Send `ms` of silence first, then stop.
let releaseTimer = null;
export function releaseMicAfterSilence(ms = 1000) {
  clearTimeout(releaseTimer);
  state.trailingSilence = true;
  releaseTimer = setTimeout(() => { state.trailingSilence = false; setMic(false); }, ms);
}
export function cancelMicRelease() {
  clearTimeout(releaseTimer);
  state.trailingSilence = false;
}

// The talk button says why it's disabled, so the status is visible from every tab. Each page can word
// these its own way (ctx.talkLabels): the lab talks about "the model", the game page about Simon.
const TALK_LABELS = {
  listening: "Listening… tap to stop", holding: "Listening… let go when done", ready: "Tap to talk",
  busy: "Model busy: close other Duck Lab tabs", starting: "Model loading…", error: "Model crashed", stopped: "Model stopped",
};
export function setTalkLabel() {
  const label = $("talk-label");
  if (!label) return;
  const key = state.micOn ? (state.holdToTalk ? "holding" : "listening")
    : state.agentStatus === "ready" && state.modelBusy ? "busy"
    : state.agentStatus === "ready" ? "ready"
    : state.agentStatus === "starting" ? "starting"
    : state.agentStatus === "error" ? "error"
    : "stopped";
  label.textContent = ctx.talkLabels?.[key] ?? TALK_LABELS[key];
}

export function isPlaying() {
  return state.audio && state.playhead > state.audio.ctx.currentTime;
}

// Run fn once the reply has finished playing.
export function whenQuiet(fn) {
  if (!isPlaying()) return fn();
  setTimeout(() => whenQuiet(fn), 100);
}

export function playChunk(samples) {
  const { ctx: ac } = state.audio || {};
  if (!ac) return;
  const buf = ac.createBuffer(1, samples.length, RATE);
  buf.copyToChannel(samples, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.body.attachAudio(ac));
  // A small cushion (60 ms) on the first chunk so playback doesn't stutter.
  const startAt = Math.max(state.playhead, ac.currentTime + 0.06);
  src.start(startAt);
  state.playhead = startAt + buf.duration;
  state.playing.push(src);
  src.onended = () => { state.playing = state.playing.filter((s) => s !== src); };
}

export function stopPlayback() {
  for (const s of state.playing) { try { s.stop(); } catch {} }
  state.playing = [];
  if (state.audio) state.playhead = state.audio.ctx.currentTime;
}
