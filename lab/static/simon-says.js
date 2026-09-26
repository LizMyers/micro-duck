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
  // Traps are strict (Liz, 2026-09-24): any clear move when Simon didn't say it is out, not just that move.
  if (!says && wrong) return { point: false, text: `Simon didn't say! (You did ${LABEL[wrong]}.)`, wrong };
  if (!says && seen) return { point: false, text: "Simon didn't say!" };
  return { point: true, text: "Good: Simon didn't say!" };
}

// How the game names each move when it tells you what you did instead.
const LABEL = {
  look_up: "look up", look_down: "look down", look_left: "look left", look_right: "look right",
  turn_left: "turn left", turn_right: "turn right",
  left_arm_up: "your left arm", right_arm_up: "your right arm", both_arms_up: "both arms",
};

const TRAP_OPENERS = ["Gotcha!", "Tricked you!"];   // not "Got you!" (same as Gotcha) or "Ha ha!" (the voice always runs on)

// Spoken results (the screen shows the same thing).
const TRAP_OK = "Good! Simon didn't say.";
const wrongLine = (pose) => `Wrong move! That was ${LABEL[pose]}.`;

// A different mood each time Simon loses, so his congratulations don't repeat word for word
// (the same prompt tends to get the same sentence).
const MOODS = ["dramatic",   // not "over-the-top": that made the model write "Ohhhh…" for 27 s "sulky but fair", "sporting and generous", "sarcastic",
  "grudging", "astonished", "theatrical, like a bad actor", "suspicious (you must have cheated!)"];

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

  // "I want a rematch!": start a game from a voice command (shows the game tab). False if already playing.
  startByVoice() {
    if (this.running || this.app.ready()) return false;
    document.getElementById("tab-game").click();
    setTimeout(() => this.start(), 0);
    return true;
  }

  showReady() {
    if (this.running) return;
    const problem = this.app.ready();
    $("ss-start").disabled = !!problem;
    $("ss-ready").textContent = problem || this.app.warming?.() || "Ready. Face the camera, looking straight ahead.";
  }

  // Every fixed line the game can say, most-needed first, for pre-warming (app.js). Improvised
  // reactions are left out: they're new each time, so they can't be cached.
  linesToWarm() {
    const { simon, you } = this.board.totals;
    return [
      "Let's play Simon Says!",
      ...Object.keys(COMMANDS).flatMap((pose) => [line({ pose, says: true }), line({ pose, says: false })]),
      ...OKS, TRAP_OK, "Last round!", "Too slow!",
      ...TRAP_OPENERS.map((o) => `${o} I didn't say Simon says, and you moved anyway. I win!`),
      "I win!", "You win!", "Wrong move! I win!", "Too slow! I win!", "Well played. You win!",
      // Only two scores are possible after the next game.
      scoreLine(simon + 1, you),
      scoreLine(simon, you + 1),
      ...Object.keys(LABEL).map(wrongLine),
    ];
  }

  async start() {
    $("ss-start").disabled = true;
    this.render("Starting the camera… face it, looking straight ahead.", "");
    const problem = await this.app.prepare();
    $("ss-start").disabled = false;
    if (problem) return this.render(problem, "");
    Object.assign(this, { running: true, score: 0, out: false, window: START_WINDOW, last: null, round: 0, skips: 0 });
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
    // The new totals are spoken first; the scoreboard card flips only after Simon has finished
    // (Liz's hunch: the flip was interrupting his speech).
    const winner = simonWon ? "simon" : "you";
    const { simon, you } = { ...this.board.totals, [winner]: this.board.totals[winner] + 1 };
    // Numbers as words, in its own short line: the voice model dropped the end of
    // "You win! All-time score: Simon 3, you 2." (it said "...Simon 3" then ran on).
    const tally = scoreLine(simon, you);
    if (simonWon) {
      this.render("Simon wins!", `You got ${this.score} of ${ROUNDS}.`);
      this.app.celebrate();
      if (this.outFixed) await this.speak(this.outFixed);   // the trap line already ends "I win!"
      else {
        const { started, done } = this.app.sayLine(this.outLine, { improvise: true });
        const heard = (await started) ? await done : (await this.speak(this.outFallback), this.outFallback);
        // Say who won, unless his made-up gloat already did (Liz: he said it twice).
        if (!/\bwins?\b/i.test(heard)) await this.speak("I win!");
      }
      await this.speak(tally);
    } else {
      this.render("You win!", `All ${ROUNDS} right.`);
      const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
      this.app.note(`🎭 Simon's mood for losing: ${mood}`);
      const said = await this.speak(`The player got all ${ROUNDS} rounds right, so the player wins this game and you lose. ` +
        `Congratulate them in a ${mood} way, and say clearly that they win.`, { improvise: true });
      if (!said) await this.speak("Well played. You win!");   // fallback if the improvised line stalls
      await this.speak("You win!");
      await this.speak(tally);
    }
    this.board.add(winner);
    this.stop(null);
  }

  stop(message) {
    this.running = false;
    this.app.lookAt(null);
    $("ss-start").textContent = "Start game";
    if (message) this.render(message, "");
    this.app.note(`🎲 Simon Says: game over, score ${this.score}`);
    this.app.gameOver?.();
  }

  // True if Simon said it (false if he never started, e.g. an improvised line that was given up on).
  async speak(text, opts) {
    const { started, done } = this.app.sayLine(text, opts);
    if (!(await started)) return false;
    await done;
    return true;
  }

  async playRound() {
    const tracker = this.app.tracker();
    // Back to neutral first (up to 3 s), so the last move can't count for this one.
    for (let t = 0; t < 3000 && MOVING.some((p) => tracker.held(p, HOLD)); t += 100) await sleep(100);
    if (!this.running) return;

    const cmd = nextCommand(Math.random, { last: this.last });
    this.last = cmd.pose;
    const text = line(cmd);
    // Fairness (Liz): you're judged from the moment Simon finishes, so he must say the command as one
    // clean sentence. Commands only ever play from complete, checked audio (made silently first if
    // needed). If he can't say it cleanly, the round doesn't count and he picks another.
    if (!(await this.app.prepareLine(text))) {
      this.app.note(`🎲 skipped "${text}": Simon couldn't say it cleanly, so it doesn't count`);
      if (++this.skips >= 3) { this.render("Simon didn't answer. Is the model READY?", ""); return this.stop(null); }
      return;
    }
    this.skips = 0;
    if (!this.running) return;
    this.round++;
    if (this.round === ROUNDS) await this.speak("Last round!");
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
      if (wrong && !cmd.says) break;   // strict traps: any move is out
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
      // Examples steer the logic; "make up a new one" keeps the variety.
      // Traps get a fixed sentence (Liz: the improvised ones got the logic muddled, e.g. "you stepped left
      // on your own"), with a rotating opener for a little variety. Exact, so it's cached after first use.
      this.outFixed = !cmd.says
        ? `${TRAP_OPENERS[Math.floor(Math.random() * TRAP_OPENERS.length)]} I didn't say Simon says, and you moved anyway. I win!`
        : null;
      this.outFallback = r.wrong ? "Wrong move! I win!" : "Too slow! I win!";   // if the improvised line stalls
      this.outLine = !cmd.says ? null
        : r.wrong ? `You said "Simon says, ${COMMANDS[cmd.pose]}" but the player did ${LABEL[r.wrong]} instead. ` +
          `Gloat that they did the wrong move. Examples: "Wrong move! I said ${COMMANDS[cmd.pose]}. I win!" / "Oops, not that one! I win!" Make up a new one like these.`
        : `You said "Simon says, ${COMMANDS[cmd.pose]}" and the player didn't do it in time. ` +
          `Gloat that they were too slow. Examples: "Snooze you lose! I win!" / "Better luck next time, friend! I win!" Make up a new one like these.`;
    }
    this.render(r.text, `${cmd.says ? "Simon said it" : "Simon didn't say"} · you ${seen ? "did it" : r.wrong ? `did ${LABEL[r.wrong]} instead` : "didn't do it"}`);
    this.app.note(`🎲 ${r.text}`, { pose: cmd.pose, says: cmd.says, seen, instead: wrong, score: this.score, round: this.round });
    // Say the result out loud, so you can follow the game without looking at the screen (Liz).
    // All fixed lines: cached, so they play instantly. (A trap you fell for is covered by Simon's
    // "I didn't say Simon says" line at the end.)
    if (r.point && this.round < ROUNDS) await this.speak(cmd.says ? OKS[Math.floor(Math.random() * OKS.length)] : TRAP_OK);
    else if (!r.point && cmd.says) await this.speak(r.wrong ? wrongLine(r.wrong) : "Too slow!");
  }

  render(big, small) {
    $("ss-command").textContent = big;
    $("ss-result").textContent = small;
    $("ss-score").textContent = this.running || this.round
      ? `Round ${this.round} of ${ROUNDS} · Score ${this.score ?? 0} · Window ${((this.window ?? START_WINDOW) / 1000).toFixed(1)} s` : "";
  }
}

