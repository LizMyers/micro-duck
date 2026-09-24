// Inspector: a live, readable record of everything the page says to the agent
// (→), everything the agent says back (←), and what the page does itself (•).
//
// High-frequency audio messages are folded into one counting row each, so the
// interesting events stay visible. Click a row to see its full JSON (long
// base64 audio fields are shortened). "Copy" puts the whole session on the
// clipboard as JSON, handy for bug reports.

const FOLD = {
  "input_audio_buffer.append": { icon: "🎙", label: "mic audio", ms: 20 },
  "response.output_audio.delta": { icon: "🔊", label: "reply audio" },
  "response.output_audio_transcript.delta": { icon: "✍️", label: "reply text", text: true },
  "conversation.item.input_audio_transcription.delta": { icon: "👂", label: "hearing", text: true },
};

function shorten(value) {
  return JSON.stringify(value, (k, v) =>
    typeof v === "string" && v.length > 120 && (k === "audio" || k === "delta") ? `${v.slice(0, 24)}… (${v.length} chars)` : v, 2);
}

// One-line summary for the row, so you rarely need to open it.
function summarize(ev) {
  switch (ev.type) {
    case "session.update": {
      const s = ev.session || {};
      const tools = (s.tools || []).map((t) => t.name);
      return `settings: voice ${s.audio?.output?.voice ?? "?"}, ${tools.length} tools${tools.length ? ` (${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "…" : ""})` : ""}`;
    }
    case "session.updated": {
      const s = ev.session || {};
      return `agent confirms: ${(s.tools || []).length} tools, tool_choice ${s.tool_choice ?? "?"}`;
    }
    case "conversation.item.input_audio_transcription.completed": return `heard: “${ev.transcript}”`;
    case "response.output_audio_transcript.done": return `said: “${ev.transcript}”`;
    case "response.function_call_arguments.done": return `🛠 TOOL CALL ${ev.name}(${ev.arguments})`;
    case "conversation.item.create":
      return ev.item?.type === "function_call_output" ? `tool result: ${ev.item.output}` : `add item: ${ev.item?.type}`;
    case "response.create": return "ask for a reply";
    case "response.done": return `reply finished (${ev.response?.status})`;
    case "input_audio_buffer.speech_started": return "you started talking";
    case "input_audio_buffer.speech_stopped": return "you stopped talking";
    case "error": return `ERROR ${ev.error?.code ?? ""} ${ev.error?.message ?? ""}`;
    default: return "";
  }
}

export class Inspector {
  constructor(root) {
    this.root = root;
    this.list = root.querySelector(".insp-list");
    this.hideAudio = root.querySelector("#insp-hide-audio");
    this.records = [];
    this.fold = null;     // the currently growing folded row
    this.t0 = performance.now();
    root.querySelector("#insp-clear").onclick = () => this.clear();
    root.querySelector("#insp-copy").onclick = () => this.copy();
    this.hideAudio.onchange = () => root.classList.toggle("hide-audio", this.hideAudio.checked);
    root.classList.toggle("hide-audio", this.hideAudio.checked);
  }

  time() { return ((performance.now() - this.t0) / 1000).toFixed(2); }

  // dir: "out" (page → agent), "in" (agent → page), "note" (page itself)
  message(dir, ev) {
    this.records.push({ t: this.time(), dir, type: ev.type, event: ev });
    const folded = FOLD[ev.type];
    if (folded) return this.addFolded(dir, ev, folded);
    this.fold = null;
    this.addRow(dir, ev.type, summarize(ev), ev);
  }

  note(text, detail = null, kind = "") {
    this.records.push({ t: this.time(), dir: "note", text, detail });
    this.fold = null;
    this.addRow("note", text, "", detail, kind);
  }

  addFolded(dir, ev, spec) {
    if (!this.fold || this.fold.type !== ev.type) {
      const row = this.addRow(dir, `${spec.icon} ${spec.label}`, "", null, "audio");
      this.fold = { type: ev.type, row, count: 0, text: "" };
    }
    const f = this.fold;
    f.count++;
    if (spec.text) f.text += ev.delta || "";
    const extra = spec.ms ? ` · ${((f.count * spec.ms) / 1000).toFixed(1)} s` : "";
    f.row.querySelector(".insp-sum").textContent = spec.text ? `“${f.text.slice(-80)}”` : `×${f.count}${extra}`;
  }

  addRow(dir, title, summary, detail, kind = "") {
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    const row = document.createElement("details");
    row.className = `insp-row ${dir} ${kind}`;
    if (/TOOL CALL|tool result/.test(summary) || /^🦆/.test(title)) row.classList.add("tool");
    if (/^ERROR/.test(summary)) row.classList.add("err");
    const arrow = { out: "→", in: "←", note: "•" }[dir];
    row.innerHTML = `<summary><span class="insp-t">${this.time()}</span><span class="insp-dir">${arrow}</span>` +
      `<span class="insp-title"></span><span class="insp-sum"></span></summary>`;
    row.querySelector(".insp-title").textContent = title;
    row.querySelector(".insp-sum").textContent = summary;
    if (detail) {
      const pre = document.createElement("pre");
      pre.textContent = typeof detail === "string" ? detail : shorten(detail);
      row.append(pre);
    }
    this.list.append(row);
    while (this.list.children.length > 600) this.list.firstChild.remove();
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
    return row;
  }

  clear() {
    this.list.textContent = "";
    this.records = [];
    this.fold = null;
  }

  async copy() {
    const slim = this.records.filter((r) => !FOLD[r.type]).map((r) => ({
      ...r, event: r.event ? JSON.parse(shorten(r.event)) : undefined,
    }));
    try {
      await navigator.clipboard.writeText(JSON.stringify(slim, null, 2));
      this.note(`Copied ${slim.length} events to the clipboard`);
    } catch {
      this.note("Couldn't copy (clipboard blocked)");
    }
  }
}
