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
const SPEAK_TIMEOUT_MS = 15000;
const LOST_MS = 2000;
const HEAD_MOVES = ["look_up", "look_down", "look_left", "look_right"];   // out of the camera's view this long mid-round = the round doesn't count   // no game line takes this long (the run-on cutter stops them at 7 s)
const START_WINDOW = 4000;   // ms to do the move, counted from when Simon FINISHES speaking
const MIN_WINDOW = 3000;     // never less: room to react (~1 s) and hold the move (1 s)
const ROUNDS = 5;            // a short game for testing: get all 5 right and you win
// A move counts only when held this long (Liz: "make them hold it"): no reward for a flicker, and no
// "out" for one either. Held right: the next round starts straight away; you always get the full window.
const HOLD = 1000;
// A move that started this soon after Simon began talking isn't a reaction to him (nobody is that fast):
// it's a leftover move or camera jitter, so it doesn't count. (A trap once caught Liz 0.35 s in.)
export const REACTION_MS = 600;
// Is the calibrated stance usable? A stance taken while turned or looking away makes normal sitting read
// as a move (Liz, 2026-09-26: calibrated with the body turned 0.17, then "look right" all game).
// calibrationIssue says which problem ("none" | "room" | "turned" | "look"), or null if it's fine.
export function calibrationIssue(b) {
  if (!b) return "none";
  // Room for raised arms: an elbow raised to the side of the head sits about 0.6 shoulder-widths above the
  // shoulder. If that's off the top of the picture, arm moves can't be judged (Liz's hands left the frame,
  // 2026-09-26: the referee needs at least the elbows). All in picture heights (0 = top).
  if (b.noseY != null && b.shoulderToNose != null && b.shoulderWidth != null) {
    if (b.noseY + b.shoulderToNose - 0.6 * b.shoulderWidth < 0.05) return "room";
  }
  if (Math.abs(b.shoulderDepth) > 0.1) return "turned";
  if (Math.abs(b.yaw) > 0.15) return "look";
  return null;
}
const PLAIN_SETUP = {
  none: "I can't see you. Sit where your head and shoulders are in view.",
  room: "Sit back a little, so your raised arms fit in the picture.",
  turned: "Turn your body to face me.",
  look: "Look straight at me.",
};
export function calibrationProblem(b) {
  const issue = calibrationIssue(b);
  return issue ? PLAIN_SETUP[issue] : null;
}
// The game page's setup step 2 says the same things with some fun (Liz: "Over here, silly!").
// Each problem has a few wordings; the page moves to the next one each time that problem comes back.
export const SETUP_LINES = {
  none: ["Where did you go?", "Hello? Anybody there?", "Pop your head and shoulders in!"],
  room: ["Whoa, too close! Sit back a bit.", "Scoot back, so your arms fit!", "A little further back, please!"],
  turned: ["Over here, silly!", "Turn your shoulders to me!", "Face me, face me!"],
  look: ["Eyes on me!", "Look straight at me!", "Yoo-hoo, over here!"],
  ok: ["Perfect!", "Looking good!", "That's the spot!"],
};

// At the end of every game Simon asks, then opens the mic for the answer (Liz: a yes by voice, or the button).
export const PLAY_AGAIN = ["Play again?", "Another round?", "Fancy another go?"];

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
const trapLine = (opener) => `${opener} I didn't say Simon says!`;

// How Simon gloats when he wins (Liz): cheeky and a little sarcastic about the player's skills,
// funny, never mean. He makes up a new line each time; these steer the tone.
// The local model gives the same answer to the same request every time (Liz heard one congratulation
// word for word twice), so each request carries one example picked at random: that's the variety.
const GLOAT_EXAMPLES = ["Oh boy, you are out of shape!", "Seems you haven't played this much!", "Were you napping?",
  "My grandma moves faster!", "Nice try, rookie!", "Did you forget the rules?"];
const gloat = () => "Tease them a little sarcastically about their skills: funny, never mean. " +
  `For example: "${pickFresh(GLOAT_EXAMPLES)}" Make up a new one like that, and end by saying you win.`;
const WIN_OPENERS = ["Aw shucks!", "Ouch!", "Fine, you got me!", "No way!", "Well, well!"];
// Keep the game moving (Liz): at most one gloat per game (the game ends at the first mistake), and only
// some games get one, at random, so it never feels scripted. The other times it's just "I win!".
const ADLIB_CHANCE = 0.5;

