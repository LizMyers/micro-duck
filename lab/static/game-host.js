// Plugs the Simon Says game (simon-says.js, which knows nothing about the page) into the camera,
// Simon's voice lines and his body. Both pages use it.

import { state, ctx, sleep } from "/static/core.js";
import { THRESHOLDS } from "/static/pose.js";
import { SimonSaysGame } from "/static/simon-says.js";
import { ensureAudio, setMic } from "/static/audio.js";
import { cam, startCamera, calibrate } from "/static/camera.js";
import { sayLine, prepareLine, prewarmLines, badLines, warm } from "/static/voice-lines.js";
import { rememberSaid } from "/static/agent.js";

// setupOnPage: the page sets up and calibrates the camera before Start (the game page); otherwise the
// game does it by voice with a countdown before each game (the lab).
// isSetUp / needSetup (game page): whether the camera is set up, and how to show the setup.
// onGame (game page): told what's happening in the game, to draw its screens (see SimonSaysGame.emit).
export function makeGame({ beforeGame, setupOnPage = false, isSetUp, needSetup, onGame } = {}) {
  const body = ctx.body;
  const game = new SimonSaysGame({
    tracker: () => cam.tracker,
    ready: () => state.agentStatus !== "ready" || state.modelBusy ? "Waiting for the model: STATUS must be READY." : null,
    // Starting a game turns the camera on and waits until it sees you; the game then calibrates (countdown).
    prepare: async () => {
      await ensureAudio(); await state.audio.ctx.resume(); await setMic(false);
      beforeGame?.();
      // The illusion that Simon sees you: wherever he has wandered, the view swings round in front of
      // him, head level, so he's looking straight out at the player.
      body.setMood("idle");
      body.lookAt(null);
      body.faceCamera();
      if (!cam.on) await startCamera({ forGame: true });
      if (!cam.on) return "The camera didn't start: allow camera access, then start again.";
      for (let t = 0; t < 8000 && !cam.tracker?.latest?.landmarks; t += 200) await sleep(200);
      return cam.tracker?.latest?.landmarks ? null
        : "The camera can't see you: sit where your head and shoulders are in view, then start again.";
    },
    setupOnPage, isSetUp, needSetup, onGame,
    sayLine,
    prepareLine,
    isBad: (text) => badLines.has(text),
    thresholds: THRESHOLDS,
    calibrate,
    warming: () => (warm.running ? `Warming up Simon's lines: ${warm.done} of ${warm.total}. You can start any time.` : null),
    lookAt: (dir) => body.lookAt(dir),
    // Simon celebrates winning: a happy head bob (up, down, up) while he gloats.
    celebrate: () => ["up", "down", "up", null].forEach((d, i) => setTimeout(() => body.lookAt(d), i * 350)),
    note: (text, data, kind) => ctx.inspector.note(text, data, kind),
    remember: (text) => rememberSaid(text),
    // After a game, carry on pre-warming whatever is still missing (and the next game's two scores).
    gameOver: () => setTimeout(() => prewarmLines(game.linesToWarm()), 1500),
  });
  return game;
}
