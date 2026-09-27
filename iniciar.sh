#!/usr/bin/env bash
# Linux/macOS: start the app at http://localhost:3000
set -e
cd "$(dirname "$0")"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
[ -d node_modules ] || npm run setup
[ -f .next/BUILD_ID ] || npm run build
url="http://localhost:${PORT:-3000}"
( sleep 6; command -v xdg-open >/dev/null && xdg-open "$url" >/dev/null 2>&1 || command -v open >/dev/null && open "$url" ) &
exec npm start
