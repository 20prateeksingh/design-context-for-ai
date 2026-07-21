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

# We prefer 4173 but fall back within this range, so a second product workspace never lands on
# the FIRST one's dashboard (each server reports its own workspace path at /api/status).
BASE_PORT=4173
PORT_RANGE=10

open_browser() {
  if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true # Linux
  else echo "→ Open $URL in your browser."; fi
}

# Scan [BASE_PORT, BASE_PORT+PORT_RANGE): reuse THIS workspace's own server if it's already up
# (matched by workspacePath, not just an open port), else report the first free port.
# Prints one of: "REUSE <port>" · "FREE <port>" · "NONE".  (dependency-free: node's net/http)
scan_ports() {
  node -e '
    const http = require("http"), net = require("net");
    const KIT = process.env.KIT_DIR, base = +process.env.BASE_PORT, range = +process.env.PORT_RANGE;
    const isFree = (p) => new Promise((r) => { const s = net.connect(p, "127.0.0.1");
      s.on("connect", () => { s.end(); r(false); }); s.on("error", () => r(true));
      setTimeout(() => { s.destroy(); r(true); }, 400); });
    const workspaceOf = (p) => new Promise((r) => {
      const req = http.get({ host: "127.0.0.1", port: p, path: "/api/status", timeout: 800 }, (res) => {
        let d = ""; res.on("data", (c) => (d += c));
        res.on("end", () => { try { r(JSON.parse(d).workspacePath || null); } catch { r(null); } }); });
      req.on("error", () => r(null)); req.on("timeout", () => { req.destroy(); r(null); }); });
    (async () => {
      let firstFree = null;
      for (let p = base; p < base + range; p++) {
        if (await isFree(p)) { if (firstFree === null) firstFree = p; continue; }
        const ws = await workspaceOf(p);
        if (ws && ws === KIT) { console.log("REUSE " + p); return; }   // our own server, any port
      }
      console.log(firstFree !== null ? "FREE " + firstFree : "NONE");
    })();
  '
}

if ! command -v node >/dev/null 2>&1; then
  echo "❌  Node.js isn't installed. Install it from https://nodejs.org (LTS), then run this again."
  exit 1
fi

DECISION=$(KIT_DIR="$KIT_DIR" BASE_PORT="$BASE_PORT" PORT_RANGE="$PORT_RANGE" scan_ports)
KIND=$(printf '%s' "$DECISION" | awk '{print $1}')
PORT=$(printf '%s' "$DECISION" | awk '{print $2}')

if [ "$KIND" = "REUSE" ]; then
  URL="http://localhost:$PORT"
  echo "→ This workspace's design-context server is already running. Opening the dashboard…"
  open_browser
  exit 0
elif [ "$KIND" = "FREE" ]; then
  URL="http://localhost:$PORT"
  if [ "$PORT" != "$BASE_PORT" ]; then
    echo "→ Port $BASE_PORT is in use by another workspace; using $PORT for this one instead."
  fi
else
  echo "❌  Ports $BASE_PORT–$((BASE_PORT + PORT_RANGE - 1)) are all in use. Stop one and run this again."
  exit 1
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

port_listening() {
  node -e "const s=require('net').connect($PORT,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000);" >/dev/null 2>&1
}

i=0
while [ $i -lt 40 ]; do
  if port_listening; then break; fi
  sleep 0.25
  i=$((i + 1))
done

echo "→ Opening the dashboard at $URL — follow the setup there. (Ctrl+C here stops the server.)"
open_browser

# Stay in the foreground so the server logs are visible and Ctrl+C stops it.
wait "$SERVER_PID"
