// Tools: actions the language model may ask the page to perform on the duck.
//
// We describe each tool to the model (name, what it does, what inputs it takes)
// in the session settings. When the model decides to use one, the agent sends
// `response.function_call_arguments.done` with the tool's name and arguments;
// the page runs it on the simulator and reports back with a
// `function_call_output`, so the model knows it happened.
//
// Moves take time (a bow lasts 4 s), so they go into a queue and play one after
// another. The same `perform()` is used by the Simon Says game master.

const noArgs = { type: "object", properties: {}, required: [] };

export const TOOLS = [
  {
    type: "function", name: "sit_down",
    description: "Make the duck sit down on the floor.",
    parameters: noArgs,
  },
  {
    type: "function", name: "stand_up",
    description: "Make the duck stand back up after sitting.",
    parameters: noArgs,
  },
  {
    type: "function", name: "turn",
    description: "Turn the duck on the spot, to its left or right, by some degrees (90 = quarter turn, 360 = full circle).",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["left", "right"] },
        degrees: { type: "number", description: "How far to turn, 10 to 720. Default 90." },
      },
      required: ["direction"],
    },
  },
  {
    type: "function", name: "step",
    description: "Take steps forward or backward (default one step).",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["forward", "backward"] },
        steps: { type: "number", description: "How many steps, 1 to 10. Default 1." },
      },
      required: ["direction"],
    },
  },
  {
    type: "function", name: "raise_leg",
    description: "Kick one leg up (the duck's own left or right leg).",
    parameters: {
      type: "object",
      properties: { side: { type: "string", enum: ["left", "right"] } },
      required: ["side"],
    },
  },
  {
    type: "function", name: "bow",
    description: "Take a polite bow.",
    parameters: noArgs,
  },
];

export const TOOL_LABELS = {
  sit_down: () => "sits down",
  stand_up: () => "stands up",
  turn: (a) => `turns ${a.direction || "left"} ${a.degrees || 90}°`,
  step: (a) => {
    const n = Math.max(1, Math.min(10, Math.round(a.steps || 1)));
    return `takes ${n} step${n > 1 ? "s" : ""} ${a.direction === "backward" ? "back" : "forward"}`;
  },
  raise_leg: (a) => `kicks up its ${a.side || "right"} leg`,
  bow: () => "takes a bow",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const BOW_URL = `${location.origin}/moves/polite-bow/policy.onnx`;

async function until(test, timeoutMs, stepMs = 50) {
  const t0 = performance.now();
  while (!test()) {
    if (performance.now() - t0 > timeoutMs) return false;
    await sleep(stepMs);
  }
  return true;
}

// Most moves start from standing: stand up first if it's sitting.
async function ensureStanding(rl) {
  if (rl.mode === "walk") return;
  if (rl.mode === "sitstand") rl.stand();
  await until(() => rl.mode === "walk", 4000);
  await sleep(300);
}

async function doTurn(rl, direction, degrees) {
  await ensureStanding(rl);
  const target = (Math.min(720, Math.max(10, Number(degrees) || 90)) * Math.PI) / 180;
  const sign = direction === "right" ? -1 : 1;     // positive turn rate = left
  const rate = rl.velLimits?.[2] ?? 1;
  let prev = rl.yaw, turned = 0;
  const t0 = performance.now(), maxMs = (target / rate) * 1000 * 2 + 2000;
  rl.setTwist(0, 0, sign * rate);
  // Keep turning until we've rotated far enough. Count signed progress in the
  // turn direction, so the waddle's side-to-side wiggle cancels out.
  while (turned < target && performance.now() - t0 < maxMs) {
    await sleep(20);
    const y = rl.yaw;
    turned += sign * wrapPi(y - prev);
    prev = y;
  }
  rl.setTwist(0, 0, 0);
  await sleep(400);
  return { turned_degrees: Math.round((turned * 180) / Math.PI) };
}

// One "step" = about one stride of the little duck. We stop by distance
// travelled, not by time, so it's the same on a fast or a slow computer.
const STEP_M = 0.06;
const pos = (rl) => [rl.data.qpos[0], rl.data.qpos[1]];

async function doStep(rl, direction, steps) {
  await ensureStanding(rl);
  const n = Math.max(1, Math.min(10, Math.round(Number(steps) || 1)));
  const back = direction === "backward";
  const [x0, y0] = pos(rl);
  const yaw = rl.yaw;
  const fwdX = Math.cos(yaw), fwdY = Math.sin(yaw);
  const along = () => { const [x, y] = pos(rl); return (x - x0) * fwdX + (y - y0) * fwdY; };
  rl.setTwist(back ? -0.12 : 0.15, 0, 0);
  await until(() => Math.abs(along()) >= n * STEP_M, n * 4000 + 2000, 20);
  rl.setTwist(0, 0, 0);
  await sleep(500);
  return { moved_cm: Math.round(along() * 100) };
}

async function doBow(rl) {
  await ensureStanding(rl);
  // The bow is a community-trained move; it lives in the simulator's "trick" slot.
  if (rl.customPolicy?.slot !== "trick") {
    await rl.loadCustomPolicy(BOW_URL);
    if (rl.customPolicy?.slot !== "trick") throw new Error("the bow move didn't load");
  }
  rl.triggerRoll("agent");
  await until(() => rl.mode !== "walk", 1000);
  await until(() => rl.mode === "walk", 7000);
}

async function doKick(rl, side) {
  await ensureStanding(rl);
  rl.triggerKick(side === "left" ? "left" : "right", "agent");
  await until(() => rl.mode !== "walk", 1000);
  await until(() => rl.mode === "walk", 4000);
}

async function doSit(rl) {
  if (rl.sitting) return;
  await ensureStanding(rl);
  rl.sit();
  const ok = await until(() => rl.sitting, 3000);
  if (!ok) throw new Error("didn't manage to sit");
}

async function doStand(rl) {
  if (rl.mode !== "sitstand") return;
  rl.stand();
  await until(() => rl.mode === "walk", 4000);
}

const MOVES = {
  sit_down: (rl) => doSit(rl),
  stand_up: (rl) => doStand(rl),
  turn: (rl, a) => doTurn(rl, a.direction, a.degrees),
  step: (rl, a) => doStep(rl, a.direction, a.steps),
  raise_leg: (rl, a) => doKick(rl, a.side),
  bow: (rl) => doBow(rl),
};

// One move at a time, in order.
let queue = Promise.resolve();

export function perform(rl, name, args = {}) {
  const move = MOVES[name];
  if (!move) return Promise.reject(new Error(`Unknown move: ${name}`));
  if (!rl) return Promise.reject(new Error("The duck's body isn't connected."));
  // Moves are ignored while the simulator's controls are locked (its intro).
  const run = queue.then(() => until(() => !rl.inputLocked, 10000)).then(() => move(rl, args));
  queue = run.catch(() => {});
  return run;
}

// For the language model: do the move, then report what really happened.
export async function runTool(rl, name, args = {}) {
  if (!MOVES[name]) return { ok: false, error: `Unknown tool: ${name}` };
  if (!rl) return { ok: false, error: "The duck's body isn't connected." };
  try {
    const measured = await perform(rl, name, args);
    if (measured?.moved_cm !== undefined && Math.abs(measured.moved_cm) < 2) {
      return { ok: false, error: "Tried, but the duck didn't actually move.", ...measured };
    }
    if (measured?.turned_degrees !== undefined && Math.abs(measured.turned_degrees) < 10) {
      return { ok: false, error: "Tried, but the duck didn't actually turn.", ...measured };
    }
    return { ok: true, done: TOOL_LABELS[name](args), ...(measured || {}) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
