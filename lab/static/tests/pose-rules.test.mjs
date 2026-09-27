// Unit tests for the pose rules, with hand-built landmarks (no camera needed).
// Run: node --test lab/static/tests/pose-rules.test.mjs
//
// Fixtures are in the *camera's* image coordinates (not mirrored): a person
// facing the camera has their LEFT shoulder on the RIGHT of the image.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePose, evaluatePoseDetailed, baselineFrom, LM, POSE_IDS } from "../pose.js";

const ASPECT = 4 / 3;

function neutral() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.35, z: 0, visibility: 0.99 }));
  const set = (i, x, y, z = 0, v = 0.99) => { lm[i] = { x, y, z, visibility: v }; };
  set(LM.nose, 0.5, 0.35);
  set(LM.leftEye, 0.52, 0.33);
  set(LM.rightEye, 0.48, 0.33);
  set(LM.leftEar, 0.56, 0.34);
  set(LM.rightEar, 0.44, 0.34);
  set(LM.leftShoulder, 0.6, 0.5);
  set(LM.rightShoulder, 0.4, 0.5);
  set(LM.leftElbow, 0.62, 0.65);
  set(LM.rightElbow, 0.38, 0.65);
  set(LM.leftWrist, 0.62, 0.8);
  set(LM.rightWrist, 0.38, 0.8);
  set(LM.leftIndex, 0.62, 0.85);
  set(LM.rightIndex, 0.38, 0.85);
  set(LM.leftHip, 0.57, 0.9);
  set(LM.rightHip, 0.43, 0.9);
  return { lm, set, base: baselineFrom(lm, ASPECT) };
}

const only = (res, ...trueIds) => {
  for (const id of POSE_IDS) {
    assert.equal(res[id], trueIds.includes(id), `${id} should be ${trueIds.includes(id)}`);
  }
};

const check = (lm, base) => evaluatePose(lm, base, ASPECT);

test("neutral stance: nothing", () => {
  const { lm, base } = neutral();
  only(check(lm, base));
});

test("look left (player's left = image right)", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.535, 0.35);
  only(check(lm, base), "look_left");
});

test("look right is NOT look left (the mirror trap)", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.465, 0.35);
  only(check(lm, base), "look_right");
});

test("a small head wobble is not a look", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.51, 0.35);
  only(check(lm, base));
});

test("look up", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.5, 0.315);
  only(check(lm, base), "look_up");
});

test("look down", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.5, 0.385);
  only(check(lm, base), "look_down");
});

// Turning the body: shoulders look narrow, the nearer shoulder (smaller z) shows the direction,
// and the head turns with the body.
function turned(dir) {
  const n = neutral();
  const s = dir === "left" ? 1 : -1;
  n.set(LM.leftShoulder, 0.54, 0.5, 0.2 * s);
  n.set(LM.rightShoulder, 0.46, 0.5, -0.2 * s);
  n.set(LM.nose, 0.5 + 0.04 * s, 0.35);
  return n;
}

test("turn left: right shoulder comes towards the camera", () => {
  const { lm, base } = turned("left");
  only(check(lm, base), "turn_left");
});

test("turn right is NOT turn left", () => {
  const { lm, base } = turned("right");
  only(check(lm, base), "turn_right");
});

test("a 45-degree turn counts (shoulders about 0.77 of their width: flickered at the old 0.75)", () => {
  const { lm, set, base } = turned("right");
  set(LM.leftShoulder, 0.577, 0.5, -0.2);
  set(LM.rightShoulder, 0.423, 0.5, 0.2);
  only(check(lm, base), "turn_right");
});

test("turn direction falls back to the head when shoulder depth is unclear", () => {
  const { lm, set, base } = turned("left");
  set(LM.leftShoulder, 0.54, 0.5, 0);
  set(LM.rightShoulder, 0.46, 0.5, 0);
  only(check(lm, base), "turn_left");
});

test("a body turn is not also a 'look' (head turns with the body)", () => {
  const { lm, base } = turned("left");
  const d = evaluatePoseDetailed(lm, base, ASPECT);
  assert.equal(d.look_left.ok, false);
  assert.match(d.look_left.reason, /whole body/);
});

