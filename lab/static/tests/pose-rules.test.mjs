// Unit tests for the pose rules, with hand-built landmarks (no camera needed).
// Run: node --test lab/static/tests/
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

// Everyone standing normally counts as "stand up", so most tests expect that too.
const check = (lm, base) => evaluatePose(lm, base, ASPECT);

test("neutral stance: only 'stand up'", () => {
  const { lm, base } = neutral();
  only(check(lm, base), "stand_up");
});

test("look left (player's left = image right)", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.535, 0.35);
  only(check(lm, base), "look_left", "stand_up");
});

test("look right is NOT look left (the mirror trap)", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.465, 0.35);
  only(check(lm, base), "look_right", "stand_up");
});

test("a small head wobble is not a look", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.51, 0.35);
  only(check(lm, base), "stand_up");
});

test("look up", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.5, 0.315);
  only(check(lm, base), "look_up", "stand_up");
});

test("look down", () => {
  const { lm, set, base } = neutral();
  set(LM.nose, 0.5, 0.385);
  only(check(lm, base), "look_down", "stand_up");
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
  only(check(lm, base), "turn_left", "stand_up");
});

test("turn right is NOT turn left", () => {
  const { lm, base } = turned("right");
  only(check(lm, base), "turn_right", "stand_up");
});

test("turn direction falls back to the head when shoulder depth is unclear", () => {
  const { lm, set, base } = turned("left");
  set(LM.leftShoulder, 0.54, 0.5, 0);
  set(LM.rightShoulder, 0.46, 0.5, 0);
  only(check(lm, base), "turn_left", "stand_up");
});

test("a body turn is not also a 'look' (head turns with the body)", () => {
  const { lm, base } = turned("left");
  const d = evaluatePoseDetailed(lm, base, ASPECT);
  assert.equal(d.look_left.ok, false);
  assert.match(d.look_left.reason, /whole body/);
});

// Stepping: the whole person gets bigger or smaller in the frame, around the middle.
const scaled = (lm, k) => lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k }));

test("step forward: you look bigger", () => {
  const { lm, base } = neutral();
  only(check(scaled(lm, 1.25), base), "step_forward", "stand_up");
});

test("step back: you look smaller", () => {
  const { lm, base } = neutral();
  only(check(scaled(lm, 0.8), base), "step_back", "stand_up");
});

test("stepping back is not a turn (everything shrinks, not just the shoulders)", () => {
  const { lm, base } = neutral();
  const r = check(scaled(lm, 0.8), base);
  assert.equal(r.turn_left, false);
  assert.equal(r.turn_right, false);
});

test("sit down: head drops well below the calibrated standing height", () => {
  const { lm, base } = neutral();
  const low = lm.map((p) => ({ ...p, y: p.y + 0.15 }));
  only(check(low, base), "sit_down");
});

test("a small dip is not sitting, and still counts as standing", () => {
  const { lm, base } = neutral();
  const dip = lm.map((p) => ({ ...p, y: p.y + 0.04 }));
  only(check(dip, base), "stand_up");
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
  only(check(scaled(lm, 0.6), base), "look_left", "stand_up");
});

test("every result carries the measured number (for tuning)", () => {
  const { lm, base } = neutral();
  const d = evaluatePoseDetailed(lm, base, ASPECT);
  for (const id of POSE_IDS) assert.equal(typeof d[id].value, "number", id);
});
