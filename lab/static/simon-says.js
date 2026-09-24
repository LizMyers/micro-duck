// Simon Says, single player (v1).
//
// The page is the game master, not the language model: it picks each command, decides whether
// it's a "Simon says" or a trap, has Simon speak the exact line, and lets the webcam referee
// judge a short window. The model only provides Simon's voice (an out-of-band reply, so the
// game never grows his conversation history and replies stay fast).

// The v1 vocabulary (notes/ideas.md): things both Simon and the player can do, and the camera can judge.
// Sit down / stand up are left out: the game is played sitting at a desk (Liz: standing up takes too long).
export const COMMANDS = {
  look_up: "look up", look_down: "look down", look_left: "look left", look_right: "look right",
  turn_left: "turn left", turn_right: "turn right",
  // Arms are easy at a desk. Simon has no arms, so he calls these but can't demonstrate them.
  left_arm_up: "raise your left arm", right_arm_up: "raise your right arm", both_arms_up: "raise both arms",
};

const SAYS_CHANCE = 0.7;     // how often it's a real "Simon says" (the rest are traps)
const START_WINDOW = 3000;   // ms to do the move, counted from when Simon FINISHES speaking
const MIN_WINDOW = 2000;
const ROUNDS = 5;            // a short game for testing: get all 5 right and you win
const HOLD = 300;            // a pose must be held this long to count

// Pick the next command (never the same one twice in a row).
export function nextCommand(rand, { last = null } = {}) {
  const says = rand() < SAYS_CHANCE;
  const pool = Object.keys(COMMANDS).filter((p) => p !== last);
  return { pose: pool[Math.floor(rand() * pool.length)], says };
}

export function line({ pose, says }) {
  const phrase = COMMANDS[pose];
  return says ? `Simon says, ${phrase}.` : `${phrase[0].toUpperCase()}${phrase.slice(1)}!`;
}

// The rules: do it when Simon says, don't when he doesn't.
// `wrong` = a different move the player made instead (e.g. the other arm), so the message is fair.
export function judge(says, seen, wrong = null) {
  if (says && seen) return { point: true, text: "Nice!" };
  if (says && wrong) return { point: false, text: `Wrong move: that was ${LABEL[wrong]}!`, wrong };
  if (says && !seen) return { point: false, text: "Too slow!" };
  if (!says && seen) return { point: false, text: "Simon didn't say!" };
  return { point: true, text: "Good: Simon didn't say!" };
}

// How the game names each move when it tells you what you did instead.
const LABEL = {
  look_up: "look up", look_down: "look down", look_left: "look left", look_right: "look right",
  turn_left: "turn left", turn_right: "turn right",
  left_arm_up: "your left arm", right_arm_up: "your right arm", both_arms_up: "both arms",
};

// Quick acknowledgements (exact, so they're cached and instant after the first time).
const OKS = ["OK!", "Got it!", "Nice one!", "Good!"];

