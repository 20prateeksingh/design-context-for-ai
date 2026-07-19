#!/bin/bash
# One-time setup for the Design Context Kit capture tools.
# Installs Node dependencies and the Playwright Chromium browser.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "❌  Node.js is not installed. Install it from https://nodejs.org (LTS) and re-run this script."
  exit 1
fi

echo "→ Installing capture dependencies…"
npm install --no-fund --no-audit

echo "→ Installing the capture browser (Chromium)…"
npx playwright install chromium

echo ""
echo "✅  Setup complete."
echo "Next: node tools/login.js --url <your product URL>   (log in once, then close the window)"