// How a game opens (Liz: "Let's play Simon Says!" every time got repetitive). The full line only for the
// first game after the page loads; a rematch gets a short line that fits who won last, never the same
// one twice in a row. No numbers in them, so each is saved once and plays instantly.
const FIRST_OPENER = "Let's play Simon Says!";
// Before the calibration countdown: a different nudge each game (Liz: "Look at me!" every time made
// no sense, and it's a chance for some personality).
// The first game after the page loads gets a plain line instead (Liz: the cheeky ones blindside a new
// player, who doesn't know yet why Simon wants them to face front).
// Alternatives in order, in case the voice model gets one wrong (it did "Let's adjust the camera, please."
// three times running, 2026-09-26, and there was nothing else to say).
const FIRST_SETUP = ["Let's adjust the camera, please.", "Let's set up the camera, please.", "Camera check, please."];
const FACE_FRONT = ["Sit up straight, face forward!", "Face your webcam, please!", "Stop squirming and face front!"];
const REMATCH = {
  simon: ["Back for more?", "Again? You're on!", "Brave. Let's go!"],
  you: ["Revenge time!", "Rematch! I'm ready this time.", "Okay, no more Mr Nice Duck."],
};
// After the score, a taunt only some of the time: heard less often, it lands better.
const TAUNT_CHANCE = 1 / 3;
// A random pick that's never the same as the last one.
export function pickFresh(list, last, rand = Math.random) {
  const options = list.length > 1 ? list.filter((t) => t !== last) : list;
  return options[Math.floor(rand() * options.length)];
}

// A different mood each time Simon loses, so his congratulations don't repeat word for word
// (the same prompt tends to get the same sentence).
// Not "over-the-top" (the model wrote "Ohhhh…" for 27 s) or "dramatic" (long lines the voice ran on with).
// (Until 2026-09-26 a comment on this line swallowed the first three moods, so they were never used.)
const MOODS = ["sulky but fair", "sporting and generous", "sarcastic",
  "grudging", "astonished", "theatrical, like a bad actor", "suspicious (you must have cheated!)"];

// Quick acknowledgements (exact, so they're cached and instant after the first time).
const OKS = ["OK!", "Got it!", "Nice one!", "Good!"];

const MIRROR = { look_up: "up", look_down: "down", look_left: "right", look_right: "left" };
const MOVING = ["look_up", "look_down", "look_left", "look_right", "turn_left", "turn_right",
  "left_arm_up", "right_arm_up", "both_arms_up"];

