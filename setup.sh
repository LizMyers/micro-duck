#!/bin/bash
# One-time setup for Duck Lab. Installs the two companions next to this repo:
#   ../speech-to-speech       Hugging Face's voice agent
#   ../microduck-simulator    Pollen Robotics' simulator, patched and built
# Safe to run again: finished steps are skipped.
#
# Overrides:
#   S2S_REPO, S2S_BRANCH   where to clone speech-to-speech from. Default: Liz's fork, on the branch with
#                          the tool-call fixes in huggingface/speech-to-speech#721. Once that PR is merged,
#                          use upstream: S2S_REPO=https://github.com/huggingface/speech-to-speech.git S2S_BRANCH=main
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PARENT="$(dirname "$HERE")"
S2S="$PARENT/speech-to-speech"
SIM="$PARENT/microduck-simulator"
S2S_REPO="${S2S_REPO:-https://github.com/LizMyers/speech-to-speech.git}"
S2S_BRANCH="${S2S_BRANCH:-pr/tool-call-fixes}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

step "Checking requirements"
[ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] \
  || fail "Duck Lab needs an Apple Silicon Mac (the voice agent runs on MLX)."
for tool in git uv node npm; do
  command -v "$tool" >/dev/null 2>&1 || case "$tool" in
    uv)       fail "uv not found. Install it: https://docs.astral.sh/uv/" ;;
    node|npm) fail "$tool not found. Install Node.js (https://nodejs.org), needed once to build the simulator." ;;
    *)        fail "$tool not found." ;;
  esac
done
[ -d "/Applications/Google Chrome.app" ] || echo "Note: Google Chrome not found in /Applications. The lab runs in Chrome."
echo "OK"

step "Speech-to-speech (voice agent) in $S2S"
if [ -x "$S2S/.venv/bin/speech-to-speech" ]; then
  echo "Already installed, skipping."
else
  if [ ! -d "$S2S/.git" ]; then
    git clone ${S2S_BRANCH:+--branch "$S2S_BRANCH"} "$S2S_REPO" "$S2S"
  fi
  (cd "$S2S" && uv sync)
fi

step "Microduck simulator in $SIM"
if [ -f "$SIM/app/dist/index.html" ]; then
  echo "Already built, skipping."
else
  if [ ! -d "$SIM/.git" ]; then
    uvx --from huggingface_hub hf download pollen-robotics/microduck-simulator \
      --repo-type space --local-dir "$SIM"
    (cd "$SIM" && git init -q && mv .gitattributes .gitattributes.space \
      && git add -A && git -c user.name=setup -c user.email=setup@localhost commit -qm upstream)
  fi
  PATCH="$HERE/sim/embed-and-jaw.patch"
  if (cd "$SIM" && git apply --reverse --check "$PATCH" 2>/dev/null); then
    echo "Patch already applied."
  else
    (cd "$SIM" && git apply "$PATCH")
  fi
  (cd "$SIM/app" && npm ci && VITE_BASE=/sim/ npm run build)
fi

step "Done"
echo "Start the lab with:  uv run duck-lab   (or double-click Duck Lab.command)"
echo "The first start downloads the voice models, which takes a few minutes."
