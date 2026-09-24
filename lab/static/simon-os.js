// Simon OS: the "what's running?" tab.
//
// The lab server narrates everything it does (starting the agent, a leftover process, a crash)
// as "lab" events on the same live stream as the agent's log. This tab shows them, together with
// the Terminal command each one stands in for, so you can learn the commands as you go.
// The buttons sit next to what they control: server, model, stray processes.

const $ = (id) => document.getElementById(id);

const HEALTH = {
  ready: ["READY", (s) => `${s.label} is running.`],
  starting: ["LOADING", (s) => `Loading ${s.label}: ${s.secs} s (usually 60–180 s).`],
  stopped: ["STOPPED", () => "The model is not running."],
  error: ["CRASHED", () => "The model exited unexpectedly. See system messages."],
  // The page lost touch with the lab (the program behind this page): usually its Terminal was
  // closed or got Ctrl+C, or it's an older lab that doesn't know about Simon OS yet.
  unknown: ["?", () => "No connection to the server. Start it in Terminal, then reload."],
};

export class SimonOS {
  /** @param {{ startAgent(model: string, why: string): Promise<void>, stopAgent(): Promise<void>,
   *            selectedModel(): string, toast(msg: string): void }} app */
  constructor(app) {
    this.app = app;
    this.feed = $("os-feed");
    this.sys = null;          // the last /api/system result
    this.status = "unknown";
    this.label = "";
    this.startingSince = null;
    $("os-check").onclick = () => this.refresh(true);
    $("os-restart-agent").onclick = () => this.restartAgent();
    $("os-stop-agent").onclick = () => this.app.stopAgent();
    $("os-cleanup").onclick = () => this.post("/api/system/cleanup");
    $("os-restart-lab").onclick = () => this.restartLab();
    $("os-copy").onclick = () => this.copy();
    setInterval(() => this.tick(), 1000);
    setInterval(() => this.refresh(), 15000);
  }

  // ---- the live stream ----
  connected() {
    this.feed.textContent = "";  // the lab replays its recent messages on every (re)connect
    this.refresh();
  }

  disconnected() {
    this.status = "unknown";
    this.renderHealth();
  }

  onLab(msg) {
    const li = document.createElement("li");
    li.dataset.level = msg.level || "info";
    const time = document.createElement("time");
    time.textContent = new Date(msg.t * 1000).toLocaleTimeString([], { hour12: false });
    const text = document.createElement("span");
    text.textContent = msg.text;
    li.append(time, text);
    if (msg.cmd) {
      const code = document.createElement("code");
      code.textContent = `$ ${msg.cmd}`;
      li.append(code);
    }
    const atBottom = this.feed.scrollTop + this.feed.clientHeight >= this.feed.scrollHeight - 20;
    this.feed.append(li);
    while (this.feed.children.length > 200) this.feed.firstChild.remove();
    if (atBottom || !msg.replay) this.feed.scrollTop = this.feed.scrollHeight;
    if (!msg.replay) this.refreshSoon();
  }

  onStatus(ev, label) {
    if (ev.status === "starting" && this.status !== "starting") this.startingSince = Date.now();
    this.status = ev.status;
    this.label = label || "The model";
    this.renderHealth();
    this.refreshSoon();
  }

  // ---- buttons ----
  async restartAgent() {
    const model = this.sys?.agent.model || this.app.selectedModel();
    const running = this.status === "ready" || this.status === "starting";
    await this.app.startAgent(model, running ? "you pressed Restart agent" : "you pressed Start agent");
  }

  async restartLab() {
    const before = this.sys?.lab.started;
    await this.post("/api/system/restart-lab");
    // Wait for the fresh copy of the lab to answer, then reload so the page gets fresh code too.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s = await (await fetch("/api/system")).json();
        if (s.lab.started !== before) return location.reload();
      } catch {}
    }
    this.app.toast("The lab didn't come back after 60 s. Check your Terminal.");
  }

  async post(url, body) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      const data = await res.json();
      if (data.lab) this.render(data);
    } catch (e) {
      this.app.toast(`Simon OS: ${e.message}`);
    }
  }

  copy() {
    const text = [...this.feed.children].map((li) => li.innerText.replace(/\n/g, "  ")).join("\n");
    navigator.clipboard.writeText(text).then(() => this.app.toast("System messages copied."));
  }

  // ---- facts ----
  refreshSoon() {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.refresh(), 400);
  }

  async refresh(check = false) {
    try {
      this.render(await (await fetch(`/api/system${check ? "?check=1" : ""}`)).json());
    } catch {
      this.disconnected();
    }
  }

  render(s) {
    this.sys = s;
    $("os-lab").textContent =
      `running · ${s.lab.url.replace("http://", "")} · pid ${s.lab.pid} · up ${ago(s.lab.started)}`;
    const a = s.agent;
    $("os-agent").textContent = a.pid
      ? `${a.status} · ${a.label} · port ${a.port} · pid ${a.pid} · ${a.mb.toLocaleString()} MB`
      : a.port_pids.length ? `not ours: pid ${a.port_pids[0]} holds port ${a.port}` : "not running";
    const left = $("os-leftovers");
    left.textContent = s.leftovers.length
      ? s.leftovers.map((p) => `${p.kind === "lab" ? "old server" : "orphan model"}, pid ${p.pid}, since ${
        new Date(p.started * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`).join(" · ")
      : "none";
    left.dataset.warn = String(s.leftovers.length > 0);
    $("os-cleanup").disabled = s.leftovers.length === 0;
    const running = a.status === "ready" || a.status === "starting";
    $("os-restart-agent").textContent = running ? "Restart model" : "Start model";
    $("os-stop-agent").disabled = !running;
  }

  tick() {
    if (this.status === "starting") this.renderHealth();
  }

  renderHealth() {
    const [word, detail] = HEALTH[this.status] || HEALTH.unknown;
    const secs = this.startingSince ? Math.round((Date.now() - this.startingSince) / 1000) : 0;
    $("health").dataset.state = this.status;
    $("health-word").textContent = word;
    $("health-detail").textContent = detail({ label: this.label, secs });
  }
}

function ago(t) {
  const m = Math.floor((Date.now() / 1000 - t) / 60);
  return m < 1 ? "just now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
