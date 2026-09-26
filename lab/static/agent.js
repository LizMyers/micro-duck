// Talking to Hugging Face's speech-to-speech agent over one WebSocket (the OpenAI Realtime protocol):
//   we send  → session.update (settings), input_audio_buffer.append (20 ms of mic audio), response.create
//   we get   ← speech_started/stopped, transcripts, response.output_audio.delta (Simon's voice), tool calls
// The agent serves one reply at a time on one connection: see turn-taking.js for why that matters.

import { RATE, state, ctx, toast, base64Pcm16ToFloat } from "/static/core.js";
import { setMic, setTalkLabel, stopPlayback, playChunk, isPlaying, whenQuiet } from "/static/audio.js";
import { userBubble, renderUser, botBubble, renderBot, finishBotBubble } from "/static/chat.js";
import { noteCancel, watchForReply, replied, nodIfBusy } from "/static/turn-taking.js";
import { onLineAudio, finishLine, loadSavedLines, prewarmLines, resumeWarm, warm } from "/static/voice-lines.js";

// Added to every personality: small models happily *say* "I'm sitting!" without actually calling the
// tool, so the lab spells out that Simon has a body to move (only when it offers the move tools).
const BODY_RULES =
  "\n\nYou have a small robot duck body you can really move with your tools: " +
  "sit_down, stand_up, step_forward, step_back, turn_left, turn_right, bow, kick_left_leg, " +
  "kick_right_leg, skates_on, skates_off. Whenever someone asks you to move (sit, stand, step, walk, " +
  "turn, spin, bow, kick, lift a leg, skate), you MUST call the matching tool. " +
  "Never just say you are doing it. Keep what you say about it to a few words. ";
// Small models happily claim to see. Simon can't: the webcam referee runs separately in the page.
const GAME_RULES =
  "You cannot see: you have no eyes or camera. A separate camera referee judges the players' moves; " +
  "you only hear what people say. If asked what you can see, say you can't see. " +
  "If someone wants to play Simon Says, a rematch, or another game, call play_simon_says.";

// Starting a game by voice ("I want a rematch!"). The page runs the game; the model just starts it.
const GAME_TOOL = {
  type: "function", name: "play_simon_says",
  description: "Start a game of Simon Says with the player (also for a rematch or playing again).",
  parameters: { type: "object", properties: {}, required: [] },
};

export function sessionUpdate(interrupt = true) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: ctx.instructions() + (ctx.tools.length ? BODY_RULES : "\n\n") + GAME_RULES,
      tools: [...ctx.tools, GAME_TOOL],
      tool_choice: "auto",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: RATE },
          turn_detection: { type: "server_vad", interrupt_response: interrupt },
        },
        output: { format: { type: "audio/pcm", rate: RATE }, voice: ctx.voice() },
      },
    },
  };
}

export function connect() {
  if (state.ws) return;
  const ws = new WebSocket(state.options.agent_url);
  state.ws = ws;
  const talk = document.getElementById("talk");
  ws.onopen = () => {
    ctx.inspector.note(`Connected to the agent at ${state.options.agent_url}`);
    const settings = sessionUpdate();
    ws.send(JSON.stringify(settings));
    ctx.inspector.message("out", settings);
    if (talk) talk.disabled = false;
  };
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    ctx.inspector.message("in", ev);
    // The model serves one page at a time; a second page is told so, then closed (code 1008).
    if (ev.type === "error" && ev.error?.type === "session_limit_reached") setBusy(true);
    else if (ev.type === "session.created" || ev.type === "session.updated") setBusy(false);
    if (ev.type === "session.updated" && state.quietUpdates > 0) state.quietUpdates--;   // just the interrupt switch
    else if (ev.type === "session.updated") setTimeout(() => loadSavedLines().then(() => prewarmLines(ctx.game.linesToWarm())), 500);
    onAgentEvent(ev);
  };
  ws.onclose = (e) => {
    if (state.ws === ws) state.ws = null;
    if (talk) talk.disabled = true;
    setMic(false);
    if (e.code === 1008) setBusy(true);
    // If the model is still up (e.g. the socket dropped), try again: slowly while another tab has it.
    if (state.agentStatus === "ready") setTimeout(connect, state.modelBusy ? 5000 : 1500);
  };
}

export function disconnect() {
  const ws = state.ws;
  state.ws = null;
  if (ws) ws.close();
  stopPlayback();
}

export function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(obj));
    ctx.inspector.message("out", obj);
  } else if (obj.type !== "input_audio_buffer.append") {
    ctx.inspector.note(`not sent (not connected): ${obj.type}`, obj, "err");
  }
}

// Some messages must wait until the agent isn't in the middle of a reply.
const idleQueue = [];
export function whenIdle(fn) {
  if (!state.responding) fn(); else idleQueue.push(fn);
}
function flushIdle() {
  while (!state.responding && idleQueue.length) idleQueue.shift()();
}

// Ask for a spoken reply that can't trigger another move.
export function sayOnly(instructions) {
  send({ type: "response.create", response: { tool_choice: "none", instructions: ctx.instructions() + "\n\n" + instructions } });
}