// All-time scoreboard, split-flap style (like a train-station board). Saved in this browser.
const BOARD_KEY = "simon-says-score";

class Scoreboard {
  constructor() {
    this.totals = { simon: 0, you: 0 };
    try { Object.assign(this.totals, JSON.parse(localStorage.getItem(BOARD_KEY) || "{}")); } catch {}
    for (const who of ["simon", "you"]) setCard($(`ss-card-${who}`), this.totals[who]);
  }

  add(who) {
    const from = this.totals[who]++;
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(this.totals)); } catch {}
    flip($(`ss-card-${who}`), from, this.totals[who]);
  }
}

// A card is two halves, each showing half of the number: the top half and the bottom half.
function half(cls, value) {
  const h = document.createElement("span");
  h.className = `half ${cls}`;
  const b = document.createElement("b");
  b.textContent = value;
  h.append(b);
  return h;
}

function setCard(card, value) {
  card.replaceChildren(half("upper", value), half("lower", value));
}

// Split-flap: the new number appears behind the top half, the old top half folds down on the hinge,
// and lands as the new bottom half.
function flip(card, from, to) {
  card.replaceChildren(half("upper", to), half("lower", from));
  const flapTop = half("upper flap", from), flapBottom = half("lower flap", to);
  card.append(flapTop, flapBottom);
  flapBottom.style.transform = "rotateX(90deg)";
  const fold = { duration: 220, fill: "forwards" };
  flapTop.animate([{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }], { ...fold, easing: "ease-in" })
    .finished.then(() => flapBottom.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }],
      { ...fold, easing: "cubic-bezier(.3,1.6,.6,1)" }).finished)   // a tiny bounce as it lands
    .then(() => setCard(card, to));
}

