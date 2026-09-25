# Ideas parked for later

## Multiplayer Simon Says (v2) — Liz, 2026-09-23
Pollen's sim is secretly multiplayer ("ghosts": every open sandbox broadcasts its duck over WebRTC, discovered via
public Nostr relays, `game/ghosts.js`). Use that channel for a party game:
- One game master (Simon) broadcasts each command + whether "Simon says" was said, with a shared start time.
- Each player's browser judges its own webcam and broadcasts OUT / still in.
- Anyone who moves on a command without "Simon says…" is automatically OUT.
- Needs: shared round clock, join/leave/lag handling, a privacy choice (public relays → opt-in rooms with a code).
- Tutorial seed: *"Turn a voice game into a party game with peer-to-peer WebRTC."*
Ghosts are currently disabled in embed mode (`sim/embed-and-jaw.patch`) — re-enable when building this.

## Mini-tutorial series outline (Liz, 2026-09-23)
1. An open voice agent on your laptop (speech-to-speech, local models, where the latency goes)
2. Talking to a robot: tools, honest agents, and building the Inspector first
3. Your webcam as a referee: body tracking in the browser (MediaPipe, privacy, left vs right)
4. Build a voice game master: Simon (the duck) says — timing, tricks, turn-taking
5. **Take it further:** multiplayer Simon Says over peer-to-peer WebRTC (see above)

## Simon Says v1 — vocabulary decided (Liz, 2026-09-23)
Rule: every command is something **both Simon and the player** can do, and the webcam can judge.
- take 1–2 steps **forward | back**   → player: grows/shrinks in frame (shoulder width vs calibration)
- turn **left | right**               → player: shoulders rotate / face turns away
- look **up | down | left | right**   → player: head pitch / yaw from face landmarks (left/right = the mirror trap)
- **sit down | stand up**             → player: head drops a lot / returns to calibrated height
Not in v1: arm moves (Simon has no arms), "Quack!" (mic-judged), bow, kick, skates.
Still to build: look_* moves for Simon (head poses exist), new pose checks for steps/turns/looks, the game master.

## Launch copy
- **LinkedIn headline (Liz):** "Play Simon Says with Your Microduck"

## Simulator settings worth a tutorial (2026-09-25)
Found in Pollen's simulator source (`microduck-simulator/app/src`, URL options + `window.__gameApi`):
- `?move=<ref>` / `?policy=`: load a **community-trained move** from the HF Hub (we already host the polite bow).
  Tutorial: *"Teach Simon a new move"*: train a policy, publish it on the Hub, load it by URL, call it by voice.
  Strongest HF tie-in of the lot.
- `?lite=1`: decimated duck meshes. Tutorial: *"Running on a modest laptop"* (pairs with the Mac OS memory tab).
- `?soundboard=1`: page to trigger/compare every game sound, with a ZzFX synth. Tutorial: *"Give Simon a creature
  voice"* (see the quack idea / `research/microduck-voice-synth.md`).
- `?touch=1`: phone/tablet controls. *"Play on your phone."*
- Multiplayer "ghosts" (off in our embed mode): the planned finale, multiplayer Simon Says.
- `__gameApi`: `setVariant` (colourways, used by our colour dots), `requestLoco` (legs/rollers), `resetSim`,
  `spawnBall`, `startEntrance`, `loadCustomPolicy`/`clearCustomPolicy`. Keys: Q/E kick, R sit, G pick up,
  C camera, Space reset.
- **`?ball=0`** is ours: added to `sim/embed-and-jaw.patch` (the sim otherwise always keeps a ball in play). The
  Duck Lab uses it by default for a clean stage.