const MIRROR = { look_up: "up", look_down: "down", look_left: "right", look_right: "left" };
const MOVING = ["look_up", "look_down", "look_left", "look_right", "turn_left", "turn_right",
  "left_arm_up", "right_arm_up", "both_arms_up"];

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SimonSaysGame {
  /** @param {{ tracker(): any, ready(): string|null, sayLine(text: string): {started: Promise<boolean>, done: Promise<void>},
   *            lookAt(dir: string|null): void, prepare(): Promise<void>, note(text: string, data?: any): void }} app */
  constructor(app) {
    this.app = app;
    this.running = false;
    this.board = new Scoreboard();
    $("ss-start").onclick = () => (this.running ? this.stop("Stopped.") : this.start());
    setInterval(() => this.showReady(), 1000);
  }

  showReady() {
    if (this.running) return;
    const problem = this.app.ready();
    $("ss-start").disabled = !!problem;
    $("ss-ready").textContent = problem || "Ready. Face the camera, looking straight ahead.";
  }

  async start() {
    $("ss-start").disabled = true;
    this.render("Starting the camera… face it, looking straight ahead.", "");
    const problem = await this.app.prepare();
    $("ss-start").disabled = false;
    if (problem) return this.render(problem, "");
    Object.assign(this, { running: true, score: 0, out: false, window: START_WINDOW, last: null, round: 0 });
    $("ss-start").textContent = "Stop game";
    this.render("Get ready…", "");
    this.app.note("🎲 Simon Says: game started");
    await this.speak("Let's play Simon Says!");
    // One mistake and you're out (classic rules). Survive all the rounds and you win.
    while (this.running && !this.out && this.round < ROUNDS) await this.playRound();
    if (!this.running) return;
    // Who won goes on the all-time scoreboard. Simon improvises a reaction (told plainly who won),
    // then reads the result as a fixed line, so it's never unclear.
    const simonWon = this.out;
    this.board.add(simonWon ? "simon" : "you");
    const { simon, you } = this.board.totals;
    const tally = `All-time score: Simon ${simon}, you ${you}.`;
    if (simonWon) {
      this.render("Simon wins!", `You got ${this.score} of ${ROUNDS}.`);
      this.app.celebrate();
      await this.speak(`${this.outLine} Say clearly that you, Simon, win this game.`, { improvise: true });
      await this.speak(`Simon wins! ${tally}`);
    } else {
      this.render("You win!", `All ${ROUNDS} right.`);
      await this.speak(`The player got all ${ROUNDS} rounds right, so the player wins this game and you lose. ` +
        "Congratulate them, a little grudgingly, and say clearly that they win.", { improvise: true });
      await this.speak(`You win! ${tally}`);
    }
    this.stop(null);
  }

  stop(message) {
    this.running = false;
    this.app.lookAt(null);
    $("ss-start").textContent = "Start game";
    if (message) this.render(message, "");
    this.app.note(`🎲 Simon Says: game over, score ${this.score}`);
  }

  async speak(text, opts) {
    const { started, done } = this.app.sayLine(text, opts);
    if (await started) await done;
  }

  async playRound() {
    const tracker = this.app.tracker();
    // Back to neutral first (up to 3 s), so the last move can't count for this one.
    for (let t = 0; t < 3000 && MOVING.some((p) => tracker.held(p, HOLD)); t += 100) await sleep(100);
    if (!this.running) return;

    const cmd = nextCommand(Math.random, { last: this.last });
    this.last = cmd.pose;
    this.round++;
    const text = line(cmd);
    this.render(text, "");
    this.app.note(`🎲 round ${this.round}: "${text}" (${cmd.says ? "do it" : "trap: don't move"})`);

    const { started, done } = this.app.sayLine(text);
    if (!(await started)) {           // no audio within 15 s: skip rather than judge unfairly
      this.render("Simon didn't answer. Is the model READY?", "");
      return this.stop(null);
    }
    // Sometimes Simon demonstrates a look (even on a trap: that's the trick).
    const demo = MIRROR[cmd.pose] && Math.random() < 0.5;
    if (demo) this.app.lookAt(MIRROR[cmd.pose]);

    // Watch from the first word (moving early on a trap still counts), but the clock only starts
    // when Simon has finished the sentence: then you get `window` ms.
    let deadline = Infinity;
    done.then(() => { deadline = performance.now() + this.window; });
    let seen = false, wrong = null;
    // Arm checks are strict, so both arms on "raise your left arm" is a wrong move, and vice versa.
    const others = MOVING.filter((p) => p !== cmd.pose);
    while (this.running && performance.now() < deadline) {
      if (tracker.held(cmd.pose, HOLD)) { seen = true; if (!cmd.says) break; }
      if (seen && cmd.says) break;
      wrong ??= others.find((p) => tracker.held(p, HOLD)) ?? null;
      const left = deadline === Infinity ? this.window : Math.max(0, deadline - performance.now());
      $("ss-timer").style.width = `${(left / this.window) * 100}%`;
      $("ss-seconds").textContent = (left / 1000).toFixed(1);
      await sleep(50);
    }
    $("ss-timer").style.width = "0%";
    $("ss-seconds").textContent = "";
    if (demo) this.app.lookAt(null);
    if (!this.running) return;

    const r = judge(cmd.says, seen, seen ? null : wrong);
    if (r.point) {
      this.score++;
      if (this.score % 2 === 0) this.window = Math.max(MIN_WINDOW, Math.round(this.window * 0.9));
    } else {
      this.out = true;
      // Simon gloats (the end of the game is spoken in start()).
      // What happened, for Simon to gloat about in his own words (a new sentence every time).
      this.outLine = !cmd.says
        ? `The player did "${COMMANDS[cmd.pose]}", but you never said "Simon says". Gloat that you didn't say Simon says, so you win.`
        : r.wrong ? `You said "Simon says, ${COMMANDS[cmd.pose]}" but the player did ${LABEL[r.wrong]} instead. Gloat that they did the wrong move, so you win.`
        : `You said "Simon says, ${COMMANDS[cmd.pose]}" and the player didn't do it in time. Gloat that they were too slow, so you win.`;
    }
    this.render(r.text, `${cmd.says ? "Simon said it" : "Simon didn't say"} · you ${seen ? "did it" : r.wrong ? `did ${LABEL[r.wrong]} instead` : "didn't do it"}`);
    this.app.note(`🎲 ${r.text}`, { pose: cmd.pose, says: cmd.says, seen, instead: wrong, score: this.score, round: this.round });
    // Say out loud that the move was registered, before the next command.
    if (r.point && this.round < ROUNDS) await this.speak(OKS[Math.floor(Math.random() * OKS.length)]);
  }

  render(big, small) {
    $("ss-command").textContent = big;
    $("ss-result").textContent = small;
    $("ss-score").textContent = this.running || this.round
      ? `Round ${this.round} of ${ROUNDS} · Score ${this.score ?? 0} · Window ${((this.window ?? START_WINDOW) / 1000).toFixed(1)} s` : "";
  }
}

// All-time scoreboard, flip-card style (like a volleyball scoreboard). Saved in this browser.
const BOARD_KEY = "simon-says-score";

class Scoreboard {
  constructor() {
    this.totals = { simon: 0, you: 0 };
    try { Object.assign(this.totals, JSON.parse(localStorage.getItem(BOARD_KEY) || "{}")); } catch {}
    for (const who of ["simon", "you"]) $(`ss-card-${who}`).textContent = this.totals[who];
  }

  add(who) {
    this.totals[who]++;
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(this.totals)); } catch {}
    flip($(`ss-card-${who}`), this.totals[who]);
  }
}

// The card folds away from the top, the number changes, and the new card folds down into place.
function flip(card, value) {
  const half = { duration: 180, easing: "ease-in", fill: "forwards" };
  card.animate([{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }], half).finished.then(() => {
    card.textContent = value;
    card.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }], { ...half, easing: "ease-out" });
  });
}
