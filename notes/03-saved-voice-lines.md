# 03 · Saved voice lines

*2026-09-26*

## The problem
Every fixed game line ("Simon says, look up.", "Too slow!", the score…) has to be made by the voice model
the first time it's needed: 1.3–2 s of thinking before Simon makes a sound. Pre-warming (making every line
silently once the model is ready) fixed the *first game*, but the cache lived in the page, so every reload,
server restart or fresh clone started cold again. And each new take could sound a little different.

## What we built
- **Server** (`lab/server.py`): `GET /api/lines/<voice>` lists saved lines, `POST /api/lines/<voice>` saves one
  (a 16-bit mono 24 kHz WAV, sent as base64) into `lab/lines/<voice>/`, with an `index.json` mapping each
  sentence to its file. `/lines/` serves the files.
- **Page** (`lab/static/app.js`): when the session is ready, we load that voice's saved lines into the cache
  *before* pre-warming, so pre-warming only makes what's missing. Every line that makes it into the cache
  is saved (💾 in the Inspector). Changing the voice clears the cache and loads that voice's lines.
- Lines are saved **per voice**, so switching to another voice never replays Aiden.

## Redoing a bad take
Delete its `.wav` from `lab/lines/aiden/`. The server leaves out lines whose file is missing, so Simon makes
it again next time. Lines flagged `"cut": true` in `index.json` are ones where the voice model ran on and we
cut it off: worth a listen.

## Gotchas
- Pre-warmed lines are made silently, so nobody hears them: we check the transcript matches the words we
  asked for before keeping (and now saving) one.
- The lines are committed to the repo on purpose, so a fresh clone gets the same Simon straight away.
