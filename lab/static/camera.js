// The webcam referee: pose tracking runs entirely in this browser (MediaPipe); video never leaves it.
// Every check compares you with your calibrated "normal" stance (pose.js).

import { $, ctx } from "/static/core.js";
import { PoseTracker, POSE_IDS, POSE_LABELS } from "/static/pose.js";

export const cam = {
  tracker: null, on: false, calibrated: false, held: new Set(),
  btn: $("camera"), pip: $("cam-pip"), chips: $("pose-chips"), status: $("cam-status"),
};
const status = (text) => { if (cam.status) cam.status.textContent = text; };

// Pose chips (lab): each shows the live measurement next to its name, so thresholds can be tuned on a real person.
if (cam.chips) {
  for (const id of POSE_IDS) {
    const li = document.createElement("li");
    li.dataset.pose = id;
    li.innerHTML = `${POSE_LABELS[id]} <span class="num">–</span>`;
    cam.chips.append(li);
  }
}

// forGame: the game runs its own calibration (countdown), so don't also calibrate here.
export async function startCamera({ forGame = false } = {}) {
  if (cam.pip) cam.pip.hidden = false;
  if (cam.chips) cam.chips.hidden = false;
  status("Starting camera… (allow access)");
  cam.tracker ??= new PoseTracker();
  try {
    await cam.tracker.start($("cam-video"), $("cam-canvas"));
  } catch (e) {
    status(cam.tracker.error || "Camera failed");
    ctx.inspector.note(`📷 camera failed: ${cam.tracker.error || e.message}`, null, "err");
    return;
  }
  cam.on = true;
  cam.btn?.setAttribute("aria-pressed", "true");
  ctx.inspector.note("📷 camera on (video stays in this browser)");
  status("Stand normally, then Calibrate");
  // Calibrate automatically once a body is in view: every check compares you with this stance.
  // (Not when a game started the camera: that calibrated mid-countdown, 2026-09-26.)
  if (!forGame) setTimeout(() => { if (cam.on && !cam.calibrated) calibrate(); }, 2500);
  cam.unsubscribe = cam.tracker.onFrame(({ poses }) => {
    // "🧍 you: …" in the Inspector when a move has been held for 0.3 s (and the chips light up).
    for (const id of POSE_IDS) {
      const p = poses[id];
      const on = cam.tracker.held(id, 300);
      const li = cam.chips?.querySelector(`[data-pose="${id}"]`);
      if (li) {
        li.querySelector(".num").textContent = p.value == null ? "–" : p.value.toFixed(2);
        li.title = `${POSE_LABELS[id]}: ${p.reason}`;
        li.classList.toggle("on", on);
      }
      if (on && !cam.held.has(id)) {
        cam.held.add(id);
        // (A page can limit this to when it matters: the game page logs moves only during a game.)
        if (ctx.logPoses?.() ?? true) ctx.inspector.note(`🧍 you: ${POSE_LABELS[id]}`);
      }
      if (!on) cam.held.delete(id);
    }
    if (cam.calibrated) status(`${Math.round(cam.tracker.fps || 0)} fps · watching`);
    ctx.onCameraFrame?.();
  });
}

export function stopCamera() {
  cam.unsubscribe?.();
  cam.tracker?.stop();
  cam.on = false;
  cam.calibrated = false;
  ctx.onCameraStop?.();
  if (cam.pip) cam.pip.hidden = true;
  if (cam.chips) cam.chips.hidden = true;
  cam.btn?.setAttribute("aria-pressed", "false");
  ctx.inspector.note("📷 camera off");
}

export function calibrate() {
  const base = cam.tracker?.calibrate();
  cam.calibrated = !!base;
  status(base ? "Calibrated ✓" : "Can't see you: step back so head and shoulders show");
  ctx.inspector.note(base ? "📷 calibrated to your normal stance" : "📷 calibration failed (no body in view)", base);
  return base;
}
