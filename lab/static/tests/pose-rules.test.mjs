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
  const set = (i, x, y, v = 0.99) => { lm[i] = { x, y, z: 0, visibility: v }; };
  set(LM.nose, 0.5, 0.35);
  set(LM.leftEye, 0.52, 0.33);
  set(LM.rightEye, 0.48, 0.33);
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
  return { lm, set };
}

const only = (res, ...trueIds) => {
  for (const id of POSE_IDS) {
    assert.equal(res[id], trueIds.includes(id), `${id} should be ${trueIds.includes(id)}`);
  }
};

test("neutral stance matches nothing", () => {
  const { lm } = neutral();
  only(evaluatePose(lm, baselineFrom(lm, ASPECT), ASPECT));
});

test("right arm up (person's right = image left)", () => {
  const { lm, set } = neutral();
  set(LM.rightElbow, 0.38, 0.35); set(LM.rightWrist, 0.38, 0.2); set(LM.rightIndex, 0.38, 0.17);
  only(evaluatePose(lm, null, ASPECT), "right_arm_up");
});

test("left arm up is NOT right arm up (left/right confusion)", () => {
  const { lm, set } = neutral();
  set(LM.leftElbow, 0.62, 0.35); set(LM.leftWrist, 0.62, 0.2); set(LM.leftIndex, 0.62, 0.17);
  const r = evaluatePose(lm, null, ASPECT);
  assert.equal(r.left_arm_up, true);
  assert.equal(r.right_arm_up, false);
  assert.equal(r.both_arms_up, false);
});

test("both arms up", () => {
  const { lm, set } = neutral();
  set(LM.leftWrist, 0.62, 0.2); set(LM.leftIndex, 0.62, 0.17);
  set(LM.rightWrist, 0.38, 0.2); set(LM.rightIndex, 0.38, 0.17);
  only(evaluatePose(lm, null, ASPECT), "right_arm_up", "left_arm_up", "both_arms_up");
});

test("arm only slightly lifted (wrist at shoulder height) is not 'up'", () => {
  const { lm, set } = neutral();
  set(LM.rightWrist, 0.3, 0.48); set(LM.rightIndex, 0.28, 0.48);
  assert.equal(evaluatePose(lm, null, ASPECT).right_arm_up, false);
});

test("hidden wrist can't count as raised", () => {
  const { lm, set } = neutral();
  set(LM.rightWrist, 0.38, 0.2, 0.2);
  const d = evaluatePoseDetailed(lm, null, ASPECT).right_arm_up;
  assert.equal(d.ok, false);
  assert.match(d.reason, /not visible/);
});

test("wings: both wrists out wide at shoulder height", () => {
  const { lm, set } = neutral();
  set(LM.leftElbow, 0.7, 0.5); set(LM.leftWrist, 0.8, 0.5); set(LM.leftIndex, 0.84, 0.5);
  set(LM.rightElbow, 0.3, 0.5); set(LM.rightWrist, 0.2, 0.5); set(LM.rightIndex, 0.16, 0.5);
  only(evaluatePose(lm, null, ASPECT), "wings");
});

test("wings needs BOTH arms out", () => {
  const { lm, set } = neutral();
  set(LM.leftWrist, 0.8, 0.5); set(LM.leftIndex, 0.84, 0.5);
  assert.equal(evaluatePose(lm, null, ASPECT).wings, false);
});

test("arms crossed wide (wrists on the wrong sides) is not wings", () => {
  const { lm, set } = neutral();
  set(LM.leftWrist, 0.2, 0.5); set(LM.rightWrist, 0.8, 0.5);
  set(LM.leftIndex, 0.16, 0.5); set(LM.rightIndex, 0.84, 0.5);
  assert.equal(evaluatePose(lm, null, ASPECT).wings, false);
});

test("wings with arms too low (hands out at hip height) doesn't count", () => {
  const { lm, set } = neutral();
  set(LM.leftWrist, 0.8, 0.8); set(LM.leftIndex, 0.84, 0.82);
  set(LM.rightWrist, 0.2, 0.8); set(LM.rightIndex, 0.16, 0.82);
  assert.equal(evaluatePose(lm, null, ASPECT).wings, false);
});

test("touch head with one hand", () => {
  const { lm, set } = neutral();
  set(LM.rightElbow, 0.35, 0.35); set(LM.rightWrist, 0.45, 0.28); set(LM.rightIndex, 0.47, 0.25);
  only(evaluatePose(lm, null, ASPECT), "touch_head");
});

test("an arm straight up is not touching the head", () => {
  const { lm, set } = neutral();
  set(LM.rightWrist, 0.38, 0.1); set(LM.rightIndex, 0.38, 0.07);
  const r = evaluatePose(lm, null, ASPECT);
  assert.equal(r.touch_head, false);
  assert.equal(r.right_arm_up, true);
});

test("cover eyes (eyes themselves hidden)", () => {
  const { lm, set } = neutral();
  set(LM.leftEye, 0.52, 0.33, 0.2); set(LM.rightEye, 0.48, 0.33, 0.2);
  set(LM.leftWrist, 0.56, 0.42); set(LM.leftIndex, 0.52, 0.34);
  set(LM.rightWrist, 0.44, 0.42); set(LM.rightIndex, 0.48, 0.34);
  const r = evaluatePose(lm, null, ASPECT);
  assert.equal(r.cover_eyes, true);
  assert.equal(r.touch_head, false);
});

test("one hand over the eyes isn't enough", () => {
  const { lm, set } = neutral();
  set(LM.rightWrist, 0.44, 0.42); set(LM.rightIndex, 0.48, 0.34);
  assert.equal(evaluatePose(lm, null, ASPECT).cover_eyes, false);
});

test("crouch: head drops well below the calibrated standing height", () => {
  const { lm } = neutral();
  const base = baselineFrom(lm, ASPECT);
  const low = lm.map((p) => ({ ...p, y: p.y + 0.15 }));
  only(evaluatePose(low, base, ASPECT), "crouch");
});

test("a small nod or dip is not a crouch", () => {
  const { lm } = neutral();
  const base = baselineFrom(lm, ASPECT);
  const dip = lm.map((p) => ({ ...p, y: p.y + 0.04 }));
  assert.equal(evaluatePose(dip, base, ASPECT).crouch, false);
});

test("crouch needs calibrating first", () => {
  const { lm } = neutral();
  const low = lm.map((p) => ({ ...p, y: p.y + 0.15 }));
  const d = evaluatePoseDetailed(low, null, ASPECT).crouch;
  assert.equal(d.ok, false);
  assert.match(d.reason, /calibrat/);
});

test("nobody in view: everything false with a reason", () => {
  const d = evaluatePoseDetailed(null);
  for (const id of POSE_IDS) {
    assert.equal(d[id].ok, false);
    assert.match(d[id].reason, /no person/);
  }
});

test("rules hold when the person is further from the camera (smaller in frame)", () => {
  const { lm, set } = neutral();
  set(LM.rightWrist, 0.38, 0.2); set(LM.rightIndex, 0.38, 0.17);
  const small = lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.5, y: 0.5 + (p.y - 0.5) * 0.5 }));
  only(evaluatePose(small, null, ASPECT), "right_arm_up");
});
