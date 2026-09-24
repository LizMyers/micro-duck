# Upstream candidates for huggingface/speech-to-speech (found while building Duck Lab)

| # | Issue | Status |
|---|---|---|
| 1 | Positional tool-call args (`turn('left', 360)`) silently dropped | ✅ fixed on branch `tool-call-positional-args` (d48083e), tests added |
| 2 | Qwen falls back to native `<tool_call>{json}</tool_call>` after tool turns; block was spoken aloud | ✅ fixed on same branch (ce56257), tests added |
| 3 | Gemma 3 (MLX): generation doesn't stop at `<end_of_turn>` → hundreds of `<end_of_turn>` tokens streamed to TTS | open |
| 4 | Gemma 3 chat template rejects consecutive user messages ("roles must alternate") after a cancelled reply | open — merge consecutive same-role messages before templating? |
| 5 | Benchmark script requires HF_TOKEN even for localhost | open (tiny) |
| 6 | Long sessions: prompt grows to 2k+ tokens → 9–13 s replies → user fills the silence → reply cancelled → turns merge (loop) | design discussion: context trimming / "thinking" feedback |