// Small numbers as words for the voice ("3" -> "three"); bigger ones stay as digits.
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
// The score, said in the first person: players may give their duck another name (Liz), so he never
// says "Simon". Cheeky when he's ahead, a good sport when he's behind. Each score always gets the
// same line (picked by the total), so it can be saved once and replayed, but it changes game to game.
const AHEAD = [
  (me, you) => `It's ${me} to ${you}. Advantage me!`,
  (me, you) => `${cap(me)} for me, ${you} for you. Come on, show me what you've got!`,
  (me, you) => `It's ${me} to ${you} in my favor. Come on, try harder!`,
];
const LEVEL = [
  (me) => `${cap(me)} all. Anybody's game!`,
  (me) => `${cap(me)} each. All square!`,
];
const BEHIND = [
  (me, you) => `You lead ${you} to ${me}. Not for long!`,
  (me, you) => `${cap(you)} for you, ${me} for me. I'm coming for you!`,
];
const cap = (t) => t[0].toUpperCase() + t.slice(1);
export function scoreLine(simon, you) {
  const set = simon > you ? AHEAD : simon === you ? LEVEL : BEHIND;
  const pick = set === LEVEL ? simon : simon + you;   // a level total is always even, so use one side
  return set[pick % set.length](words(simon), words(you));
}

export function words(n) { return NUMBER_WORDS[n] ?? String(n); }