const $ = (id) => document.getElementById(id);
// The game page draws its own screens and leaves some of these elements out, so writes are skipped there.
const setProp = (id, key, value) => { const el = $(id); if (el) el[key] = value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SimonSaysGame {
  /** @param {{ tracker(): any, ready(): string|null, sayLine(text: string): {started: Promise<boolean>, done: Promise<void>},
   *            lookAt(dir: string|null): void, prepare(): Promise<void>, note(text: string, data?: any): void }} app */
  constructor(app) {
    this.app = app;
    this.running = false;
    this.board = new Scoreboard();
    this.lastWinner = null;
    this.gameId = 0;          // see start(): each game has an id, so a stopped game can't keep going   // this page load only: the first game gets the full opener
    this.lastSaid = {};       // last opener and taunt said, so neither repeats back to back
    const startBtn = $("ss-start");
    if (startBtn) startBtn.onclick = () => (this.running ? this.stop("Stopped.") : this.start());
    setInterval(() => this.showReady(), 1000);
  }

  // What's happening, for a page that draws its own screens (the game page): "playing", each "round"
  // (never whether it's a trap: the screen mustn't give it away), its "result", "over", and "stopped".
  emit(ev) { this.app.onGame?.(ev); }

  // "I want a rematch!": start a game from a voice command (shows the game tab). False if already playing.
  // Returns what happened, for the model to say: "starting", or why not.
  startByVoice() {
    if (this.running || this.starting) return "already playing";
    if (this.app.ready()) return "not ready yet";
    document.getElementById("tab-game")?.click();
    // The game page sets up the camera on the page first; a voice start must not skip it (2026-09-26:
    // it did, so the camera was never calibrated and every move went unseen).
    if (this.app.setupOnPage && !this.app.isSetUp?.()) {
      this.app.needSetup?.();
      // Worded for Simon to pass on (he said "player turns on the camera…" and "I see…" when it read like a note).
      return "not started: the camera isn't set up yet. Tell them, in your own words and without saying you can see, " +
        "to press Turn on camera and then Yes, let's go on the Simon Says tab, and to ask you again after that";
    }
    setTimeout(() => this.start(), 0);
    return "starting";
  }

  showReady() {
    if (this.running || this.starting) return;   // (it re-enabled Start during setup: two games at once)
    const problem = this.app.ready();
    setProp("ss-start", "disabled", !!problem);
    setProp("ss-ready", "textContent", problem || this.app.warming?.() || "Ready. Face the camera, looking straight ahead.");
  }

  // Every fixed line the game can say, most-needed first, for pre-warming (app.js). Improvised
  // reactions are left out: they're new each time, so they can't be cached.
  linesToWarm() {
    const { simon, you } = this.board.totals;
    return [
      ...FIRST_SETUP, FIRST_OPENER, ...REMATCH.simon, ...REMATCH.you,
      ...Object.keys(COMMANDS).flatMap((pose) => [line({ pose, says: true }), line({ pose, says: false })]),
      ...OKS, TRAP_OK, "Last round!", "Too slow!",
      ...TRAP_OPENERS.map(trapLine),
      "I win!", "You win!", "Well played. You win!", ...PLAY_AGAIN,
      // Only two scores are possible after the next game.
      this.usableScore(simon + 1, you), ...taunts(simon + 1, you, "simon"),
      this.usableScore(simon, you + 1), ...taunts(simon, you + 1, "you"),
      // And three after the one after: a quick "yes, again!" starts a game before the pre-warm can run
      // (a game in progress pauses it), so its score had to be made live, with a pause (Liz, 2026-09-26).
      this.usableScore(simon + 2, you), this.usableScore(simon + 1, you + 1), this.usableScore(simon, you + 2),
      ...Object.keys(LABEL).map(wrongLine),
    ];
  }

  async start() {
    // One game at a time: setup (camera + countdown) takes seconds before `running` is set, and a second
    // click or "let's play" in that gap started a second game on top (2026-09-26).
    if (this.running || this.starting) return;
    this.starting = true;
    setProp("ss-start", "disabled", true);
    try {
      this.render("Starting the camera… face it, looking straight ahead.", "");
      const problem = await this.app.prepare();
      if (problem) return this.render(problem, "");
      // The game page does camera setup on the page before Start appears (Liz: a spoken "Let's adjust
      // the camera" can't show what to do); the lab still sets up by voice with a countdown.
      if (this.app.setupOnPage && !this.app.isSetUp?.()) { this.app.needSetup?.(); return; }
      if (!this.app.setupOnPage && !(await this.calibrateWithCountdown())) return;
    } finally {
      this.starting = false;
      setProp("ss-start", "disabled", false);
    }
    const id = ++this.gameId;   // this game's ticket: stop() or a new game makes every older step give up
    const live = () => this.isLive(id);
    Object.assign(this, { running: true, score: 0, out: false, window: START_WINDOW, last: null, round: 0, skips: 0 });
    setProp("ss-start", "textContent", "Stop game");
    this.render("Get ready…", "");
    this.app.note("🎲 Simon Says: game started");
    this.emit({ type: "playing" });
    if (!this.lastWinner) await this.speak(FIRST_OPENER);
    else if (this.app.setupOnPage) await this.speak(this.pickOpener());   // (by voice: said over the countdown)
    // One mistake and you're out (classic rules). Survive all the rounds and you win.
    while (live() && !this.out && this.round < ROUNDS) await this.playRound(id);
    if (!live()) return;
    // Who won goes on the all-time scoreboard. Simon improvises a reaction (told plainly who won),
    // then reads the result as a fixed line, so it's never unclear.
    const simonWon = this.out;
    // The new totals are spoken first; the scoreboard card flips only after Simon has finished
    // (Liz's hunch: the flip was interrupting his speech).
    const winner = simonWon ? "simon" : "you";
    const { simon, you } = { ...this.board.totals, [winner]: this.board.totals[winner] + 1 };
    // Numbers as words, in its own short line: the voice model dropped the end of
    // "You win! All-time score: Simon 3, you 2." (it said "...Simon 3" then ran on).
    this.emit({ type: "over", winner, why: simonWon ? this.lastResult : `All ${ROUNDS} right!` });
    if (simonWon) {
      this.render("Simon wins!", `You got ${this.score} of ${ROUNDS}.`);
      this.app.celebrate();
      await this.app.sfx?.("win");     // Simon won: "Wheee!" (duck sounds only at the end of a game, Liz)
      const adlib = Math.random() < ADLIB_CHANCE;
      this.app.note(adlib ? "🎭 Simon ad-libs a gloat this game" : "🎭 no ad-lib this game: straight to \"I win!\"");
      let heard = "";
      if (adlib) {
        const { started, done } = this.app.sayLine(this.outLine, { improvise: true });
        heard = (await started) ? await done : (await this.speak(this.outFallback), this.outFallback);
      }
      if (!live()) return;   // stopped during the gloat: no more lines, no scoreboard change
      // Say who won, unless his made-up gloat already did (Liz: he said it twice).
      if (!/\bwins?\b/i.test(heard)) await this.speak("I win!");
      if (!live()) return;
      await this.sayScore(simon, you, winner);
    } else {
      this.render("You win!", `All ${ROUNDS} right.`);
      await this.app.sfx?.("lose");    // Simon lost: a deflated quack before he congratulates you
      const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
      this.app.note(`🎭 Simon's mood for losing: ${mood}`);
      const { started, done } = this.app.sayLine(`The player got all ${ROUNDS} rounds right, so the player wins this game and you lose. ` +
        `Congratulate them in a ${mood} way, and say clearly that they win. ` +
        `You can start with "${pickFresh(WIN_OPENERS)}"`, { improvise: true });
      // What he actually said ("" if he never started or mumbled), so "You win!" isn't said twice (Liz).
      let heard = (await started) ? await Promise.race([done, sleep(SPEAK_TIMEOUT_MS).then(() => "")]) : "";
      if (!live()) return;
      if (!heard) { heard = "Well played. You win!"; await this.speak(heard); }   // fallback if the made-up line stalls
      if (!/\byou(?:'ve| have)? (?:win|won)\b/i.test(heard)) await this.speak("You win!");
      if (!live()) return;
      await this.sayScore(simon, you, winner);
    }
    if (!live()) return;
    const ask = pickFresh(PLAY_AGAIN, this.lastSaid.ask);
    this.lastSaid.ask = ask;
    this.emit({ type: "ask", text: ask });
    await this.speak(ask);
    if (!live()) return;
    this.app.remember?.(ask);   // so a spoken "yes" has context for the chat model
    this.board.add(winner);
    this.lastWinner = winner;
    this.stop(null);
    this.app.listen?.();        // the mic opens for the answer
  }

  // You left the camera's view mid-round: that round doesn't count. Wait (up to 15 s) for you to come back,
  // then carry on with a new round; otherwise stop the game rather than judge nobody.
  async lostSight(id) {
    this.round--;
    this.app.note("🧍 page: lost sight of you for 2 s, so that round doesn't count", null, "warn");
    this.render("I can't see you!", "Come back into view: head and shoulders.");
    this.emit({ type: "lost" });
    const tracker = this.app.tracker();
    for (let t = 0; t < 15000; t += 200) {
      if (!this.isLive(id)) return;
      if (tracker.latest?.landmarks) { this.render("There you are!", ""); this.emit({ type: "back" }); await sleep(1000); return; }
      await sleep(200);
    }
    this.stop("Stopped: I couldn't see you. Start again when you're back in view.");
  }

  isLive(id) { return this.running && this.gameId === id; }

  stop(message) {
    if (!this.running) return;   // already over (a late step of a stopped game)
    this.running = false;
    this.gameId++;               // any step still in flight sees it's no longer its game
    this.app.lookAt(null);
    setProp("ss-start", "textContent", "Start game");
    if (message) this.render(message, "");
    this.emit({ type: "stopped", message });
    this.app.note(`🎲 Simon Says: game over, score ${this.score}`);
    this.app.gameOver?.();
  }

  // A rematch opener that fits who won last, never the same one twice running.
  pickOpener() {
    const opener = pickFresh(REMATCH[this.lastWinner], this.lastSaid.opener);
    this.lastSaid.opener = opener;
    return opener;
  }

  // The wording that will be used for this score (the first one the voice model doesn't get wrong).
  usableScore(simon, you) {
    return scoreLines(simon, you).find((t) => !this.app.isBad?.(t)) ?? scoreLine(simon, you);
  }

  // Simon sets you up before every game (Liz: "set the user up for success"): a "face front" nudge, a 3-2-1
  // countdown, then the camera records your normal stance. A stance taken while turned or looking away
  // makes ordinary sitting read as moves, so a bad one is retaken (up to 3 tries).
  async calibrateWithCountdown() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Spoken once; a retry just shows what to fix (repeating the line made no sense).
      // One cue per start (Liz: nudge + opener + her own "let's play again" was three). A rematch says its
      // opener ("Brave. Let's go!") over the countdown; the first game says the camera line. The cheeky
      // face-front nudges (FACE_FRONT) are resting until V2 moves camera setup into the page.
      let said = null;
      if (attempt === 1) {
        const line = this.lastWinner ? this.pickOpener()
          : FIRST_SETUP.find((t) => !this.app.isBad?.(t)) ?? FIRST_SETUP[0];
        said = this.speak(line);
      }
      for (const n of ["3", "2", "1"]) { this.render("Face the camera…", n); await sleep(800); }
      await said;
      const base = this.app.calibrate();
      const problem = calibrationProblem(base);
      if (!problem) { this.setUpOnce = true; this.render("Get ready…", ""); return true; }
      this.app.note(`📷 page: calibration ${attempt} of 3 not usable: ${problem}`, base);
      this.render(problem, "Let's try that again.");
      await sleep(1500);
    }
    // Never refuse to play (Liz: "not working at all"): start anyway with the last stance, and say so.
    this.app.note("📷 page: 3 calibrations not usable; starting anyway, so the judge may see moves you didn't make", null, "warn");
    this.setUpOnce = true;
    this.render("Starting anyway…", "Face the camera square on for the fairest game.");
    await sleep(1500);
    return true;
  }

  // The score every time; a taunt now and then, never the same one twice running.
  async sayScore(simon, you, winner) {
    // Skip wordings the voice model gets wrong; if this one goes wrong now, say the next one instead.
    const options = scoreLines(simon, you).filter((t) => !this.app.isBad?.(t));
    for (const [i, text] of options.entries()) {
      await this.speak(text);
      if (!this.app.isBad?.(text)) break;
      if (options[i + 1]) this.app.note(`🔁 trying another wording: "${options[i + 1]}"`);
    }
    if (Math.random() >= TAUNT_CHANCE) return this.app.note("🎭 no taunt this time");
    const taunt = pickFresh(taunts(simon, you, winner), this.lastSaid.taunt);
    this.lastSaid.taunt = taunt;
    await this.speak(taunt);
  }

  // True if Simon said it (false if he never started, e.g. an improvised line that was given up on).
  async speak(text, opts) {
    const { started, done } = this.app.sayLine(text, opts);
    if (!(await started)) return false;
    // If the agent stops mid-line (crash, disconnect), `done` may never come: don't wait forever.
    const finished = await Promise.race([done.then(() => true), sleep(SPEAK_TIMEOUT_MS).then(() => false)]);
    if (!finished) this.app.note(`⏱ page: "${text.slice(0, 60)}" didn't finish within ${SPEAK_TIMEOUT_MS / 1000} s; carrying on`, null, "warn");
    return true;
  }

  async playRound(id) {
    const live = () => this.isLive(id);
    const tracker = this.app.tracker();
    // Back to neutral first (up to 3 s), so the last move can't count for this one.
    for (let t = 0; t < 3000 && MOVING.some((p) => tracker.held(p, 300)); t += 100) await sleep(100);
    if (!live()) return;
    // Self-correcting referee: a head move still "on" after that wait isn't a move, it's how you're sitting
    // (a calibration taken with the head tilted down kept "look up" on all game, 2026-09-26, and the real
    // look up was ignored as "too early"). So recalibrate to how you're sitting now.
    const stuck = HEAD_MOVES.find((p) => tracker.held(p, 3000));
    if (stuck) {
      this.app.calibrate();
      this.app.note(`📷 page: ${LABEL[stuck]} stayed on while you waited, so I recalibrated to how you're sitting now`, null, "warn");
    }

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
    if (!live()) return;
    this.round++;
    if (this.round === ROUNDS) await this.speak("Last round!");
    this.render(text, "");
    this.emit({ type: "round", round: this.round, rounds: ROUNDS, pose: cmd.pose, move: COMMANDS[cmd.pose] });
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
    // when Simon has finished the sentence: then you get the full `window` ms. A move counts only when
    // held for HOLD ms and started at least REACTION_MS after Simon began (earlier = leftover or jitter).
    const spokeAt = performance.now();
    let deadline = Infinity;
    done.then(() => { deadline = performance.now() + this.window; });
    let seen = false, wrong = null;
    const ignored = new Set();
    const counts = (p) => {
      const since = tracker.since(p);
      if (since == null) return false;
      if (since < spokeAt + REACTION_MS) {
        if (tracker.held(p, 300) && !ignored.has(p)) {
          ignored.add(p);
          this.app.note(`🧍 ignored ${LABEL[p]}: it started ${((since - spokeAt) / 1000).toFixed(2)} s after Simon began, too early to be a reaction`);
        }
        return false;
      }
      return tracker.held(p, HOLD);
    };
    // Arm checks are strict, so both arms on "raise your left arm" is a wrong move, and vice versa.
    const others = MOVING.filter((p) => p !== cmd.pose);
    // Head moves only: how far you got towards the commanded one, shown when it's "Too slow" (for tuning).
    const dir = { look_up: 1, look_down: -1, look_left: 1, look_right: -1 }[cmd.pose];
    let peak = null;
    let longest = 0;   // your longest valid hold of the commanded move (shown when it's "Too slow")
    const tiltPeak = { ears: null, face: null };   // look up/down: both methods, to pick the better one
    const isTilt = /look_(up|down)/.test(cmd.pose);
    const isTurn = /turn_(left|right)/.test(cmd.pose);
    let narrowest = null;   // turns: the narrowest your shoulders got, as a fraction of their calibrated width
    const isArm = /arm/.test(cmd.pose);
    const armWhy = new Map();   // arms: why the camera said "not up", frame by frame (e.g. the wrist out of view)
    let armFrames = 0;
    let armPeak = null;   // the frame where the wrist was highest (for the log)
    let lostAt = null, lost = false;
    while (live() && performance.now() < deadline) {
      // Out of view for 2 s: you can't be judged, so the round doesn't count (it used to end "Too slow!").
      if (!tracker.latest?.landmarks) {
        lostAt ??= performance.now();
        if (performance.now() - lostAt > LOST_MS) { lost = true; break; }
      } else lostAt = null;
      const t = isTilt && tracker.tilt?.();
      if (t) for (const k of ["ears", "face"]) if (tiltPeak[k] == null || t[k] * dir > tiltPeak[k] * dir) tiltPeak[k] = t[k];
      const v = dir && tracker.check(cmd.pose)?.value;
      if (typeof v === "number" && (peak == null || v * dir > peak * dir)) peak = v;
      if (isArm && deadline !== Infinity) {
        const c = tracker.check(cmd.pose);
        armFrames++;
        if (c && !c.ok) armWhy.set(c.reason, (armWhy.get(c.reason) || 0) + 1);
        const up = tracker.armDetail?.(cmd.pose);   // how high the wrist got, and how sure the camera was
        if (up && (armPeak == null || up.up > armPeak.up)) armPeak = up;
      }
      const w = isTurn && tracker.check(cmd.pose)?.value;
      if (typeof w === "number" && (narrowest == null || w < narrowest)) narrowest = w;
      const since = tracker.since(cmd.pose);
      if (since != null && since >= spokeAt + REACTION_MS) longest = Math.max(longest, performance.now() - since);
      if (counts(cmd.pose)) { seen = true; break; }   // held right (or, on a trap, held the trap move): done
      if (!cmd.says && (wrong = others.find(counts) ?? null)) break;   // strict traps: any held move is out
      if (cmd.says) wrong = others.find(counts) ?? wrong;   // a wrong move only counts if you never get it right
      // "Hold it…" while the right move is on but not yet held for a second.
      const holding = cmd.says && tracker.since(cmd.pose) != null && tracker.since(cmd.pose) >= spokeAt + REACTION_MS;
      // The referee's own count, for the page's fill meter: it fills exactly as the judge counts (Liz: the
      // fill used the camera alone, so it could fill up while the judge was still counting or had rejected it).
      this.emit({ type: "hold", progress: holding ? Math.min(1, (performance.now() - tracker.since(cmd.pose)) / HOLD) : 0 });
      setProp("ss-result", "textContent", holding ? "Hold it…" : "");
      const left = deadline === Infinity ? this.window : Math.max(0, deadline - performance.now());
      if ($("ss-timer")) $("ss-timer").style.width = `${(left / this.window) * 100}%`;
      setProp("ss-seconds", "textContent", (left / 1000).toFixed(1));
      await sleep(50);
    }
    if ($("ss-timer")) $("ss-timer").style.width = "0%";
    setProp("ss-seconds", "textContent", "");
    if (demo) this.app.lookAt(null);
    if (!live()) return;

    if (lost) return this.lostSight(id);
    const r = judge(cmd.says, seen, seen ? null : wrong);
    if (cmd.says && !seen && longest > 0) {
      this.app.note(`🧍 you held ${LABEL[cmd.pose]} for ${(longest / 1000).toFixed(1)} s at most; it needs ${HOLD / 1000} s`);
    }
    if (isTilt && cmd.says && tiltPeak.ears != null) {
      // Every look up/down round, right or wrong: the data for choosing the better tilt measure.
      this.app.note(`📏 ${LABEL[cmd.pose]}${seen ? "" : " (missed)"}: ears method got to ${tiltPeak.ears.toFixed(2)} ` +
        `(the judge uses this, needs ${dir > 0 ? "" : "−"}${this.app.thresholds?.pitch}); face method got to ${tiltPeak.face.toFixed(2)}`);
    } else if (isArm && !seen && armFrames) {
      // Why a raised arm wasn't counted, on every arm round, traps too (Liz raised her left arm on a trap and
      // it wasn't seen at all, 2026-09-26). The numbers say which check failed.
      const [why, n] = [...armWhy].sort((a, b) => b[1] - a[1])[0] ?? ["it was up", 0];
      const p = armPeak ? ` Highest: wrist ${armPeak.up.toFixed(2)} shoulder-widths above the shoulder (needs 0.35), ` +
        `camera sure of wrist ${Math.round(armPeak.wristVis * 100)}%, elbow ${Math.round(armPeak.elbowVis * 100)}%.` : "";
      this.app.note(`📏 ${LABEL[cmd.pose]}${cmd.says ? " (missed)" : " (trap)"}: most often "${why}", ${Math.round((n / armFrames) * 100)}% of the time.${p}`, armPeak);
    } else if (isTurn && cmd.says && narrowest != null) {
      // Every turn round, right or wrong: how far you turned, for tuning the threshold.
      this.app.note(`📏 ${LABEL[cmd.pose]}${seen ? "" : " (missed)"}: your shoulders got to ${narrowest.toFixed(2)} ` +
        `of their width; the judge needs under ${this.app.thresholds?.turned}`);
    } else if (cmd.says && !seen && peak != null) {
      const need = /look_(up|down)/.test(cmd.pose) ? this.app.thresholds?.pitch : this.app.thresholds?.look;
      this.app.note(`📏 ${LABEL[cmd.pose]}: your head got to ${peak.toFixed(2)}; the judge needs ${dir > 0 ? "" : "−"}${need}`);
    }
    if (r.point) {
      this.score++;
      if (this.score % 2 === 0) this.window = Math.max(MIN_WINDOW, Math.round(this.window * 0.9));
    } else {
      this.out = true;
      // Simon gloats (the end of the game is spoken in start()).
      // What happened, for Simon to gloat about in his own words (a new sentence every time).
      // Examples steer the logic; "make up a new one" keeps the variety.
      // Why they lost is always a fixed line, said first (below), so the logic is never muddled (Liz: made-up
      // trap lines once said "you stepped left on your own"). Then a made-up gloat adds the cheek.
      this.outFallback = "I win!";   // if the improvised line stalls
      this.outLine = !cmd.says
        ? `You said "${COMMANDS[cmd.pose]}" without "Simon says" first, and the player fell for it and moved. ${gloat()}`
        : r.wrong ? `You said "Simon says, ${COMMANDS[cmd.pose]}" but the player did ${LABEL[r.wrong]} instead. ${gloat()}`
        : `You said "Simon says, ${COMMANDS[cmd.pose]}" and the player was too slow to do it. ${gloat()}`;
    }
    this.lastResult = r.text;
    this.emit({ type: "result", point: r.point, text: r.text });
    this.render(r.text, `${cmd.says ? "Simon said it" : "Simon didn't say"} · you ${seen ? "did it" : r.wrong ? `did ${LABEL[r.wrong]} instead` : "didn't do it"}`);
    this.app.note(`🎲 ${r.text}`, { pose: cmd.pose, says: cmd.says, seen, instead: wrong, score: this.score, round: this.round });
    // Say the result out loud, so you can follow the game without looking at the screen (Liz).
    // All fixed lines: cached, so they play instantly.
    if (r.point && this.round < ROUNDS) await this.speak(cmd.says ? OKS[Math.floor(Math.random() * OKS.length)] : TRAP_OK);
    else if (!r.point) await this.speak(!cmd.says ? trapLine(TRAP_OPENERS[Math.floor(Math.random() * TRAP_OPENERS.length)])
      : r.wrong ? wrongLine(r.wrong) : "Too slow!");
  }

  render(big, small) {
    setProp("ss-command", "textContent", big);
    setProp("ss-result", "textContent", small);
    this.emit({ type: "say", big, small });
    setProp("ss-score", "textContent", this.running || this.round
      ? `Round ${this.round} of ${ROUNDS} · Score ${this.score ?? 0} · Window ${((this.window ?? START_WINDOW) / 1000).toFixed(1)} s` : "");
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
  card.replaceChildren(sizer(value), half("upper", value), half("lower", value));
}
// An invisible copy of the number sets the card's width, so 18 (or 118) fits with room either side.
function sizer(value) {
  const s = document.createElement("span");
  s.className = "sizer";
  s.textContent = String(value);
  s.setAttribute?.("aria-hidden", "true");
  return s;
}

// Split-flap: the new number appears behind the top half, the old top half folds down on the hinge,
// and lands as the new bottom half.
function flip(card, from, to) {
  card.replaceChildren(sizer(Math.max(from, to)), half("upper", to), half("lower", from));
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
// says "Simon". Each score always gets the same line (picked by the total), so it can be saved once.
// The taunt is a separate short line, picked at random (see sayScore): the voice model said the first
// few words of two-sentence versions ("Seven for me, zero for you. Come on, show me what you've got!")
// and then went silent for 10 s. Taunts contain no numbers, so each is saved once and reused.
const AHEAD = [
  (me, you) => `It's ${me} to ${you}.`,
  (me, you) => `${cap(me)} for me, ${you} for you.`,
  (me, you) => `It's ${me} to ${you} in my favor.`,
];
const LEVEL = [(me) => `${cap(me)} all.`, (me) => `${cap(me)} each.`];
const BEHIND = [(me, you) => `You lead ${you} to ${me}.`, (me, you) => `${cap(you)} for you, ${me} for me.`];
// Cheeky when he's ahead, a good sport when he's behind, and aware of who just won: 47 to 33 up but just
// beaten, "Are you even trying?" made no sense (Liz, 2026-09-26: "you're gaining on me" fits).
const TAUNTS = {
  ahead: ["Advantage me!", "Come on, try harder!", "Show me what you've got!", "Getting comfortable up here.", "Are you even trying?"],
  aheadButBeaten: ["Uh oh, you're gaining on me!", "Catching up, are we?", "Think you can catch me?", "Enjoy it while it lasts!"],
  level: ["Anybody's game!", "All square!"],
  behind: ["Not for long!", "I'm coming for you!"],
  behindAndBeaten: ["You're on a roll!", "Okay, you're good.", "Don't get too comfy!"],
};
const side = (simon, you) => (simon > you ? "ahead" : simon === you ? "level" : "behind");
const cap = (t) => t[0].toUpperCase() + t.slice(1);
export function scoreLine(simon, you) { return scoreLines(simon, you)[0]; }
// Every wording of this score, the usual one first. If the voice model gets one wrong (runs on or
// mumbles; it always does the same for the same sentence), the game uses the next.
export function scoreLines(simon, you) {
  const set = { ahead: AHEAD, level: LEVEL, behind: BEHIND }[side(simon, you)];
  const pick = set === LEVEL ? simon : simon + you;   // a level total is always even, so use one side
  return set.map((_, i) => set[(pick + i) % set.length](words(simon), words(you)));
}
// winner: who won the game just played ("simon" | "you"); without it, the plain side of the all-time score.
export const taunts = (simon, you, winner) => {
  const where = side(simon, you);
  if (winner === "you" && where === "ahead") return TAUNTS.aheadButBeaten;
  if (winner === "you" && where === "behind") return TAUNTS.behindAndBeaten;
  return TAUNTS[where];
};

// Up to 99 in words ("twenty-one"): past twenty the voice was handed digits ("It's 21 to nine", 2026-09-26).
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export function words(n) {
  if (NUMBER_WORDS[n] != null) return NUMBER_WORDS[n];
  if (Number.isInteger(n) && n > 20 && n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${NUMBER_WORDS[n % 10]}` : "");
  return String(n);
}
