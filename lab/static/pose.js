// Webcam pose tracking for Simon Says (webcam edition).
//
// Google's MediaPipe PoseLandmarker runs *inside the browser* on the webcam
// feed: 33 body points (nose, eyes, shoulders, elbows, wrists, hips, ...)
// about 30 times a second. No video ever leaves this page.
//
// The rules that decide "is this person looking to their left?" live in
// evaluatePoseDetailed(), a pure function of the landmarks, so they can be
// unit-tested without a camera (tests/pose-rules.test.mjs).

// Pinned versions (verified to exist): the library, its WASM runtime, the model.
export const TASKS_VISION_VERSION = "1.0.1";
const TASKS_VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// MediaPipe's landmark numbers. Left/right are the PERSON's own left/right,
// whatever the mirrored video looks like.
export const LM = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24,
};

// Simon Says v1 vocabulary (notes/ideas.md). "Left" and "right" are always the
// PLAYER's own left and right.
export const POSE_IDS = [
  "look_up", "look_down", "look_left", "look_right",
  "turn_left", "turn_right",
  "left_arm_up", "right_arm_up", "both_arms_up",
];

export const POSE_LABELS = {
  look_up: "Look up", look_down: "Look down", look_left: "Look left", look_right: "Look right",
  turn_left: "Turn left", turn_right: "Turn right",
  left_arm_up: "Left arm up", right_arm_up: "Right arm up", both_arms_up: "Both arms up",
};

// How far each measurement has to move from the calibrated stance to count.
// First guesses from geometry; tune them live on a real person (the chips show the numbers).
export const THRESHOLDS = {
  look: 0.2,       // head turn: nose offset from the ear midpoint, in ear-widths
  pitch: 0.12,     // head tilt: nose height relative to the ears, in ear-widths (0.15 missed Liz's natural
                   // look down, 2026-09-26; safe to loosen now a move must be held for 1 s)
  turned: 0.8,     // body turn: shoulders look narrower than this fraction of their calibrated width
                   // (0.75 flickered at Liz's 45° turn, 2026-09-26; 0.8 is about a 37° turn)
};

const VISIBLE = 0.5;
const DROPOUT_MS = 300;   // a pose that drops out for less than this is still being held

// Skeleton lines drawn over the video.
const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [15, 19], [16, 20], [0, 2], [0, 5], [2, 7], [5, 8],
];

// ---------- The rules (pure functions) ------------------------------------------------------

// Landmarks are normalised to the image (x: 0..1 of width, y: 0..1 of height,
// y grows downward). `aspect` = width / height, so distances are measured in
// the same units both ways. The image is NOT mirrored here: a player facing the
// camera has their LEFT shoulder on the RIGHT of the image (larger x).
function makeGeom(lm, aspect) {
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, z: lm[i].z ?? 0 });
  const vis = (...ids) => ids.every((i) => lm[i] && (lm[i].visibility ?? 1) > VISIBLE);
  const conf = (...ids) => Math.min(...ids.map((i) => (lm[i] ? lm[i].visibility ?? 1 : 0)));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return { P, vis, conf, dist };
}

// The measurements every rule uses, from one frame. Null if head and shoulders aren't in view.
// Ears are always estimated by the model (even when hidden by hair), so we don't insist they're visible.
export function measure(lm, aspect = 4 / 3) {
  if (!lm || lm.length < 25) return null;
  const { P, vis, conf, dist } = makeGeom(lm, aspect);
  if (!vis(LM.nose, LM.leftShoulder, LM.rightShoulder)) return null;
  const nose = P(LM.nose), le = P(LM.leftEar), re = P(LM.rightEar);
  const ls = P(LM.leftShoulder), rs = P(LM.rightShoulder);
  const earMid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 };
  const earWidth = Math.max(dist(le, re), 1e-6);
  return {
    conf: conf(LM.nose, LM.leftShoulder, LM.rightShoulder),
    noseY: nose.y,
    // Head turn: + when the nose points to the player's LEFT (image right).
    yaw: (nose.x - earMid.x) / earWidth,
    // Head tilt: + when looking up (nose rises relative to the ears).
    pitch: (earMid.y - nose.y) / earWidth,
    // Head tilt, second opinion (being compared, not used by the rules yet): where the nose sits between
    // the eye line and the mouth, 0 = at the eyes, 1 = at the mouth; negated so + is up. Uses only the middle
    // of the face, because ears are often hidden and their estimate is shaky (Liz: the ear line barely moves).
    facePitch: -((nose.y - (P(LM.leftEye).y + P(LM.rightEye).y) / 2) /
      Math.max((P(LM.mouthLeft).y + P(LM.mouthRight).y) / 2 - (P(LM.leftEye).y + P(LM.rightEye).y) / 2, 1e-6)),
    shoulderWidth: dist(ls, rs),
    // Vertical shoulders-to-nose distance: shrinks when you step back, but not when you turn.
    shoulderToNose: (ls.y + rs.y) / 2 - nose.y,
    // Body turn direction: + when the right shoulder is nearer the camera (turned to the player's LEFT).
    shoulderDepth: ls.z - rs.z,
  };
}

