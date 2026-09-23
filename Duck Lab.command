#!/bin/zsh
# Double-click me in Finder to open the Duck Lab.
# (First time only: macOS may ask whether to open it. Right-click → Open.)
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
echo "🦆 Starting Duck Lab… (close this window to shut it down)"
uv run duck-lab
