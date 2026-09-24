// The duck's body language: turns what the voice agent is doing into head poses
// and beak movement on Pollen's Microduck simulator (running in an iframe).
//
// The simulator exposes a control handle, `window.rl`, inside its iframe:
//   rl.headTarget  - 4 numbers the walking policy steers the head towards:
//                    [neck_pitch, head_pitch, head_yaw, head_roll]
//                    signs: neck_pitch + = up, head_pitch + = down,
//                           head_yaw + = left, head_roll + = tilt right
//   rl.setJaw(0..1) - beak opening (a small hook we added to the simulator)

// Head poses, in the simulator's command units (roughly radians).
// These are first guesses: tune them by eye.
const POSES = {
  idle:        [0.00,  0.00,  0.00,  0.00],
  listening:   [0.30, -0.25,  0.00,  0.35],  // look up at you, curious tilt
  thinking:    [0.40, -0.30,  0.50, -0.10],  // glance up and to the side
  speaking:    [0.20, -0.10,  0.00,  0.00],  // face you
  interrupted: [-0.20, 0.20,  0.00,  0.00],  // pull back, surprised
};

const WHY = {
  idle: "Waiting for someone to talk.",
  listening: "You're talking, so it looks up at you and tilts its head.",
  thinking: "The model is working on a reply, so it glances away.",
  speaking: "Replying. The beak follows the loudness of its own voice.",
  interrupted: "You talked over it, so it stopped and pulled back.",
};

export class DuckBody {
  constructor({ iframe, moodEl, whyEl, beakBar, beakNum, headDot, headText }) {
    Object.assign(this, { iframe, moodEl, whyEl, beakBar, beakNum, headDot, headText });
    this.mood = "idle";
    this.pose = POSES.idle;
    this.jaw = 0;
    this.analyser = null;
    this.buf = null;
    this.timer = null;
    this.jawOverride = null;   // set a number to hold the beak open (for tuning)
    this.forwardKeys();
    requestAnimationFrame(() => this.tick());
    // Once the simulator has booted and the entrance has played, face the duck.
    this.iframe.addEventListener("load", () =>
      this.whenReady(() => {
        this.setColour("blue");
        setTimeout(() => this.faceCamera(), 3000);
      }));
  }

  // Portrait camera: stop the game's chase cam (which films the duck from behind)
  // and place the camera in front of the duck, a little above eye level.
  // Coordinates: MuJoCo is z-up; the 3D scene uses x, y-up, z = -mujoco_y.
  faceCamera({ distance = 0.55, height = 0.22, lookHeight = 0.14 } = {}) {
    const rl = this.rl;
    if (!rl?.data || !rl.camera || !rl.controls) return false;
    const q = rl.data.qpos;
    // Heading (yaw) from the trunk quaternion (w, x, y, z) = qpos[3..6].
    const [w, x, y, z] = [q[3], q[4], q[5], q[6]];
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const cx = q[0], cz = -q[1];
    rl.chaseCam = false;
    rl.controls.target.set(cx, lookHeight, cz);
    rl.camera.position.set(cx + Math.cos(yaw) * distance, height, cz - Math.sin(yaw) * distance);
    rl.camera.lookAt(rl.controls.target);
    rl.controls.update();
    return true;
  }

  // Keyboard driving from anywhere on the page: forward the simulator's keys
  // into its frame (it listens on its own window), unless you're typing.
  forwardKeys() {
    const KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyQ", "KeyE"]);
    const typing = (el) => el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" ||
      el.tagName === "SELECT" || el.isContentEditable);
    const pass = (type) => (e) => {
      if (!KEYS.has(e.code) || typing(document.activeElement) || e.metaKey || e.ctrlKey) return;
      const w = this.iframe.contentWindow;
      if (!w) return;
      e.preventDefault();             // arrows would otherwise scroll the page
      w.dispatchEvent(new w.KeyboardEvent(type, { code: e.code, key: e.key, repeat: e.repeat }));
      if (type === "keydown") this.onKey?.(e.code);
    };
    window.addEventListener("keydown", pass("keydown"));
    window.addEventListener("keyup", pass("keyup"));
  }

  // Colourways of the real robot: "classic" (Cream), "charcoal" (Graphite),
  // "purple" (Lavender), "blue" (Sky: pale blue with orange trim).
  setColour(name) {
    try { this.iframe.contentWindow?.__gameApi?.setVariant?.(name); } catch {}
  }

  // Call once the simulator has booted and the duck has settled.
  whenReady(fn, tries = 200) {
    const rl = this.rl;
    if (rl?.data && rl.camera && rl.headTarget) return fn(rl);
    if (tries > 0) setTimeout(() => this.whenReady(fn, tries - 1), 250);
  }

  get rl() {
    try { return this.iframe.contentWindow?.rl ?? null; } catch { return null; }
  }

  // Reply audio is routed through this analyser so the beak can follow it.
  attachAudio(ctx) {
    if (this.analyser) return this.analyser;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(ctx.destination);
    this.buf = new Float32Array(this.analyser.fftSize);
    return this.analyser;
  }

  setMood(mood, { holdMs = 0, then = null } = {}) {
    clearTimeout(this.timer);
    this.mood = mood;
    this.pose = POSES[mood];
    this.moodEl.dataset.mood = mood;
    this.moodEl.textContent = mood[0].toUpperCase() + mood.slice(1);
    this.whyEl.textContent = WHY[mood];
    const rl = this.rl;
    if (rl?.headTarget) for (let i = 0; i < 4; i++) rl.headTarget[i] = this.pose[i];
    this.drawHead();
    if (holdMs && then) this.timer = setTimeout(() => this.setMood(then), holdMs);
  }

  drawHead() {
    const [neck, pitch, yaw] = this.pose;
    const up = neck - pitch;           // both raise the gaze
    const x = Math.max(-1, Math.min(1, -yaw / 0.6)) * 9;
    const y = Math.max(-1, Math.min(1, -up / 0.6)) * 9;
    this.headDot.style.transform = `translate(${x}px, ${y}px)`;
    const parts = [];
    if (up > 0.1) parts.push("up");
    if (up < -0.1) parts.push("back");
    if (yaw > 0.1) parts.push("left");
    if (yaw < -0.1) parts.push("right");
    if (Math.abs(this.pose[3]) > 0.1) parts.push("tilted");
    this.headText.textContent = parts.length ? parts.join(", ") : "neutral";
  }

  // Every animation frame: measure how loud the reply is and open the beak to match.
  tick() {
    let target = 0;
    if (this.analyser && this.mood === "speaking") {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += v * v;
      const rms = Math.sqrt(sum / this.buf.length);
      target = Math.max(0, Math.min(1, (rms - 0.01) * 7));
    }
    // Open quickly, close a little slower, so it reads as syllables, not flicker.
    const k = target > this.jaw ? 0.6 : 0.25;
    this.jaw += (target - this.jaw) * k;
    if (this.jawOverride != null) this.jaw = this.jawOverride;
    this.rl?.setJaw?.(this.jaw);
    const pct = Math.round(this.jaw * 100);
    this.beakBar.style.width = `${pct}%`;
    this.beakNum.textContent = `${pct}%`;
    requestAnimationFrame(() => this.tick());
  }
}
