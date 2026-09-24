// Webcam pose tracking for Simon Says (webcam edition).
//
// Google's MediaPipe PoseLandmarker runs *inside the browser* on the webcam
// feed: 33 body points (nose, eyes, shoulders, elbows, wrists, hips, ...)
// about 30 times a second. No video ever leaves this page.
//
// The rules that decide "is this person raising their right arm?" live in
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
  nose: 0, leftEye: 2, rightEye: 5,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24,
};

export const POSE_IDS = [
  "right_arm_up", "left_arm_up", "both_arms_up", "wings", "touch_head", "cover_eyes", "crouch",
];

export const POSE_LABELS = {
  right_arm_up: "Raise your right arm",
  left_arm_up: "Raise your left arm",
  both_arms_up: "Raise both arms",
  wings: "Flap your wings",
  touch_head: "Touch your head",
  cover_eyes: "Cover your eyes",
  crouch: "Crouch down",
};

const VISIBLE = 0.5;

// Skeleton lines drawn over the video.
const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [15, 19], [16, 20], [0, 2], [0, 5],
];

// ---------- The rules (pure functions) ------------------------------------------------------

// Landmarks are normalised to the image (x: 0..1 of width, y: 0..1 of height,
// y grows downward). `aspect` = width / height, so distances are measured in
// the same units both ways.
function makeGeom(lm, aspect) {
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const vis = (...ids) => ids.every((i) => lm[i] && (lm[i].visibility ?? 1) > VISIBLE);
  const conf = (...ids) => Math.min(...ids.map((i) => (lm[i] ? lm[i].visibility ?? 1 : 0)));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return { P, vis, conf, dist };
}

function result(ok, confidence, reason) {
  return { ok: !!ok, confidence: Math.max(0, Math.min(1, confidence)), reason };
}

