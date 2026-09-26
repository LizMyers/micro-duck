// Unit tests for the Simon Says rules. Run: node --test lab/static/tests/simon-says.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCommand, line, judge, words, scoreLine, scoreLines, taunts, calibrationProblem, pickFresh, COMMANDS } from "../simon-says.js";

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

test("strict traps: any move on a trap is out, not just that move", () => {
  const r = judge(false, false, "look_right");
  assert.equal(r.point, false);
  assert.match(r.text, /Simon didn't say! \(You did look right/);
  assert.equal(judge(false, false).point, true);   // stayed still: safe
});

test("scores are spoken as words", () => {
  assert.equal(words(3), "three");
  assert.equal(words(0), "zero");
  assert.equal(words(42), "42");
});

test("the score is its own line; taunts have no numbers", () => {
  assert.equal(scoreLine(7, 0), "Seven for me, zero for you.");
  assert.equal(scoreLine(2, 2), "Two all.");
  assert.equal(scoreLine(1, 3), "You lead three to one.");
  for (const [a, b] of [[1, 0], [3, 3], [0, 4]]) {
    assert.match(scoreLine(a, b), new RegExp(`${words(a)}|${words(b)}`, "i"));
    for (const taunt of taunts(a, b)) assert.doesNotMatch(taunt, /zero|one|two|three|four|five|six|seven|eight|nine|\d/i);
  }
  assert.ok(taunts(5, 0).includes("Are you even trying?"));
  assert.ok(taunts(0, 5).includes("I'm coming for you!"));
});

test("pickFresh never repeats the last pick", () => {
  const list = ["a", "b", "c"];
  for (let i = 0; i < 50; i++) assert.notEqual(pickFresh(list, "b"), "b");
  assert.equal(pickFresh(["only"], "only"), "only");
});

test("every score has a second wording to fall back on", () => {
  for (const [a, b] of [[6, 1], [2, 2], [1, 4]]) {
    const all = scoreLines(a, b);
    assert.ok(all.length >= 2);
    assert.equal(all[0], scoreLine(a, b));
    assert.equal(new Set(all).size, all.length);
  }
  assert.deepEqual(scoreLines(6, 1), ["Six for me, one for you.", "It's six to one in my favor.", "It's six to one."]);
});

test("calibration: Liz's real stances, one good and one taken while turned", () => {
  const good = { yaw: -0.019, pitch: -0.151, shoulderDepth: -0.044 };   // 2026-09-26, facing the camera
  const turned = { yaw: 0.081, pitch: -0.321, shoulderDepth: 0.174 };  // same day: then "look right" all game
  assert.equal(calibrationProblem(good), null);
  assert.match(calibrationProblem(turned), /face me/);
  assert.match(calibrationProblem({ yaw: 0.3, shoulderDepth: 0 }), /straight at me/);
  assert.match(calibrationProblem(null), /can't see you/);
});
