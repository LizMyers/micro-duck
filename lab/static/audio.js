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
    send({ type: "input_audio_buffer.append", audio: floatToBase64Pcm16(quiet ? new Float32Array(FRAME) : e.data) });
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

// The talk button says why it's disabled, so the status is visible from every tab.
export function setTalkLabel() {
  const label = $("talk-label");
  if (!label) return;
  label.textContent = state.micOn ? "Listening… tap to stop"
    : state.agentStatus === "ready" && state.modelBusy ? "Model busy: close other Duck Lab tabs"
    : state.agentStatus === "ready" ? "Tap to talk"
    : state.agentStatus === "starting" ? "Model loading…"
    : state.agentStatus === "error" ? "Model crashed"
    : "Model stopped";
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