// Moving nearer or further: the whole person gets bigger or smaller in the frame, around the middle.
const scaled = (lm, k) => lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k }));

test("moving further from the camera is not a turn (everything shrinks, not just the shoulders)", () => {
  const { lm, base } = neutral();
  const r = check(scaled(lm, 0.8), base);
  assert.equal(r.turn_left, false);
  assert.equal(r.turn_right, false);
});

test("everything needs calibrating first", () => {
  const { lm } = neutral();
  const d = evaluatePoseDetailed(lm, null, ASPECT);
  for (const id of POSE_IDS) {
    assert.equal(d[id].ok, false);
    assert.match(d[id].reason, /calibrat/);
  }
});

test("nobody in view: everything false with a reason", () => {
  const d = evaluatePoseDetailed(null);
  for (const id of POSE_IDS) {
    assert.equal(d[id].ok, false);
    assert.match(d[id].reason, /no person/);
  }
});

test("rules hold when calibrated further from the camera (smaller in frame)", () => {
  const { lm, set } = neutral();
  const far = scaled(lm, 0.6);
  const base = baselineFrom(far, ASPECT);
  set(LM.nose, 0.535, 0.35);
  only(check(scaled(lm, 0.6), base), "look_left");
});

test("every result carries the measured number (for tuning)", () => {
  const { lm, base } = neutral();
  const d = evaluatePoseDetailed(lm, base, ASPECT);
  for (const id of POSE_IDS) assert.equal(typeof d[id].value, "number", id);
});

test("right arm up (player's right = image left) is not left arm up", () => {
  const { lm, set, base } = neutral();
  set(LM.rightElbow, 0.38, 0.35); set(LM.rightWrist, 0.38, 0.2);
  only(check(lm, base), "right_arm_up");
});

test("left arm up", () => {
  const { lm, set, base } = neutral();
  set(LM.leftElbow, 0.62, 0.35); set(LM.leftWrist, 0.62, 0.2);
  only(check(lm, base), "left_arm_up");
});

test("both arms up", () => {
  const { lm, set, base } = neutral();
  set(LM.leftWrist, 0.62, 0.2); set(LM.rightWrist, 0.38, 0.2);
  only(check(lm, base), "both_arms_up");   // strict: not also left and right
});

test("a hand resting on the head is not a raised arm", () => {
  const { lm, set, base } = neutral();
  set(LM.rightWrist, 0.47, 0.27);
  assert.equal(check(lm, base).right_arm_up, false);
});

test("looking up a lot is not a body turn", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.5, 0.25);
  const r = check(lm, base);
  assert.equal(r.look_up, true);
  assert.equal(r.turn_left, false);
  assert.equal(r.turn_right, false);
});

test("a strong head turn alone is not a body turn", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.56, 0.35);
  const r = check(lm, base);
  assert.equal(r.look_left, true);
  assert.equal(r.turn_left, false);
});

test("a raised hand out of the top of the frame still counts (the elbow is above the shoulder)", () => {
  const { lm, set, base } = neutral();
  set(LM.rightElbow, 0.38, 0.4); set(LM.rightWrist, 0.38, -0.05, 0, 0.1);   // wrist off the top, not visible
  only(check(lm, base), "right_arm_up");
});

test("both hands out of the top of the frame: both arms up", () => {
  const { lm, set, base } = neutral();
  set(LM.rightElbow, 0.38, 0.4); set(LM.rightWrist, 0.38, -0.05, 0, 0.1);
  set(LM.leftElbow, 0.62, 0.4); set(LM.leftWrist, 0.62, -0.05, 0, 0.1);
  only(check(lm, base), "both_arms_up");
});

test("a lost wrist with the elbow down is not an arm up", () => {
  const { lm, set, base } = neutral();
  set(LM.rightWrist, 0.38, 0.8, 0, 0.1);
  assert.equal(check(lm, base).right_arm_up, false);
});

test("raising the arms never also counts as a head move (arms throw the head reading off)", () => {
  const { lm, set, base } = neutral();
  set(LM.leftWrist, 0.62, 0.2); set(LM.rightWrist, 0.38, 0.2);
  set(LM.nose, 0.5, 0.385);   // the head reading jumps as the arms go past the face
  only(check(lm, base), "both_arms_up");
});
