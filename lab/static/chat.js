// Chat: what you said and what Simon said, as bubbles (the page's captions). Your words stream in as
// the agent transcribes them; Simon's appear as he speaks. The lab also shows the duck's moves here.

import { $, state } from "/static/core.js";

function addBubble(cls) {
  $("chat-empty").hidden = true;
  const el = document.createElement("div");
  el.className = `bubble ${cls}`;
  $("chat").append(el);
  return el;
}

const scrollDown = () => { $("chat").scrollTop = $("chat").scrollHeight; };

// A duck move (lab): "🦆 sitting down…", then ✓ or ✗ with what it measured.
export function addAction(text) {
  const el = addBubble("action pending");
  el.textContent = `🦆 ${text}…`;
  scrollDown();
  return el;
}

export function finishAction(el, r) {
  el.classList.remove("pending");
  const facts = [];
  if (r.moved_cm !== undefined) facts.push(`moved ${Math.abs(r.moved_cm)} cm`);
  if (r.turned_degrees !== undefined) facts.push(`turned ${Math.abs(r.turned_degrees)}°`);
  el.textContent = el.textContent.replace(/…$/, "") +
    (r.ok ? ` ✓${facts.length ? ` (${facts.join(", ")})` : ""}` : ` ✗ ${r.error}`);
  el.classList.toggle("failed", !r.ok);
}

export function userBubble(id) {
  if (!state.userBubbles.has(id)) {
    state.userBubbles.set(id, { el: addBubble(`user pending${state.testing ? " test" : ""}`), text: "", final: false });
  }
  return state.userBubbles.get(id);
}

export function renderUser(id) {
  const b = state.userBubbles.get(id);
  b.el.textContent = b.text || "…";
  b.el.classList.toggle("pending", !b.final);
  scrollDown();
}

export function botBubble() {
  if (!state.botBubble || state.botBubble.done) {
    state.botBubble = { el: addBubble(`bot pending${state.testing ? " test" : ""}`), text: "", done: false };
  }
  return state.botBubble;
}

export function renderBot() {
  const b = state.botBubble;
  b.el.textContent = b.text || "…";
  scrollDown();
}

export function finishBotBubble(tag) {
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

export function clearChat() {
  $("chat").querySelectorAll(".bubble").forEach((b) => b.remove());
  state.userBubbles.clear();
  state.botBubble = null;
  $("chat-empty").hidden = false;
}
