# Upstream PR draft: tool calling with small local models

*Prepared 2026-09-25 for Liz to review. NOTHING has been pushed or opened yet.*

- **Target:** huggingface/speech-to-speech `main`
- **Branch:** `pr/tool-call-fixes` (local worktree `~/Documents/Development/s2s-pr`), 3 commits rebased onto the latest
  `origin/main` (c5e16e2, #591), no conflicts
- **Checks:** full test suite **1,755 passed, 3 skipped**; `ruff check` clean; `ruff format --check` clean
- **Diff:** 4 files, +303 / −22 (2 source files, 2 test files)

## Needs Liz's OK (public actions)
1. Create the fork `LizMyers/speech-to-speech` on GitHub (`gh repo fork huggingface/speech-to-speech --clone=false`).
2. Push `pr/tool-call-fixes` to the fork.
3. Open the PR with the title and body below (ready-to-review, or as a draft first if you prefer).

---

## Title
Make tool calling robust for small local models (positional args, native `<tool_call>` blocks, no spoken markup)

## Body

## Summary

Three small fixes to local tool-call parsing, found while building a voice-controlled robot duck on
speech-to-speech with Qwen3-4B-Instruct (4-bit, MLX) on a laptop. Each one made the agent either lose a tool
call or read tool-call markup aloud.

1. **Positional arguments were dropped.** Small models often write calls like `turn('left', 360)`. Positional
   values were always discarded, so the call failed validation or lost its arguments.
2. **Native `<tool_call>{json}</tool_call>` blocks were spoken.** Chat templates such as Qwen's render earlier
   tool calls in the history in the model's native JSON syntax. After a few tool turns the model starts
   answering in that syntax instead of the prompted `<code>...</code>` form, and the block went straight to TTS.
3. **Tool markup was spoken when tools are disabled.** A model that saw earlier tool calls can still emit one in
   a `tool_choice: "none"` response; the markup was read aloud.

## What changed

* Bind purely positional arguments to the tool's declared parameters, in order, only when the call is
  unambiguous: no keyword arguments, no more values than parameters, and every value fits its property's
  type/enum. Mixed or mismatched calls keep the previous drop-with-warning behaviour.
* Parse native `<tool_call>{json}</tool_call>` blocks as tool calls (a single object or a list; arguments as
  an object or a JSON string), hold partial blocks until they close, and ignore the markers when no tools
  are active.
* Keep block detection active when no tools are exposed, so tool markup is stripped from speech and never
  executed.

Default behaviour for well-formed calls is unchanged.

## Testing

Added unit tests in `tests/tool_call/test_function_parser.py` and `tests/test_voice_prompt.py` covering:

* positional binding: a pure positional call, fewer values than parameters, enum and type mismatches (not
  bound), booleans are not numbers, too many values (not bound), mixed positional and keyword arguments (keeps
  the previous drop behaviour), and no tool schema (positional values dropped)
* native blocks: a single call, lists and string-encoded arguments, malformed JSON (returns nothing), a partial
  block held until it closes, and markers ignored when no tools are active
* `tool_choice: "none"`: tool blocks are stripped from speech and not run

Full suite: 1,755 passed, 3 skipped. `ruff check` and `ruff format --check` pass.

## Context

Found while building [Simon Says with a robot duck](<repo link once public>): a local voice agent that plays
Simon Says, with a webcam referee and Pollen's Microduck simulator. Developed with Claude Code as a pair
programmer; I reviewed and tested each change against the live agent.

---

## Notes for Liz
- The PR is small and self-contained, which reviewers like. Three related fixes, one theme.
- Commit messages already explain each fix; the commits carry the `Co-Authored-By: Claude` line, matching the
  AI-assistance line in the body. Honest, and consistent.
- Next PR candidate (B for "A"): local MLX model ignores per-response `max_output_tokens`
  (`LLM/language_model.py` uses the global `max_new_tokens`). Needs a fix + tests; separate PR.
- Swap `<repo link once public>` for the micro-duck repo URL once B is done, or drop the link and keep the
  sentence.
