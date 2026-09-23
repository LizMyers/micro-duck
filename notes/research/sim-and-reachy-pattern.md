# Research · A duck without a duck (simulation) + the Reachy Mini pattern

*Read 2026-09-23.*

## Simulation options (ranked)
1. **Pollen's browser simulator (chosen).** Space `pollen-robotics/microduck-simulator` (Apache-2.0;
   React + Vite, MuJoCo compiled to WASM, `onnxruntime-web` running the real trained policies).
   - Beak already animates: `setJawOpen(rig, 0..1)` — `app/src/game/duck.js:334`.
   - JS control API on `window.rl` — `app/src/game/game.js:2173`: `triggerKick`, `triggerRoll`,
     `triggerGroundPick`, `triggerCrouch`, `velCmd`, `headTarget`, `jawOpenNow`, `loadCustomPolicy(ref)` (Hub
     policies like `fffiloni/microduck-polite-bow-b1d864`).
   - Quack WAVs in `public/assets/voices/duck1/`; sound currently disabled (`SOUND_DISABLED = true`).
   - Clone tip: the Space uses LFS → `GIT_LFS_SKIP_SMUDGE=1 git clone …` then `git lfs pull` / `git restore`.
2. **microduck_rl + MuJoCo in Python.** `scripts/infer_policy.py` runs ONNX policies on CPU (Mac OK) with just
   `mujoco onnxruntime better-actuator-models numpy`. 14 joints, **no beak joint** in the MJCF.
   Policy command = 13 floats `[vx, vy, wz, head(4), body(6)]`.
3. **Real `robotd` against a sim body** (`microduck/scripts/duck-sim`). Same API as the real robot, but Rust build +
   Linux-only audio (`aplay`). Too risky for the deadline.

Pretrained policies: Hub `pollen-robotics/microduck-policies` (walking, stand, sit/stand, ground pick, roulade,
ball kicks, roller).

## Pattern to copy: `pollen-robotics/reachy_mini_conversation_app`
- Realtime client pointed at a speech-to-speech server (`huggingface_realtime.py`, port 8765), server-side VAD.
- **Barge-in:** on `input_audio_buffer.speech_started` → clear playback queue + robot "listening" pose;
  `speech_stopped` → release.
- **Latency metric:** "first audio delta N ms after user transcript".
- **Tools:** one class per tool (`play_emotion`, `move_head`, `dance`…), run in the background on
  `response.function_call_arguments.done`, answered with `function_call_output`.
- **Motion:** a single ~100 Hz worker owns the robot pose; idle "breathing"; freeze while listening.
- **Audio-driven motion:** head "wobbles" to the assistant's audio → for us: beak follows the mouth track.
- **Personalities:** `profiles/<name>/profile.md` + per-profile tools. Nice dev-rel hook: *duck personalities*.