function result(ok, confidence, reason, value = null) {
  return { ok: !!ok, confidence: Math.max(0, Math.min(1, confidence)), reason, value };
}

// Returns { poseId: {ok, confidence, reason, value} } for every pose.
// Every v1 rule compares you with your calibrated stance (`baseline`, from calibrate()).
export function evaluatePoseDetailed(lm, baseline = null, aspect = 4 / 3) {
  const out = {};
  const m = measure(lm, aspect);
  if (!m) {
    for (const id of POSE_IDS) out[id] = result(false, 0, "no person in view");
    return out;
  }
  if (!baseline) {
    for (const id of POSE_IDS) out[id] = result(false, 0, "needs calibrating first");
    return out;
  }
  const T = THRESHOLDS;
  const c = m.conf;

  // Shoulder width compared with calibration.
  const width = m.shoulderWidth / baseline.shoulderWidth;
  // The player stays seated at the same distance, so narrow shoulders mean a turn. (It used to be
  // width relative to shoulders-to-nose height, but looking up raised the nose and faked a turn.)
  const turnRatio = width;
  // Moving back shrinks everything, turning only the shoulders: if shoulders-to-nose shrank too, it isn't a turn.
  const steppedBack = m.shoulderToNose / baseline.shoulderToNose < 0.9;
  const turned = turnRatio < T.turned && !steppedBack;

  // Look left / right: the head turns but the body doesn't.
  const yaw = m.yaw - baseline.yaw;
  out.look_left = turned ? result(false, c, "whole body turned, not just the head", yaw)
    : result(yaw > T.look, c, yaw > T.look ? "head turned to your left" : "head not turned left", yaw);
  out.look_right = turned ? result(false, c, "whole body turned, not just the head", yaw)
    : result(yaw < -T.look, c, yaw < -T.look ? "head turned to your right" : "head not turned right", yaw);

  // Look up / down.
  const pitch = m.pitch - baseline.pitch;
  out.look_up = result(pitch > T.pitch, c, pitch > T.pitch ? "head tilted up" : "head not tilted up", pitch);
  out.look_down = result(pitch < -T.pitch, c, pitch < -T.pitch ? "head tilted down" : "head not tilted down", pitch);

  // Turn left / right: shoulders look narrow; the nearer shoulder says which way.
  // If depth is unclear, the direction the head points decides.
  const dir = Math.abs(m.shoulderDepth) > 0.05 ? Math.sign(m.shoulderDepth) : Math.sign(yaw);
  out.turn_left = result(turned && dir > 0, c, turned ? (dir > 0 ? "body turned to your left" : "turned, but to your right")
    : "shoulders still face the camera", turnRatio);
  out.turn_right = result(turned && dir < 0, c, turned ? (dir < 0 ? "body turned to your right" : "turned, but to your left")
    : "shoulders still face the camera", turnRatio);


  // Arms up (good for playing at a desk): the wrist is well above its shoulder, measured in
  // shoulder widths, and not resting on the head. Value = how far above, in shoulder widths.
  const { P, vis, conf, dist } = makeGeom(lm, aspect);
  const sw = m.shoulderWidth;
  const armUp = (side) => {
    const sh = side === "left" ? LM.leftShoulder : LM.rightShoulder;
    const w = side === "left" ? LM.leftWrist : LM.rightWrist;
    const el = side === "left" ? LM.leftElbow : LM.rightElbow;
    if (!vis(sh, w)) {
      // Sitting close to the webcam, a raised hand leaves the top of the frame and the wrist is lost
      // (Liz's right arm was never seen, 2026-09-26). The elbow stays in view: well above the shoulder = up.
      if (vis(sh, el)) {
        const elbowUp = (P(sh).y - P(el).y) / sw;
        if (elbowUp > 0.25) return result(true, conf(sh, el), `${side} elbow is above the ${side} shoulder (hand out of view)`, elbowUp);
      }
      return result(false, conf(sh, w), `${side} wrist not visible`, 0);
    }
    const up = (P(sh).y - P(w).y) / sw;   // positive = wrist above shoulder
    if (up <= 0.35) return result(false, conf(sh, w), `${side} wrist isn't above the ${side} shoulder`, up);
    if (vis(LM.nose) && dist(P(w), P(LM.nose)) < 0.7 * sw) {
      // A raised arm can put the hand right over the head in the picture too (Liz's raised arm was read as
      // "hand on the head" 90% of the time, 2026-09-26). The elbow tells them apart: raised, it's up above
      // the shoulder; resting a hand on your head, it sticks out to the side.
      const e = vis(el) ? P(el) : null;
      const elbowRaised = e && (P(sh).y - e.y) / sw > 0.25 && Math.abs(e.x - P(sh).x) / sw < 0.5;
      if (!elbowRaised) return result(false, conf(sh, w), `${side} hand is on the head, not raised`, up);
    }
    return result(true, conf(sh, w), `${side} wrist is above the ${side} shoulder`, up);
  };
  // Strict (Liz, 2026-09-24): one arm means ONLY that arm. Raising both lights "Both arms up" alone.
  const left = armUp("left"), right = armUp("right");
  const both = left.ok && right.ok;
  const only = (a, otherName) => both ? result(false, a.confidence, `both arms are up, not just ${otherName}`, a.value) : a;
  out.left_arm_up = only(left, "the left");
  out.right_arm_up = only(right, "the right");
  out.both_arms_up = result(both, Math.min(left.confidence, right.confidence),
    both ? "both wrists above shoulders" : "needs both wrists above shoulders", Math.min(left.value, right.value));
  // Raised arms pass over the ears and face and throw the head reading off (nine false head moves in
  // four seconds of "raise both arms", one judged a wrong move, 2026-09-26). So no head moves while an arm is up.
  if (left.ok || right.ok) {
    for (const id of ["look_up", "look_down", "look_left", "look_right"]) {
      out[id] = result(false, out[id].confidence, "an arm is up: the head reading isn't reliable", out[id].value);
    }
  }
  return out;
}

