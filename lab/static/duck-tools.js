// Tools: actions the language model may ask the page to perform on the duck.
//
// We describe each tool to the model (name, what it does, what inputs it takes)
// in the session settings. When the model decides to use one, the agent sends
// `response.function_call_arguments.done` with the tool's name and arguments;
// the page runs it on the simulator and reports back with a
// `function_call_output`, so the model knows it happened.

export const TOOLS = [
  {
    type: "function",
    name: "sit_down",
    description: "Make the duck sit down on the floor. Use when asked to sit.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "stand_up",
    description: "Make the duck stand back up after sitting. Use when asked to stand or get up.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// What each tool does on the simulator. Returns a short result for the model.
export function runTool(rl, name) {
  if (!rl) return { ok: false, error: "The duck's body isn't connected." };
  switch (name) {
    case "sit_down":
      if (rl.sitting) return { ok: true, note: "Already sitting." };
      rl.sit();
      return { ok: true, note: "Sitting down." };
    case "stand_up":
      if (!rl.sitting) return { ok: true, note: "Already standing." };
      rl.stand();
      return { ok: true, note: "Standing up." };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

// Friendly labels for the conversation panel.
export const TOOL_LABELS = { sit_down: "sits down", stand_up: "stands up" };
