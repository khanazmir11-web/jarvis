#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
unset ANTHROPIC_API_KEY
command -v claude >/dev/null || { echo "Install Claude Code first: https://claude.com/claude-code"; exit 1; }
if [ -n "${JARVIS_WA_TOKEN:-}" ]; then
  python3 whatsapp.py &
  WA=$!; trap 'kill $WA 2>/dev/null' EXIT
fi
[ -f web/icon-512.png ] || python3 make_icons.py
python3 server.py
