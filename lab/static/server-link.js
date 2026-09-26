// The link to our server (server.py): it starts and stops HF's agent, and streams what's happening
// (/api/events): the agent's status, its log, timing "stages" and our own server's narration.

import { state, ctx, toast } from "/static/core.js";
import { connect, disconnect } from "/static/agent.js";
import { setTalkLabel } from "/static/audio.js";
import { AGENT_WHY } from "/static/turn-taking.js";

export async function startAgent(model, why = "you pressed Start") {
  disconnect();
  const res = await fetch("/api/agent/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, why }),
  });
  if (!res.ok) toast(`Couldn't start the agent: ${(await res.json()).detail}`);
}

export async function stopAgent() {
  disconnect();
  await fetch("/api/agent/stop", { method: "POST" });
}

// on: { status(ev), log(line), stage(ev) } for page-specific extras (all optional).
export function listenToServer(on = {}) {
  const es = new EventSource("/api/events");  // reconnects by itself if the server restarts
  es.onopen = () => ctx.os?.connected();
  es.onerror = () => ctx.os?.disconnected();
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "status") onAgentStatus(ev, on.status);
    else if (ev.type === "lab") ctx.os?.onLab(ev);
    else if (ev.type === "log") on.log?.(ev.line);
    else if (ev.type === "stage") {
      on.stage?.(ev);
      const { type, stage, t, ...rest } = ev;
      // Back end: the agent's own reasons for stopping something (🧠 agent rows in the Inspector).
      if (AGENT_WHY[stage]) ctx.inspector.note(`🧠 agent: ${AGENT_WHY[stage]}`, null, "warn");
      else ctx.inspector.note(`stage: ${stage}`, rest);
    }
  };
}

export function onAgentStatus(ev, extra) {
  const prev = state.agentStatus;
  state.agentStatus = ev.status;
  state.agentModel = ev.model;
  const model = state.options?.models.find((m) => m.id === ev.model);
  ctx.os?.onStatus(ev, model ? model.label : "");
  extra?.(ev);
  setTalkLabel();
  if (ev.status === "error" && ev.error) toast(ev.error, 10000);
  if (ev.status === "ready" && prev !== "ready") {
    state.warm = false;
    connect();
  }
  if (ev.status !== "ready") disconnect();
}
