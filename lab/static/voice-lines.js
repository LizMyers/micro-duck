// Voice lines: how Simon says the game's lines, and checks what actually came out.
//
// A line is spoken out-of-band (conversation "none"), so game lines never grow his conversation history.
// Each fixed line's audio is kept the first time and saved to disk (lab/lines/<voice>/), so repeats play
// instantly with no model involved. What can go wrong, from the logs, and the guard for each:
// - the model *answers* a line instead of repeating it ("Look up!" -> "Sure, here's my best look up."):
//   the request shows it two examples of repeating word for word;
// - the voice model runs on (28.8 s for "Simon says, turn left."): cut at a length set by the words;
// - it mumbles (5.6 s of flat hum, never loud): stopped after 1 s;
// - it says a few words and goes silent (the transcript still shows them all): never saved.
// The voice model makes the same audio for the same sentence every time, so a wording that goes wrong
// goes on an avoid list (bad.json) and the game uses another. Why: notes/03-saved-voice-lines.md,
// notes/04-who-goes-first.md.

import { RATE, state, ctx, sleep, base64Pcm16ToFloat } from "/static/core.js";
import { send, whenIdle, sessionUpdate } from "/static/agent.js";
import { ensureAudio, playChunk, whenQuiet, stopPlayback } from "/static/audio.js";
import { waitingForReply } from "/static/turn-taking.js";

// `started` resolves true at the first sound (false if none within 15 s); `done` when it has played.
const LINE_MAX = 3.5;
const FREE_MAX = 7;            // made-up lines are under 10 words (~4 s); a 13-word one ran on to 10 s
export const lineCache = new Map();   // text -> Float32Array chunks

