#!/bin/sh
# start.sh — the one action a designer takes. It sets everything up (installing on first run),
# starts the local server, and opens the dashboard. From there the dashboard runs onboarding —
# it asks the questions, triggers login if relevant, and shows the capture live.
#
# No questions are asked in the terminal, ever. Slow first-run steps narrate before they run.
#
# Usage:  tools/start.sh        (from the workspace root — the folder that holds tools/)
set -eu

# Resolve the workspace root (parent of this script's tools/ dir) regardless of where it's called from.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
KIT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$KIT_DIR"
PORT=4173
URL="http://localhost:$PORT"

open_browser() {
  if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true # Linux
  else echo "→ Open $URL in your browser."; fi
}

# Is something already listening on the port? (dependency-free: use node's net module.)
port_open() {
  node -e "const s=require('net').connect($PORT,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000);" >/dev/null 2>&1
}

if ! command -v node >/dev/null 2>&1; then
  echo "❌  Node.js isn't installed. Install it from https://nodejs.org (LTS), then run this again."
  exit 1
fi

# Server already up (from a previous start) → just open the dashboard.
if port_open; then
  echo "→ The design-context server is already running. Opening the dashboard…"
  open_browser
  exit 0
fi

# First-run installs can take minutes — say so BEFORE each slow step.
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "→ First run: installing the capture tools (about a minute)…"
  npm install --prefix "$SCRIPT_DIR" --no-fund --no-audit
fi

CHROME=$(cd "$SCRIPT_DIR" && node -e "try{console.log(require('playwright').chromium.executablePath())}catch(e){process.exit(1)}" 2>/dev/null || true)
if [ -z "${CHROME:-}" ] || [ ! -f "$CHROME" ]; then
  echo "→ First run: downloading the capture browser (Chromium — this can take a few minutes)…"
  (cd "$SCRIPT_DIR" && npx playwright install chromium)
fi

echo "→ Starting the design-context server…"
# Start the server in the background, wait until it's listening, then open the dashboard.
node "$SCRIPT_DIR/map.js" --port "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' INT TERM

i=0
while [ $i -lt 40 ]; do
  if port_open; then break; fi
  sleep 0.25
  i=$((i + 1))
done

echo "→ Opening the dashboard at $URL — follow the setup there. (Ctrl+C here stops the server.)"
open_browser

# Stay in the foreground so the server logs are visible and Ctrl+C stops it.
wait "$SERVER_PID"