function setBusy(busy) {
  if (state.modelBusy === busy) return;
  state.modelBusy = busy;
  ctx.inspector.note(busy ? "Model busy: another Duck Lab tab is connected to it" : "Connected to the model", null, busy ? "err" : undefined);
  ctx.os?.setBusy(busy);
  setTalkLabel();
}

function onAgentEvent(ev) {
  const body = ctx.body;
  switch (ev.type) {
    case "input_audio_buffer.speech_started": {
      state.followUps = 0;
      warm.heardYou = true;   // you come first: pre-warming pauses
      state.userSpeaking = true;
      nodIfBusy();
      // Barge-in: if you start talking while it's replying, it stops.
      const wasTalking = isPlaying() || (state.botBubble && !state.botBubble.done);
      stopPlayback();
      if (state.botBubble && !state.botBubble.done) finishBotBubble("interrupted");
      if (wasTalking) body.setMood("interrupted", { holdMs: 700, then: "listening" });
      else body.setMood("listening");
      if (!state.turn || state.turn.done) ctx.relay.newTurn();
      break;
    }
    case "input_audio_buffer.speech_stopped":
      if (state.turn) state.turn.stoppedAt = performance.now();
      state.userSpeaking = false;
      body.setMood("thinking");
      break;
    case "conversation.item.input_audio_transcription.delta":
      userBubble(ev.item_id).text += ev.delta;
      renderUser(ev.item_id);
      break;
    case "conversation.item.input_audio_transcription.completed":
      userBubble(ev.item_id).text = ev.transcript;
      userBubble(ev.item_id).final = true;
      renderUser(ev.item_id);
      state.lastHeard = ev.transcript;
      watchForReply(ev.transcript);
      break;
    case "response.created":
      state.responding = true;
      if (ev.response?.conversation_id) replied();   // an answer to you (game lines use conversation "none")
      if (!state.line?.silent) botBubble();
      break;
    case "response.output_audio_transcript.delta":
      if (state.line) state.line.heard += ev.delta;   // what Simon actually said (checked, or shown in the game)
      if (state.line?.silent) break;
      botBubble().text += ev.delta;
      renderBot();
      break;
    case "response.output_audio.delta":
      if (state.turn && !state.turn.firstAudioAt) state.turn.firstAudioAt = performance.now();
      if (state.line) { onLineAudio(state.line, ev.delta); break; }
      if (body.mood !== "speaking") body.setMood("speaking");
      playChunk(base64Pcm16ToFloat(ev.delta));
      break;
    case "response.function_call_arguments.done": {
      // The model wants something done. Tell it straight away that it has started (the agent won't
      // talk again until it hears back); the lab follows up if a duck move fails.
      let args = {};
      try { args = JSON.parse(ev.arguments || "{}"); } catch {}
      if (ev.name === "play_simon_says") {
        const started = ctx.game.startByVoice();
        ctx.inspector.note(`🎲 voice: play_simon_says → ${started ? "starting a game" : "a game is already running"}`, null, "tool");
        state.toolOutputs.push({ call_id: ev.call_id, output: { ok: true, status: started ? "starting" : "already playing" } });
        if (state.botBubble) state.botBubble.acted = true;
        state.gameStartedByVoice = true;   // the game speaks next, so no "say a few words" follow-up
        break;
      }
      ctx.onTool?.(ev, args);
      break;
    }
    case "response.done": {
      const status = ev.response?.status;
      const reason = ev.response?.status_details?.reason;
      if (status === "cancelled") noteCancel(reason);
      // The agent often stops a line because it heard you before the page does: pause pre-warming now,
      // or the next background line pushes in front of you and your turn gets dropped.
      if (reason === "turn_detected") warm.heardYou = true;
      if (state.line) {
        const l = state.line;
        state.line = null;
        finishLine(l, status);
      }
      const spoke = !!state.botBubble?.text;
      state.responding = false;
      if (state.toolOutputs.length) {
        for (const o of state.toolOutputs.splice(0)) {
          send({ type: "conversation.item.create",
            item: { type: "function_call_output", call_id: o.call_id, output: JSON.stringify(o.output) } });
        }
        // It acted without saying anything: let it say a few words, once.
        if (status === "completed" && !spoke && state.followUps < 1 && !state.testing && !state.gameStartedByVoice) {
          state.followUps++;
          sayOnly("Say a few words about what you just did. Don't call any tools.");
        }
      }
      state.gameStartedByVoice = false;
      // You've had your answer: carry on pre-warming (a game you just started pauses it again).
      if (!state.line && warm.paused && status === "completed") setTimeout(resumeWarm, 2000);
      flushIdle();
      finishBotBubble(status === "cancelled" ? "interrupted" : null);
      if (state.turn) { ctx.relay.setStage("voice", "done"); state.turn.done = true; }
      state.warm = true;
      whenQuiet(() => { if (body.mood === "speaking" || body.mood === "thinking") body.setMood("idle"); });
      const waiters = state.waiters.splice(0);
      for (const w of waiters) w(status);
      break;
    }
    case "error": {
      const msg = ev.error?.message || ev.error?.code || "Unknown error";
      if (ev.error?.code === "session_limit_reached") {
        toast(ctx.busyMessage ?? "The agent is busy with another tab. Close other Duck Lab tabs and reload.", 8000);
      } else {
        toast(`Agent error: ${msg}`);
      }
      break;
    }
  }
}
