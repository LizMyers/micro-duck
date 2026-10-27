# The simulated duck

Duck Lab embeds Pollen Robotics' Microduck browser simulator
([Space: pollen-robotics/microduck-simulator](https://huggingface.co/spaces/pollen-robotics/microduck-simulator)),
with a tiny patch: `?embed=1` (just the 3D duck, no HUD/title menu) and `window.rl.setJaw(0..1)` (beak control).

> The Space is **Apache 2.0** (it had no licence until Oct 2026): a hosted copy must include the licence, note our changes and credit Pollen. We asked them about credit and using the "Microduck" name (27 Oct).

## Build it (one time)
```bash
cd ~/Documents/Development
# Download the Space (handles its large files; no git-lfs needed)
speech-to-speech/.venv/bin/python -c "from huggingface_hub import snapshot_download; \
  snapshot_download('pollen-robotics/microduck-simulator', repo_type='space', local_dir='microduck-simulator')"
cd microduck-simulator
git init -q && mv .gitattributes .gitattributes.space && git add -A && git commit -qm upstream
git apply ~/Documents/Development/micro-duck/sim/embed-and-jaw.patch
cd app && npm ci && VITE_BASE=/sim/ npm run build
```
The lab server serves `app/dist` at `/sim/`.
