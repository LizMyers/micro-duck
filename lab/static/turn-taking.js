// Turn-taking: you go first, and when the conversation breaks, the Inspector says why, from both ends.
// Three things break it: 1. a reply is stopped (the agent drops whatever it's doing when it hears you, or
// the page cut it); 2. you spoke while Simon was busy and never got an answer; 3. the voice model says a
// few words and goes silent (see voice-lines.js). Rows marked "page:" come from this page; "🧠 agent:"
// rows come from HF's speech-to-speech, read from its log by the server (server.py LOG_PATTERNS).
// Why: notes/04-who-goes-first.md.

import { state, ctx } from "/static/core.js";

// The agent's own reasons for stopping something, in plain words.
export const AGENT_WHY = {
  barge_in: "heard speech while replying, so it cancelled the reply and flushed its queue",
  llm_cancelled: "stopped writing a reply part-way (interrupted)",
  tts_cancelled: "stopped the voice mid-line (interrupted)",
  stale_dropped: "threw away a reply that was out of date (you'd spoken or it was cancelled since it started)",
};

const busyWith = () => state.line ? `"${state.line.improvise ? state.line.heard || "a made-up line" : state.line.text}"` : "a reply";

export function noteCancel(reason) {
  if (reason === "turn_detected") {
    ctx.inspector.note(`🛑 page: stopped ${busyWith()}: the agent heard you start talking, and it drops whatever it's doing when you speak` +
      (state.line?.silent ? " (this was a silent pre-warm, so nobody heard it)" : ""), null, "warn");
  } else if (!state.line?.cut) {   // a cut already says why (✂️ or ⏱)
    ctx.inspector.note(`🛑 page: stopped ${busyWith()} (${reason || "no reason given"})`, null, "warn");
  }
}

// You spoke: did you get an answer? If not within REPLY_WAIT, say so, and what Simon was busy with.
const REPLY_WAIT = 10;   // seconds: long prompts can take 9–13 s to answer
let replyWatch = null;
export function watchForReply(heard) {
  clearTimeout(replyWatch?.timer);
  if (ctx.game?.running) return;   // during a game you talk to the camera, not the agent
  const busy = state.responding ? busyWith() : null;
  replyWatch = { timer: setTimeout(() => {
    ctx.inspector.note(`⚠️ page: no answer to "${heard}" after ${REPLY_WAIT} s` + (busy
      ? `. When you spoke, Simon was busy making ${busy}, and the agent dropped your turn. Say it again.`
      : ". The agent may still be thinking (long conversations are slow) or it dropped your turn."), null, "warn");
    replyWatch = null;
  }, REPLY_WAIT * 1000) };
}
export function replied() { clearTimeout(replyWatch?.timer); replyWatch = null; }
export const waitingForReply = () => !!replyWatch;

// You spoke while Simon was quietly making a line: he nods, so you know he heard, finishes it, then answers.
export function nodIfBusy() {
  if (!state.line?.silent || ctx.game?.running) return;
  ["down", null, "down", null].forEach((d, i) => setTimeout(() => ctx.body.lookAt(d), i * 250));
  ctx.inspector.note(`🙂 page: Simon nods: he heard you, finishes "${state.line.text}", then answers`, null, "tool");
}
