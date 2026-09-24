// Unit tests for the Simon Says rules. Run: node --test lab/static/tests/simon-says.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCommand, line, judge, COMMANDS } from "../simon-says.js";

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test("the four outcomes", () => {
  assert.equal(judge(true, true).point, true);     // Simon says, you did it
  assert.equal(judge(true, false).point, false);   // Simon says, you didn't
  assert.equal(judge(false, true).point, false);   // trap, you moved: out
  assert.equal(judge(false, false).point, true);   // trap, you stayed still
});

test("lines: 'Simon says' only when he says it", () => {
  assert.equal(line({ pose: "look_left", says: true }), "Simon says, look left.");
  assert.equal(line({ pose: "look_left", says: false }), "Look left!");
});

test("no sitting or standing (played at a desk)", () => {
  for (let i = 0; i < 200; i++) assert.ok(!["sit_down", "stand_up"].includes(nextCommand(Math.random).pose));
});

test("never the same command twice in a row", () => {
  for (let i = 0; i < 200; i++) assert.notEqual(nextCommand(Math.random, { last: "look_up" }).pose, "look_up");
});

test("about 70% are real 'Simon says'", () => {
  assert.equal(nextCommand(seq(0.69, 0)).says, true);
  assert.equal(nextCommand(seq(0.71, 0)).says, false);
  assert.ok(Object.keys(COMMANDS).length === 9);
});

test("the other arm is 'wrong move', not 'too slow'", () => {
  const r = judge(true, false, "left_arm_up");
  assert.equal(r.point, false);
  assert.match(r.text, /Wrong move: that was your left arm/);
  assert.equal(judge(true, false).text, "Too slow!");
});

test("both arms on a single-arm command is a wrong move", () => {
  assert.match(judge(true, false, "both_arms_up").text, /Wrong move: that was both arms/);
});