// improvise: instead of an exact line, `text` describes what happened and Simon makes up one short
// sentence about it (variety for free; never cached). Used for reactions, never for commands.
// silent: make the audio and cache it without playing it (pre-warming, below).
export function sayLine(text, { improvise = false, silent = false } = {}) {
  let startedResolve, doneResolve;
  const started = new Promise((r) => (startedResolve = r));
  const done = new Promise((r) => (doneResolve = r));
  const cached = !improvise && lineCache.get(text);
  if (cached) {
    // Wait for any reply still in progress, so two lines never play on top of each other.
    whenIdle(() => ensureAudio().then(() => {
      ctx.body.setMood("speaking");
      for (const chunk of cached) playChunk(chunk);
      startedResolve(true);
      whenQuiet(() => { ctx.body.setMood("idle"); doneResolve(); });
    }));
    ctx.inspector.note(`🔁 Simon replays "${text}" (cached audio)`);
    noteSilence({ text, chunks: cached });   // a bad saved take stays bad: say so each time
    return { started, done };
  }
  // No sound yet? Give up (8 s for improvised lines, 15 s for exact ones) and cancel the reply, so a
  // runaway can't hold everything up. (Seen: "dramatic, over-the-top" made the model write "Ohhhh…"
  // for 27 s before any audio.)
  let mine = null;
  const timer = setTimeout(() => {
    if (mine && state.line === mine) { mine.cut = true; send({ type: "response.cancel" }); ctx.inspector.note(`⏱ gave up on "${text}" (no sound yet)`); }
    startedResolve(false);
  }, improvise ? 8000 : 15000);
  whenIdle(() => {
    // Claim the next reply only once any earlier one has finished.
    state.line = mine = {
      text, chunks: [], samples: 0, cut: false, silent, heard: "", max: improvise ? FREE_MAX : Math.max(LINE_MAX, text.split(/\s+/).length * 0.9), improvise,   // ~2x a normal pace: never cuts real words, still catches a run-on
      onAudio: () => { clearTimeout(timer); startedResolve(true); },
      onDone: (status) => {
        clearTimeout(timer);
        startedResolve(false);
        whenQuiet(() => doneResolve(mine.mumbled ? "" : mine.heard));   // `done` gives the words he said (none if he mumbled)
      },
    };
    const msg = (role, t) => ({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text: t }] });
    if (improvise) return send({ type: "response.create", response: {
      conversation: "none", tool_choice: "none", max_output_tokens: 40,   // a hard stop for runaway text
      instructions: "You are Simon, a cheeky, playful robot duck hosting a game of Simon Says. " +
        "Reply with ONE short sentence to say out loud (under 10 words). No emoji, no laughing sounds like 'ha ha', never the word quack (your real quacks are played as sounds). " +
        "Plain words and ordinary punctuation only: no dashes, ellipses or symbols. " +
        "Speak as yourself: say I and me, never Simon or the duck (Liz: no third person).",
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

// A chunk of a line's audio arrived: keep it, check it (run-on, mumble), and play it unless it's silent.
export function onLineAudio(l, delta) {
  if (l.cut) return;
  l.onAudio(); l.onAudio = () => {};
  const samples = base64Pcm16ToFloat(delta);
  l.chunks.push(samples);
  l.samples += samples.length;
  const said = l.improvise ? l.heard || "(made-up line)" : l.text;   // improvised: l.text is the prompt, not the words
  if (l.samples > l.max * RATE) {   // the voice model ran on: stop it
    l.cut = true;
    send({ type: "response.cancel" });
    ctx.inspector.note(`✂️ page: cut "${said}" at ${l.max.toFixed(1)} s: the voice model ran on`, null, "warn");
    markBad(l, "ran on");
  } else if (!l.loudChecked && l.samples >= MUMBLE_CHECK_S * RATE) {
    // Real speech gets loud within the first second; a mumble never does (6–1 score line: 5.6 s of
    // flat hum, never above a fifth of a normal line's loudness). Catch it now, not at the run-on cutter.
    l.loudChecked = true;
    const peak = peakLoudness(l.chunks);
    if (peak < MUMBLE_PEAK) {
      l.cut = l.mumbled = true;
      send({ type: "response.cancel" });
      if (!l.silent) stopPlayback();
      ctx.inspector.note(`🔇 page: mumble: "${said}" never got loud in ${MUMBLE_CHECK_S} s (peak ${peak.toFixed(3)}, ` +
        `speech is above ${MUMBLE_PEAK}), so I stopped it` + (l.improvise ? "" : " and won't use this wording again"), null, "warn");
      markBad(l, "mumbled");
      return;
    }
  }
  if (l.silent) return;   // pre-warming: keep the audio, don't play it
  if (ctx.body.mood !== "speaking") ctx.body.setMood("speaking");
  playChunk(samples);
}

// The line's reply is over: keep the take if it's good (cache + disk), and let the game carry on.
export function finishLine(l, status) {
  const wentQuiet = l.chunks.length > 0 && noteSilence(l);
  const keep = !l.improvise && l.chunks.length && status === "completed" && !l.cut   // a cut take ran on or mumbled
    && (!l.silent || sameWords(l.heard, l.text))   // nobody hears a pre-warmed line, so check it
    && !wentQuiet;   // a take that goes silent would stay silent every time it replays
  if (wentQuiet) markBad(l, "went silent");
  if (!l.improvise && (l.cut || wentQuiet)) ctx.inspector.note(`💾 page: not saved "${l.text}": it ${l.mumbled ? "mumbled" : wentQuiet ? "went silent" : "ran on"}`, null, "warn");
  if (keep) { lineCache.set(l.text, l.chunks); saveLine(l.text, l.chunks, l.cut); }
  else if (l.silent) ctx.inspector.note(`🔥 not kept: asked for "${l.text}", Simon said "${l.heard}"`);
  l.onDone(status);
}

// Where the sound stops: the voice model sometimes says a few words and then pads with silence.
function noteSilence(l) {
  const all = l.chunks.length === 1 ? l.chunks[0] : Float32Array.from(l.chunks.flatMap((c) => [...c]));
  const win = RATE / 20;   // 50 ms
  let end = 0;
  for (let i = all.length - win; i >= 0; i -= win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += all[j] * all[j];
    if (Math.sqrt(sum / win) > 0.01) { end = i + win; break; }
  }
  const total = all.length / RATE, sound = end / RATE;
  if (total - sound > 1.5) {
    const said = l.improvise ? l.heard : l.text;
    ctx.inspector.note(`🔇 page: "${said}": ${sound.toFixed(1)} s of sound, then ${(total - sound).toFixed(1)} s of silence. ` +
      "The voice model probably dropped the words after that (the transcript still shows them all).", null, "warn");
    return true;
  }
  return false;
}

// Mumble check: the loudest 250 ms of the first second. Clean lines peak at 0.10–0.2; the 6–1 mumble at 0.04.
// 0.08 also stopped "Let's adjust the camera, please." (0.065) three times: maybe just a soft start, so the
// line is set nearer the real mumble. A true mumble that slips through is still caught by the other checks.
const MUMBLE_CHECK_S = 1;
const MUMBLE_PEAK = 0.05;
function peakLoudness(chunks) {
  const all = chunks.length === 1 ? chunks[0] : Float32Array.from(chunks.flatMap((c) => [...c]));
  const win = RATE / 4;
  let peak = 0;
  for (let i = 0; i + win <= all.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += all[j] * all[j];
    peak = Math.max(peak, Math.sqrt(sum / win));
  }
  return peak;
}

// Wordings this voice gets wrong. Trying again doesn't help, so the game picks another wording (scores)
// instead. Saved on the server (lab/lines/<voice>/bad.json) so Simon remembers after a reload.
// Made-up lines are new each time: not listed.
export const badLines = new Map();   // text -> reason
function markBad(l, reason) {
  if (l.improvise || badLines.has(l.text)) return;
  badLines.set(l.text, reason);
  lineCache.delete(l.text);
  fetch(`/api/lines/${voiceKey()}/bad`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: l.text, reason }) }).catch(() => {});
}

// Saved lines: every line that makes it into the cache is also saved to disk (lab/lines/<voice>/, via
// the server), and loaded back when the page connects. So the first game after a reload, a restart or
// a fresh clone plays every fixed line instantly, and always with the same take. To redo a bad take,
// delete its .wav: Simon makes it again.
export const saved = { voice: null };
const voiceKey = () => ctx.voice().toLowerCase();

function wavBytes(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);   // PCM, mono
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (const x of c) { const s = Math.max(-1, Math.min(1, x)); view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(view.buffer);
}

async function saveLine(text, chunks, cut) {
  const bytes = wavBytes(chunks);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const seconds = (bytes.length - 44) / 2 / RATE;
  try {
    const r = await fetch(`/api/lines/${voiceKey()}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, wav_b64: btoa(bin), seconds, cut }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    ctx.inspector.note(`💾 saved "${text}" (${seconds.toFixed(1)} s${cut ? ", cut: worth a listen" : ""})`);
  } catch (e) {
    ctx.inspector.note(`💾 couldn't save "${text}": ${e.message}`);
  }
}

// Load this voice's saved lines into the cache (once per voice).
export async function loadSavedLines() {
  const voice = voiceKey();
  if (saved.voice === voice) return;
  saved.voice = voice;
  try {
    const list = await (await fetch(`/api/lines/${voice}`)).json();
    let n = 0;
    await Promise.all(list.map(async (e) => {
      const buf = await (await fetch(e.url)).arrayBuffer();
      const pcm = new Int16Array(buf, 44, (buf.byteLength - 44) >> 1);   // our own WAVs: 44-byte header, 16-bit mono
      const out = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
      if (!lineCache.has(e.text)) { lineCache.set(e.text, [out]); n++; }
    }));
    badLines.clear();
    for (const [t, why] of Object.entries(await (await fetch(`/api/lines/${voice}/bad`)).json())) { badLines.set(t, why); lineCache.delete(t); }
    ctx.inspector.note(`💾 loaded ${n} saved lines for ${voice}` + (badLines.size ? `; ${badLines.size} wordings to avoid (they ${[...new Set(badLines.values())].join(" or ")})` : ""));
  } catch (e) {
    saved.voice = null;
    ctx.inspector.note(`💾 couldn't load saved lines: ${e.message}`);
  }
}

// Pre-warming: as soon as the model is ready, Simon makes every fixed game line once, silently, and
// the audio is cached. Then even the first game plays every command instantly (an uncached line
// takes 1.3–2 s to think). It stops if a game starts or the mic goes on; the rest get cached in play.
export const warm = { running: false, done: 0, total: 0, heardYou: false, paused: false };
// Pause, don't drop (Liz): the agent drops whatever it's doing when you speak, even a silent background
// line nobody can hear. So interrupting is switched off (interrupt_response: false) while a background
// line is being made, and back on afterwards, so talking over Simon out loud still stops him. Tested
// 2026-09-26: the line finishes and you're answered ~2 s after your words (before: line thrown away).
function setInterrupt(on) {
  if ((state.interrupt ?? true) === on) return;
  state.interrupt = on;
  state.quietUpdates = (state.quietUpdates || 0) + 1;
  send(sessionUpdate(on));
  ctx.inspector.note(on ? "🔀 page: interrupting back on (Simon stops if you talk over him)"
    : "🔀 page: interrupting off while Simon makes a background line (it finishes, then you get your turn)", null, "tool");
}

// You come first: while you're talking, or waiting for an answer, no background line may start.
const youFirst = () => warm.heardYou || state.userSpeaking || waitingForReply();
export function resumeWarm() {
  if (warm.running || ctx.game.running || state.userSpeaking || waitingForReply()) return;
  prewarmLines(ctx.game.linesToWarm());
}
function sameWords(a, b) {
  const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}
// Make sure a line is cached (made silently and checked, if it isn't yet). True if it's ready to play.
export async function prepareLine(text) {
  if (lineCache.has(text)) return true;
  const { done } = sayLine(text, { silent: true });
  await Promise.race([done, sleep(20000)]);
  return lineCache.has(text);
}

export async function prewarmLines(lines) {
  if (warm.running) return;
  const todo = [...new Set(lines)].filter((t) => !lineCache.has(t) && !badLines.has(t));
  if (!todo.length) return;
  Object.assign(warm, { running: true, done: 0, total: todo.length, heardYou: false, paused: false });
  ctx.inspector.note(`🔥 pre-warming ${todo.length} game lines (silent)`);
  const t0 = performance.now();
  for (const text of todo) {
    if (!state.ws || ctx.game.running || youFirst()) {
      warm.paused = true;
      ctx.inspector.note(`🔥 pre-warm paused at ${warm.done} of ${warm.total} (${ctx.game.running ? "a game started" : state.ws ? "you spoke: you go first" : "not connected"}); ` +
        "it carries on once you've had your answer, or after the game");
      break;
    }
    setInterrupt(false);
    const { done } = sayLine(text, { silent: true });
    await Promise.race([done, sleep(20000)]);
    warm.done++;
    if (lineCache.has(text)) ctx.inspector.note(`🔥 ${warm.done}/${warm.total} "${text}"`);
  }
  setInterrupt(true);
  if (warm.done === warm.total) ctx.inspector.note(`🔥 pre-warm finished: ${todo.filter((t) => lineCache.has(t)).length} of ${todo.length} lines cached in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  warm.running = false;
}
