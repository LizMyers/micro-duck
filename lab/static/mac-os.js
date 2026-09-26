// Mac OS tab: who is using the Mac's memory (macOS, the model, Chrome, the Duck Lab server,
// other apps), plus a warning banner on every tab when memory runs low.
//
// The numbers come from the server (/api/memory), which reads them from `top`: each program's
// real footprint, the same as Activity Monitor's Memory column.

const $ = (id) => document.getElementById(id);

const GB = (mb) => `${(mb / 1024).toFixed(1)} GB`;

// What each part is, in one line.
// Display names where the server's part name isn't the clearest wording.
const LABEL = { "Other apps": "Other open apps" };
const WHAT = {
  "macOS": "The system itself: kernel, window server, background services",
  "Model": "speech-to-speech: Simon's hearing, language model and voice",
  "Chrome": "Includes this page, the simulator and the camera",
  "Duck Lab server": "The small server behind this page",
};

const PRESSURE = {
  normal: ["OK", "macOS has enough memory."],
  warning: ["LOW", "macOS is short of memory: it's compressing and swapping, so things slow down."],
  critical: ["CRITICAL", "macOS is nearly out of memory: apps may freeze or be closed."],
};

export class MacOS {
  constructor() {
    this.dismissedUntil = 0;
    $("ram-warning-show").onclick = () => { $("tab-mac").click(); this.hideWarning(); };
    $("ram-warning-close").onclick = () => { this.dismissedUntil = Date.now() + 5 * 60_000; this.hideWarning(); };
    // Fresh numbers as soon as you open the tab.
    $("tab-mac").addEventListener("click", () => { clearTimeout(this.timer); this.poll(); });
    this.poll();
  }

  get visible() { return !$("panel-mac").hidden; }

  async poll() {
    try {
      const r = await (await fetch("/api/memory")).json();
      this.render(r);
      this.warn(r);
    } catch {}
    // Every 5 s while you're looking at the tab; every 20 s in the background (just for the warning).
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), this.visible ? 5000 : 20000);
  }

  render(r) {
    const [word, detail] = PRESSURE[r.pressure] || PRESSURE.normal;
    $("mac-summary").dataset.pressure = r.pressure;
    $("mac-pressure").textContent = word;
    $("mac-detail").textContent = `${detail} ${r.free_percent}% free.`;
    const used = r.used_mb ?? r.total_mb;
    $("ram-used").style.width = `${Math.min(100, (used / r.total_mb) * 100)}%`;
    $("ram-text").textContent = `RAM: ${GB(used)} of ${GB(r.total_mb)} in use · ` +
      `${GB(r.compressed_mb ?? 0)} compressed · ${GB(r.swap_mb)} moved to disk (swap)`;

    // One meter per part, scaled to the Mac's total RAM.
    const list = $("mem-list");
    list.textContent = "";
    for (const g of r.groups) {
      const li = document.createElement("li");
      li.dataset.name = g.name;
      const pct = Math.min(100, (g.mb / r.total_mb) * 100);
      // Just one app in this part (e.g. Google Chrome Canary): its name goes above the bar, no extra row.
      const single = g.top?.length === 1;
      const top = g.top?.length > 1 ? g.top.map((t) => `${t.name} ${GB(t.mb)}`).join(" · ") : "";
      li.innerHTML = `
        <div class="mem-head"><b></b><span class="num"></span></div>
        <div class="mem-bar"><span style="width:${pct}%"></span></div>
        <small class="what"></small>${top ? '<small class="top"></small>' : ""}`;
      li.querySelector("b").textContent = single ? g.top[0].name : (LABEL[g.name] || g.name);
      li.querySelector(".num").textContent = GB(g.mb);
      li.querySelector(".what").textContent = WHAT[g.name] || "";
      // The biggest apps in this part, one per line: the name in semi-bold, its size beside it.
      if (top) li.querySelector(".top").replaceChildren(...g.top.map((t) => {
        const row = document.createElement("span");
        row.className = "app";
        const name = document.createElement("b");
        name.textContent = t.name;
        row.append(name, ` ${GB(t.mb)}`);
        return row;
      }));
      list.append(li);
    }
  }

  // A banner on every tab when memory is low, unless you're already on the Mac OS tab.
  warn(r) {
    const low = r.pressure !== "normal";
    if (!low || this.visible || Date.now() < this.dismissedUntil) return this.hideWarning();
    const chrome = r.groups.find((g) => g.name === "Chrome");
    const biggest = [...(r.groups.find((g) => g.name === "Other apps")?.top || [])][0];
    // A short headline, then one plain sentence: what's free and what would help most.
    const lead = document.createElement("strong");
    lead.textContent = "Memory is running low.";
    const helps = [biggest && `${biggest.name} (${GB(biggest.mb)})`, chrome && `a few Chrome tabs (${GB(chrome.mb)})`].filter(Boolean);
    $("ram-warning-text").replaceChildren(lead,
      ` ${r.free_percent}% free.` + (helps.length ? ` Closing ${helps.join(" or ")} would help.` : " Closing other apps would help."));
    $("ram-warning").dataset.level = r.pressure;
    $("ram-warning").hidden = false;
  }

  hideWarning() { $("ram-warning").hidden = true; }
}