// Returns { poseId: {ok, confidence, reason} } for every pose.
// `baseline` (from calibrate()) is only needed for crouch.
export function evaluatePoseDetailed(lm, baseline = null, aspect = 4 / 3) {
  const out = {};
  if (!lm || lm.length < 25) {
    for (const id of POSE_IDS) out[id] = result(false, 0, "no person in view");
    return out;
  }
  const { P, vis, conf, dist } = makeGeom(lm, aspect);
  const shouldersSeen = vis(LM.leftShoulder, LM.rightShoulder);
  const ls = P(LM.leftShoulder), rs = P(LM.rightShoulder);
  // Shoulder width is our ruler, so the rules work near or far from the camera.
  const sw = shouldersSeen ? dist(ls, rs) : baseline?.shoulderWidth ?? 0;
  const midX = (ls.x + rs.x) / 2;
  const shoulderY = (ls.y + rs.y) / 2;

  const armUp = (side) => {
    const s = side === "left" ? LM.leftShoulder : LM.rightShoulder;
    const w = side === "left" ? LM.leftWrist : LM.rightWrist;
    if (!vis(s, w) || !sw) return result(false, conf(s, w), `${side} wrist or shoulder not visible`);
    const up = P(s).y - P(w).y; // positive = wrist above shoulder
    if (up <= 0.35 * sw) return result(false, conf(s, w), `${side} wrist isn't above the ${side} shoulder`);
    // A hand resting on the head is "touch your head", not a raised arm.
    if (vis(LM.nose) && dist(P(w), P(LM.nose)) < 0.7 * sw) {
      return result(false, conf(s, w), `${side} hand is on the head, not raised`);
    }
    return result(true, conf(s, w), `${side} wrist is above the ${side} shoulder`);
  };

  const right = armUp("right");
  const left = armUp("left");
  out.right_arm_up = right;
  out.left_arm_up = left;
  out.both_arms_up = right.ok && left.ok
    ? result(true, Math.min(right.confidence, left.confidence), "both wrists above shoulders")
    : result(false, Math.min(right.confidence, left.confidence), "needs both wrists above shoulders");

  // Wings: both wrists out wide at about shoulder height, each on its own side.
  {
    const ids = [LM.leftShoulder, LM.rightShoulder, LM.leftWrist, LM.rightWrist];
    if (!vis(...ids) || !sw) {
      out.wings = result(false, conf(...ids), "wrists or shoulders not visible");
    } else {
      const wide = (w, s) => {
        const pw = P(w), ps = P(s);
        const sameSide = Math.sign(pw.x - midX) === Math.sign(ps.x - midX);
        return sameSide && Math.abs(pw.x - midX) > 1.2 * sw && Math.abs(pw.y - shoulderY) < 0.6 * sw;
      };
      const ok = wide(LM.leftWrist, LM.leftShoulder) && wide(LM.rightWrist, LM.rightShoulder);
      out.wings = result(ok, conf(...ids), ok ? "arms out wide like wings" : "arms aren't out wide at shoulder height");
    }
  }

  // A hand point: the index fingertip if seen, else the wrist.
  const hand = (side) => {
    const idx = side === "left" ? LM.leftIndex : LM.rightIndex;
    const w = side === "left" ? LM.leftWrist : LM.rightWrist;
    if (vis(idx)) return { p: P(idx), c: conf(idx) };
    if (vis(w)) return { p: P(w), c: conf(w) };
    return null;
  };
  // Eye positions are still estimated when the eyes are covered, so we don't
  // insist the eyes themselves are "visible" (that's the point of covering them).
  const eyeMid = { x: (P(LM.leftEye).x + P(LM.rightEye).x) / 2, y: (P(LM.leftEye).y + P(LM.rightEye).y) / 2 };

  // Touch your head: a hand above the eye line, close to the head.
  {
    if (!vis(LM.nose) || !sw) {
      out.touch_head = result(false, conf(LM.nose), "face not visible");
    } else {
      const nose = P(LM.nose);
      const hits = ["left", "right"].map(hand).filter(Boolean)
        .filter((h) => h.p.y < eyeMid.y - 0.1 * sw && dist(h.p, nose) < 0.8 * sw);
      out.touch_head = hits.length
        ? result(true, Math.max(...hits.map((h) => h.c)), "a hand is on top of the head")
        : result(false, conf(LM.nose), "no hand on the head");
    }
  }

  // Cover your eyes: both hands over the eyes.
  {
    const l = hand("left"), r = hand("right");
    if (!l || !r || !sw) {
      out.cover_eyes = result(false, 0, "hands not visible");
    } else {
      const near = (h) => dist(h.p, eyeMid) < 0.6 * sw;
      const ok = near(l) && near(r);
      out.cover_eyes = result(ok, Math.min(l.c, r.c), ok ? "both hands over the eyes" : "hands aren't over the eyes");
    }
  }

  // Crouch: the head has dropped well below where it was when calibrated.
  {
    if (!baseline) {
      out.crouch = result(false, 0, "needs calibrating first");
    } else if (!vis(LM.nose)) {
      out.crouch = result(false, conf(LM.nose), "face not visible");
    } else {
      const drop = P(LM.nose).y - baseline.noseY;
      const need = Math.max(0.6 * baseline.shoulderToNose, 0.3 * baseline.shoulderWidth);
      out.crouch = drop > need
        ? result(true, conf(LM.nose), "head is well below its standing height")
        : result(false, conf(LM.nose), "head hasn't dropped enough");
    }
  }
  return out;
}

// Just the yes/no answers: { poseId: boolean }.
export function evaluatePose(lm, baseline = null, aspect = 4 / 3) {
  const d = evaluatePoseDetailed(lm, baseline, aspect);
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.ok]));
}

// Neutral stance, used by relative checks (crouch). Null if not enough is visible.
export function baselineFrom(lm, aspect = 4 / 3) {
  if (!lm) return null;
  const { P, vis, dist } = makeGeom(lm, aspect);
  if (!vis(LM.nose, LM.leftShoulder, LM.rightShoulder)) return null;
  const ls = P(LM.leftShoulder), rs = P(LM.rightShoulder), nose = P(LM.nose);
  return {
    noseY: nose.y,
    shoulderWidth: dist(ls, rs),
    shoulderToNose: (ls.y + rs.y) / 2 - nose.y,
  };
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
      for (const id of POSE_IDS) {
        if (poses[id].ok) this._since[id] ??= now;
        else delete this._since[id];
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
