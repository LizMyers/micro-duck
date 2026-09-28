// The game's defensive guards (2026-09-26), run against a fake page, camera and voice:
// one game at a time, a stopped game can't keep going, and leaving the camera's view voids the round.
import { test } from "node:test";
import assert from "node:assert/strict";

// A tiny fake DOM: every element accepts whatever the game sets on it.
const el = () => ({ style: {}, textContent: "", disabled: false, click() {}, replaceChildren() {}, append() {},
  animate: () => ({ finished: Promise.resolve() }) });
const els = new Map();
globalThis.document = {
  getElementById: (id) => (els.has(id) ? els.get(id) : els.set(id, el()).get(id)),
  createElement: el,
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.setInterval = () => 0;   // each game's 1 s "ready" refresh would keep the test process alive

const { SimonSaysGame } = await import("../simon-says.js");

function fakeApp({ body = true } = {}) {
  const notes = [];
  const tracker = { latest: body ? { landmarks: [] } : null, since: () => null, held: () => false,
    check: () => ({ value: 0 }), tilt: () => null };
  const app = {
    notes, tracker: () => tracker, trackerObj: tracker,
    ready: () => null, prepare: async () => null,
    calibrate: () => { app.calibrations++; return { yaw: 0, pitch: 0, shoulderDepth: 0, facePitch: 0 }; },
    sayLine: () => ({ started: Promise.resolve(true), done: Promise.resolve("") }),
    prepareLine: async () => true, isBad: () => false, thresholds: { pitch: 0.12, look: 0.2 },
    lookAt() {}, celebrate() {}, gameOver() {}, note: (t) => notes.push(t),
    calibrations: 0,
  };
  return app;
}
const count = (notes, text) => notes.filter((n) => n.includes(text)).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("two starts at once (double click, or click + voice) make one game", async () => {
  const app = fakeApp();
  const game = new SimonSaysGame(app);
  game.start(); game.start();          // the second arrives during setup
  assert.equal(game.startByVoice(), "already playing");   // and so does a voice "let's play"
  await sleep(3000);                   // setup: countdown 3 × 0.8 s
  assert.equal(count(app.notes, "game started"), 1);
  game.stop("test over");
});

test("a stopped game's steps can't carry on into the next game", () => {
  const game = new SimonSaysGame(fakeApp());
  game.running = true; game.gameId = 7;
  game.stop("Stopped.");
  game.running = true;                 // a new game is running now...
  assert.equal(game.isLive(7), false); // ...but game 7's leftover steps know they're over
  game.stop();                         // a second stop is harmless
  game.stop();
});

test("leaving the camera's view mid-round voids the round instead of 'Too slow!'", async () => {
  const app = fakeApp();
  const game = new SimonSaysGame(app);
  const started = game.start();
  await sleep(3000);                   // past setup: rounds are running now
  app.trackerObj.latest = null;        // the player walks out of view
  await sleep(4500);
  assert.ok(count(app.notes, "lost sight of you") >= 1, app.notes.join("\n"));
  assert.equal(count(app.notes, "Too slow"), 0);
  game.stop("test over");
  await started;
});

test("a head move stuck on between rounds recalibrates (a bad stance can't hide a real move)", async () => {
  const app = fakeApp();
  app.trackerObj.held = (pose) => pose === "look_up";   // "look up" reads as on the whole time
  const game = new SimonSaysGame(app);
  const started = game.start();
  await sleep(7000);                   // setup (2.4 s) + the 3 s neutral wait before round 1
  assert.ok(count(app.notes, "recalibrated") >= 1, app.notes.join("\n"));
  assert.ok(app.calibrations >= 2);    // the countdown's, then the correction
  game.stop("test over");
  await started;
});

test("game page: a voice start can't skip camera setup (it did, and every move went unseen)", async () => {
  const app = fakeApp();
  let asked = 0;
  Object.assign(app, { setupOnPage: true, isSetUp: () => false, needSetup: () => asked++ });
  const game = new SimonSaysGame(app);
  const status = game.startByVoice();
  assert.match(status, /camera isn't set up/);
  assert.doesNotMatch(status, /the player turns/);   // worded for Simon to pass on, not a note
  assert.equal(asked, 1);                       // the page showed the setup
  await game.start();                           // a click can't skip it either
  assert.equal(count(app.notes, "game started"), 0);
  app.isSetUp = () => true;                     // once set up, the voice start works
  assert.equal(game.startByVoice(), "starting");
  await sleep(100);
  game.stop("test over");
});

test("game page events: playing, each round (never whether it's a trap), its result, and stopped", async () => {
  const app = fakeApp();
  const events = [];
  app.onGame = (ev) => events.push(ev);
  const game = new SimonSaysGame(app);
  const started = game.start();
  await sleep(7500);                   // setup (2.4 s) + a round's 4 s window
  const types = events.map((e) => e.type);
  assert.ok(types.includes("playing"), types.join(","));
  const round = events.find((e) => e.type === "round");
  assert.ok(round && round.round === 1 && round.move && round.pose, JSON.stringify(round));
  assert.equal("says" in round, false);               // the screen mustn't give a trap away
  assert.ok(types.includes("result"), types.join(","));
  game.stop("test over");
  await started;
  const last = events.filter((e) => e.type === "stopped" || e.type === "over");
  assert.ok(last.length >= 1, types.join(","));
});

test("during a game only game lines speak: a chat reply is cut, game lines and chat outside a game are not", async () => {
  const { hushDuringGame } = await import("../core.js");
  assert.equal(hushDuringGame({ conversationId: "conv_1", gameActive: true, line: null }), true);          // chat mid-game
  assert.equal(hushDuringGame({ conversationId: null, gameActive: true, line: { text: "Nice one!" } }), false); // a game line
  assert.equal(hushDuringGame({ conversationId: "conv_1", gameActive: false, line: null }), false);         // chat between games
});

test("pre-warm covers the scores two games ahead (a quick rematch finds its score ready)", async () => {
  const { scoreLine } = await import("../simon-says.js");
  const game = new SimonSaysGame(fakeApp());
  game.board.totals = { simon: 10, you: 5 };
  const lines = game.linesToWarm();
  for (const [s, y] of [[11, 5], [10, 6], [12, 5], [11, 6], [10, 7]]) assert.ok(lines.includes(scoreLine(s, y)), `${s}-${y}`);
});

test("pre-warm covers every taunt, so a new one is never made live mid-game", async () => {
  const { taunts } = await import("../simon-says.js");
  const lines = new SimonSaysGame(fakeApp()).linesToWarm();
  for (const t of [...taunts(9, 1, "simon"), ...taunts(9, 1, "you"), ...taunts(1, 9, "you"), ...taunts(1, 9, "simon"), ...taunts(5, 5)])
    assert.ok(lines.includes(t), t);
});

test("a made-up line's run-on limit follows its words (2.5 s to 7 s)", async () => {
  const { freeMax } = await import("../core.js");
  assert.ok(Math.abs(freeMax("Aw shucks! You won, way to go!") - 4.85) < 1e-9);   // 7 words: 4.85 s, not the old flat 7 s
  assert.equal(freeMax("Ha!"), 2.5);                                          // never shorter than 2.5 s
  assert.equal(freeMax("one two three four five six seven eight nine ten eleven twelve"), 7);   // never longer than 7 s
});

test("a cut background line while you talk: Simon answers you (the agent dropped your turn)", async () => {
  const { answerAfterCut } = await import("../core.js");
  assert.equal(answerAfterCut({ silent: true, cut: true, waiting: true, speaking: false }), "now");
  assert.equal(answerAfterCut({ silent: true, cut: true, waiting: false, speaking: true }), "when-heard");
  assert.equal(answerAfterCut({ silent: true, cut: true, waiting: false, speaking: false }), null);   // nobody waiting
  assert.equal(answerAfterCut({ silent: false, cut: true, waiting: true, speaking: false }), null);  // a heard line
  assert.equal(answerAfterCut({ silent: true, cut: false, waiting: true, speaking: false }), null);  // finished fine
});
