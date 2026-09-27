// Unit tests for the Simon Says rules. Run: node --test lab/static/tests/simon-says.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCommand, line, judge, words, scoreLine, scoreLines, taunts, calibrationProblem, calibrationIssue, SETUP_LINES, pickFresh, COMMANDS } from "../simon-says.js";

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
  assert.equal(words(42), "forty-two");   // (was left as digits: the voice got "21", 2026-09-26)
  assert.equal(words(100), "100");
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

test("scores past twenty are said in words (the voice was handed '21')", async () => {
  const { words, scoreLine } = await import("../simon-says.js");
  assert.equal(words(21), "twenty-one");
  assert.equal(words(30), "thirty");
  assert.equal(words(99), "ninety-nine");
  assert.doesNotMatch(scoreLine(21, 9), /\d/);
});

test("setup checks there's room for raised arms (the elbows must fit in the picture)", () => {
  // Liz at her desk, 2026-09-26: fits (raised elbows at about 0.41 of the picture height).
  const liz = { yaw: 0.003, shoulderDepth: 0.09, noseY: 0.43, shoulderToNose: 0.31, shoulderWidth: 0.56 };
  assert.equal(calibrationProblem(liz), null);
  // Leaning in close: head high and shoulders wide, so raised elbows would be off the top.
  const close = { yaw: 0, shoulderDepth: 0, noseY: 0.3, shoulderToNose: 0.35, shoulderWidth: 1.2 };
  assert.match(calibrationProblem(close), /Sit back/);
});

test("setup: every calibration problem has fun lines, and so does a good stance", () => {
  for (const issue of ["none", "room", "turned", "look", "ok"]) assert.ok(SETUP_LINES[issue]?.length >= 2, issue);
  assert.equal(calibrationIssue(null), "none");
  assert.equal(calibrationIssue({ yaw: 0, shoulderDepth: 0.2 }), "turned");
  assert.equal(calibrationIssue({ yaw: 0.3, shoulderDepth: 0 }), "look");
  assert.equal(calibrationIssue({ yaw: 0, shoulderDepth: 0 }), null);
});


test("duck sounds: each colour has Pollen's voice bank, and a quack never repeats back to back", async () => {
  const { bankFor, nextChirp, VOICE_BANK } = await import("../duck-sounds.js");
  assert.deepEqual(VOICE_BANK, { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" });
  assert.equal(bankFor("blue"), "duck4");
  assert.equal(bankFor(undefined), "duck1");
  let last = "a";
  for (let i = 0; i < 50; i++) { const c = nextChirp(last); assert.notEqual(c, last); last = c; }
});

test("taunts know who just won: ahead overall but just beaten is 'gaining on me', not 'are you even trying'", () => {
  assert.ok(taunts(47, 33, "you").includes("Uh oh, you're gaining on me!"));
  assert.ok(!taunts(47, 33, "you").includes("Are you even trying?"));
  assert.ok(taunts(47, 33, "simon").includes("Are you even trying?"));
  assert.ok(taunts(10, 20, "you").includes("You're on a roll!"));
  assert.ok(taunts(10, 20, "simon").includes("I'm coming for you!"));
  assert.ok(taunts(5, 5, "you").includes("All square!"));
});
