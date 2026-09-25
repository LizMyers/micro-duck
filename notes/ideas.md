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

## More games for Simon (2026-09-25)
Built from what Simon already has: hearing/speech, body moves and head looks, and the webcam referee
(head, arms, body turns).
- **"Simon" the memory game** (the classic electronic *Simon* is a memory game): Simon shows a sequence with his
  head (up… left… right…), you repeat it, +1 move per round. Reuses Copy me + the head checks. **Top pick.**
- **Arm-vote quiz show:** "Left arm for Paris, right arm for Rome!" Camera reads the answer; scoreboard counts.
  A nod to Liz's Quiz-Genie.
- **Duck Says (reverse Simon Says):** Liz gives commands; Simon obeys only after "Duck says…". Funny, and a real
  test of a small model following a rule (field-notes post).
- **Red Light, Green Light (statues):** Simon turns his back ("green light"), spins round ("red light!"), you
  freeze. Needs a new "are you moving?" check. Great on video. **Second pick.**
- **Penalty shootout:** Simon kicks the ball (bring it back: drop `ball=0`), you dive by raising left/right arm.
- **Twenty questions with nods:** Simon answers yes/no by nodding or shaking his head, no words (quack-friendly).
- **Rock, paper, scissors "to decide stuff"** (Liz): who calls the first round, who picks the next game.
  - *Your side:* needs the hand tracker (planned).
  - *Option A (first): card in the beak.* At "shoot!", Simon does his pick-up dip and comes up holding ✊/✋/✌️:
    a card prop attached to his head in our sim patch (the sim animates the pick-up but doesn't simulate grasping).
    Fairness: the page commits Simon's choice before reading your hand, shown as a face-down card that flips at
    "shoot!". ~1 session.
  - *Option B (later): walk to a card.* Three cards on the floor, Simon walks to his choice and taps it. Slower,
    cards need spacing (walking accuracy ~cm). Shares the "walk to a spot" skill with the level-2 "walk to his
    spot and face you" idea.
  - *Real robot:* Pollen's beak really picks things up, so light cards in a stand could make Option B real: a
    "sim to real" tutorial ending.
- **Tutorial angle:** "From one game to a game console: adding a second game to your voice agent."