// Just the yes/no answers: { poseId: boolean }.
export function evaluatePose(lm, baseline = null, aspect = 4 / 3) {
  const d = evaluatePoseDetailed(lm, baseline, aspect);
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.ok]));
}

// Your normal stance: stand facing the camera, looking straight ahead. Null if not enough is visible.
export function baselineFrom(lm, aspect = 4 / 3) {
  const m = measure(lm, aspect);
  if (!m) return null;
  const { conf, ...base } = m;
  return base;
}

// ---------- The tracker (camera + model + drawing) ------------------------------------------

export class PoseTracker {
  constructor({ lineColor = "#f08a24", dotColor = "#f08a24" } = {}) {
    this.lineColor = lineColor;
    this.dotColor = dotColor;
    this.status = "idle";      // idle | loading | running | error
    this.error = null;
    this.latest = null;        // { landmarks, timestamp }
    this.baseline = null;
    this.fps = 0;
    this._cbs = new Set();
    this._since = {};          // poseId -> time it started being true
    this._lost = {};           // poseId -> when it last dropped out (a hold survives short dropouts)
    this._landmarker = null;
    this._stream = null;
    this._running = false;
    this._lastTs = -1;
  }

  async start(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.status = "loading";
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }, audio: false,
      });
      videoEl.srcObject = this._stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      await videoEl.play();
      const vision = await import(TASKS_VISION_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      try {
        this._landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch {
        this._landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts("CPU"));
      }
      this.status = "running";
      this._running = true;
      this._loop();
    } catch (e) {
      this.status = "error";
      this.error = e?.name === "NotAllowedError"
        ? "Camera permission was denied. Allow the camera for this page in Chrome's address bar."
        : e?.message || String(e);
      this.stop();
      this.status = "error";
      throw e;
    }
  }

  stop() {
    this._running = false;
    if (this._stream) for (const t of this._stream.getTracks()) t.stop();
    this._stream = null;
    if (this.video) this.video.srcObject = null;
    this._landmarker?.close?.();
    this._landmarker = null;
    if (this.status !== "error") this.status = "idle";
  }

  // Called with { landmarks, timestamp, poses } on every processed frame.
  onFrame(cb) {
    this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }

  get aspect() {
    const v = this.video;
    return v && v.videoWidth ? v.videoWidth / v.videoHeight : 4 / 3;
  }

  // Record the person's neutral stance (stand normally, arms down).
  calibrate() {
    const b = baselineFrom(this.latest?.landmarks, this.aspect);
    if (b) this.baseline = b;
    return b;
  }

  check(poseId) {
    const d = evaluatePoseDetailed(this.latest?.landmarks, this.baseline, this.aspect);
    return d[poseId] ?? { ok: false, confidence: 0, reason: `unknown pose ${poseId}` };
  }

  // Head tilt now, compared with calibration, by both methods (see facePitch in measure()).
  tilt() {
    const m = measure(this.latest?.landmarks, this.aspect), b = this.baseline;
    if (!m || !b || b.facePitch == null) return null;
    return { ears: m.pitch - b.pitch, face: m.facePitch - b.facePitch };
  }

  // When poseId started being held (performance.now() time), or null if it isn't held now.
  since(poseId) { return this._since[poseId] ?? null; }

  // True when poseId has been held continuously for at least `ms`.
  held(poseId, ms = 300) {
    const since = this._since[poseId];
    return since != null && performance.now() - since >= ms;
  }

  _loop() {
    if (!this._running) return;
    const next = () => this._loop();
    const v = this.video;
    // Only run the model on a new video frame (the screen may refresh faster).
    const fresh = v.currentTime !== this._lastVideoTime;
    if (fresh && v.readyState >= 2 && this._landmarker) {
      this._lastVideoTime = v.currentTime;
      let ts = performance.now();
      if (ts <= this._lastTs) ts = this._lastTs + 1;   // MediaPipe needs increasing timestamps
      this._lastTs = ts;
      let res = null;
      try { res = this._landmarker.detectForVideo(v, ts); } catch (e) { this.error = e.message; }
      const landmarks = res?.landmarks?.[0] ?? null;
      this.latest = { landmarks, timestamp: ts };
      const poses = evaluatePoseDetailed(landmarks, this.baseline, this.aspect);
      const now = performance.now();
      // Tracking flickers: a single missed frame used to restart a hold, so a 1 s hold could never be
      // reached (Liz held her arm up and lost "Too slow", 2026-09-26). Only a dropout longer than
      // DROPOUT_MS ends a hold.
      for (const id of POSE_IDS) {
        if (poses[id].ok) { this._since[id] ??= now; delete this._lost[id]; }
        else if (this._since[id] != null) {
          this._lost[id] ??= now;
          if (now - this._lost[id] > DROPOUT_MS) { delete this._since[id]; delete this._lost[id]; }
        }
      }
      this._fpsTick(now);
      this._draw(landmarks);
      for (const cb of this._cbs) { try { cb({ landmarks, timestamp: ts, poses }); } catch {} }
    }
    requestAnimationFrame(next);
  }

  _fpsTick(now) {
    if (this._fpsT0 == null) { this._fpsT0 = now; this._fpsN = 0; }
    this._fpsN++;
    if (now - this._fpsT0 >= 1000) {
      this.fps = Math.round((this._fpsN * 1000) / (now - this._fpsT0));
      this._fpsT0 = now; this._fpsN = 0;
    }
  }

  // Mirrored selfie view (like a mirror or a video call) with the skeleton on top.
  _draw(lm) {
    const { canvas: c, ctx, video: v } = this;
    const w = v.videoWidth || 640, h = v.videoHeight || 480;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, w, h);
    if (lm) {
      ctx.lineWidth = Math.max(2, w / 200);
      ctx.strokeStyle = this.lineColor;
      ctx.fillStyle = this.dotColor;
      for (const [a, b] of BONES) {
        if ((lm[a].visibility ?? 1) < VISIBLE || (lm[b].visibility ?? 1) < VISIBLE) continue;
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
      }
      for (const i of Object.values(LM)) {
        if ((lm[i].visibility ?? 1) < VISIBLE) continue;
        ctx.beginPath();
        ctx.arc(lm[i].x * w, lm[i].y * h, Math.max(3, w / 120), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

