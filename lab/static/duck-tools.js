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

const count = (what, dflt, max) => ({
  type: "object",
  properties: { [what]: { type: "number", description: `Default ${dflt}, at most ${max}.` } },
  required: [],
});

// Deliberately simple: one action per tool, at most one number. Small local
// models fill in multi-field tools unreliably (e.g. step(forward=1)).
export const TOOLS = [
  { type: "function", name: "sit_down", description: "Sit down.", parameters: noArgs },
  { type: "function", name: "stand_up", description: "Stand back up.", parameters: noArgs },
  { type: "function", name: "step_forward", description: "Step forward.", parameters: count("steps", 1, 10) },
  { type: "function", name: "step_back", description: "Step backward.", parameters: count("steps", 1, 10) },
  { type: "function", name: "turn_left", description: "Turn left on the spot.", parameters: count("degrees", 90, 720) },
  { type: "function", name: "turn_right", description: "Turn right on the spot.", parameters: count("degrees", 90, 720) },
  { type: "function", name: "bow", description: "Take a polite bow.", parameters: noArgs },
  { type: "function", name: "kick_left_leg", description: "Kick up your left leg.", parameters: noArgs },
  { type: "function", name: "kick_right_leg", description: "Kick up your right leg.", parameters: noArgs },
  { type: "function", name: "skates_on", description: "Put your roller skates on.", parameters: noArgs },
  { type: "function", name: "skates_off", description: "Take your roller skates off.", parameters: noArgs },
];

const n = (v, d, max) => Math.max(1, Math.min(max, Math.round(Number(v) || d)));
export const TOOL_LABELS = {
  sit_down: () => "sits down",
  stand_up: () => "stands up",
  step_forward: (a) => `steps forward ×${n(a.steps, 1, 10)}`,
  step_back: (a) => `steps back ×${n(a.steps, 1, 10)}`,
  turn_left: (a) => `turns left ${n(a.degrees, 90, 720)}°`,
  turn_right: (a) => `turns right ${n(a.degrees, 90, 720)}°`,
  bow: () => "takes a bow",
  kick_left_leg: () => "kicks its left leg",
  kick_right_leg: () => "kicks its right leg",
  skates_on: () => "puts its skates on",
  skates_off: () => "takes its skates off",
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
  needLegs(rl, "bow");
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
  needLegs(rl, "kick");
  await ensureStanding(rl);
  rl.triggerKick(side === "left" ? "left" : "right", "agent");
  await until(() => rl.mode !== "walk", 1000);
  await until(() => rl.mode === "walk", 4000);
}

// Roller skates: the simulator swaps to a separate skating body and policy.
async function setSkates(rl, on) {
  const want = on ? "rollers" : "legs";
  if (rl.loco === want) return;
  rl.setLoco(want);
  const ok = await until(() => rl.loco === want && !rl.locoSwitching, 15000);
  if (!ok) throw new Error(on ? "couldn't get the skates on" : "couldn't get the skates off");
  await until(() => !rl.inputLocked, 5000);
}

const needLegs = (rl, what) => {
  if (rl.loco === "rollers") throw new Error(`can't ${what} with skates on (take them off first)`);
};

async function doSit(rl) {
  needLegs(rl, "sit");
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
  step_forward: (rl, a) => doStep(rl, "forward", a.steps),
  step_back: (rl, a) => doStep(rl, "backward", a.steps),
  turn_left: (rl, a) => doTurn(rl, "left", a.degrees),
  turn_right: (rl, a) => doTurn(rl, "right", a.degrees),
  bow: (rl) => doBow(rl),
  kick_left_leg: (rl) => doKick(rl, "left"),
  kick_right_leg: (rl) => doKick(rl, "right"),
  skates_on: (rl) => setSkates(rl, true),
  skates_off: (rl) => setSkates(rl, false),
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
