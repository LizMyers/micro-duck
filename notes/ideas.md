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
