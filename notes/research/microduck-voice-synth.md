# Research · How Microduck's voice works

*Source: `pollen-robotics/microduck` @ main, `sounds/` crate (Apache-2.0). Read 2026-09-23.*
*`sounds` is a Rust port of `apirrone/microduck_sounds` (numpy) — that repo has **no license**, so we port from the Rust.*

## One duck, one voice
- Seed = first 4 bytes (big-endian u32) of `SHA-256(SoC serial)` (`/proc/device-tree/serial-number`, fallback
  `/etc/machine-id`). `DUCK_IDENTITY` env var overrides it (the sim uses this) — `sounds/src/lib.rs:132-159`.
- A seeded RNG draws ~20 personality traits in fixed order (`personality.rs:69-104`):
  pitch (`register`, `pitch_center` 110–620 Hz, spread, glide bias) · timbre (brightness, tilt, nasal,
  harmonic skew, formant position/gain) · motion (vibrato, jitter, breath, **quackiness**, AM rate 18–55 Hz) ·
  timing (attack sharpness, speed 0.82–1.22).
- RNG is xoshiro256++ seeded via splitmix64 → bit-exact port needed if we want a *real* duck's voice.

## Synthesis (48 kHz)
- **Additive**: 7 harmonics, weights `1/n^tilt` + brightness lift + nasal boost + formant bump.
- **Quack buzz** = amplitude modulation `1 − am_depth·quackiness·(0.5 + 0.5·sin 2π·am_rate·t)`.
- Breath = pink-ish noise (leaky integrator, pole 0.985). Pitch has vibrato + smoothed jitter.
- **Live synth `Stream`** (`stream.rs`): control-rate `set(hz, level, open)` + `set_formant_shift`, each smoothed
  by a one-pole glide (pitch 45 ms, level 30 ms, open & formant 60 ms). Mouth `open` brightens the tone
  (tilt −0.8·open). Output `tanh(v·level)`. Block-size invariant (tested).

## Vowels (from the chorale, `chorale/mod.rs:150-185`)
| vowel | mouth open | formant shift |
|---|---|---|
| ah | 0.90 | 0 |
| eh | 0.65 | +1 |
| ee | 0.45 | +3 |
| oh | 0.55 | −1 |
| oo | 0.35 | −2 |
| mm | 0.05 (level ×0.65) | −2 |

## The beak rule ✨
The **same** `open` value drives the beak servo and the synth — "one gesture", heard and seen
(`robotd/src/sound.rs:117`, `theremin.rs:13`). → Our creature TTS should emit a **mouth track** alongside
the audio, not derive the beak from loudness afterwards.

## Bank sounds (pre-rendered, 10–12 variants each)
`alarm` · `greet` · `inquire` (questioning) · `peck` · `chirp` · `coo` (petting) · `wheee`.
Emotion = which tag + the shape of the pitch contour.

## Porting notes
- ~300 lines of numpy for Personality + Stream + vowels. Pure-Python per-sample loops are too slow →
  vectorise per 256-sample chunk (`scipy.signal.lfilter` with carried state) or numba.
- Keep the Apache-2.0 notice + attribution; mark our changes.
