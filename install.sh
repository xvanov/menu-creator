#!/usr/bin/env bash
# Installs or updates "Menú del día" (La Sazón de Luis) on Linux or macOS. Safe to run again at any time.
#
#   ./install.sh [--dir PATH] [--no-ai] [--service] [--no-start]
#   curl -fsSL https://raw.githubusercontent.com/xvanov/menu-creator/main/install.sh | bash
#
# 1. Installs Node.js LTS (via nvm, no sudo) and Git (package manager) if missing.
# 2. Clones the repo, or updates it (git pull) if it is already there.
# 3. Installs Claude Code for the AI features if missing (--no-ai to skip). Missing AI is only a warning.
# 4. Runs the app setup: packages, .env.local, database, seed data, production build.
# 5. --service: runs the app as a systemd user service (Linux) that starts on boot.
set -euo pipefail

DIR="${MENU_DIR:-$HOME/menu-creator}"
REPO="${MENU_REPO:-https://github.com/xvanov/menu-creator.git}"
NO_AI=0; SERVICE=0; NO_START=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift ;;
    --no-ai) NO_AI=1 ;;
    --service) SERVICE=1 ;;
    --no-start) NO_START=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option $1"; exit 1 ;;
  esac
  shift
done
# running from inside a checkout: use it
if [ -z "${MENU_DIR:-}" ] && [ -f "$(dirname "$0")/package.json" ] && grep -q '"name": "menu-creator"' "$(dirname "$0")/package.json" 2>/dev/null; then
  DIR="$(cd "$(dirname "$0")" && pwd)"
fi

ok() { printf '\033[32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!] %s\033[0m\n' "$*"; }
step() { printf '\n\033[36m== %s\033[0m\n' "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && has sudo && SUDO="sudo"
pkg_install() {
  if has apt-get; then $SUDO apt-get update -y && $SUDO apt-get install -y "$@"
  elif has dnf; then $SUDO dnf install -y "$@"
  elif has yum; then $SUDO yum install -y "$@"
  elif has pacman; then $SUDO pacman -Sy --noconfirm "$@"
  elif has zypper; then $SUDO zypper install -y "$@"
  elif has brew; then brew install "$@"
  else echo "No supported package manager found; install $* manually and run again."; exit 1
  fi
}
node_ok() { has node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)'; }

step "Prerequisites"
has curl || pkg_install curl
has git || pkg_install git
ok "Git $(git --version | awk '{print $3}')"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if ! node_ok; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    . "$NVM_DIR/nvm.sh"
  fi
  nvm install --lts
  nvm alias default 'lts/*' >/dev/null
fi
ok "Node $(node -v)"

step "Code in $DIR"
if [ -f "$DIR/package.json" ]; then
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" pull --ff-only && ok "Updated" || warn "git pull failed (local changes or no network). Continuing with the current code."
  else ok "Using existing folder"; fi
else
  git clone "$REPO" "$DIR"; ok "Cloned"
fi
cd "$DIR"
chmod +x install.sh iniciar.sh 2>/dev/null || true

step "AI (Claude Code)"
export PATH="$HOME/.local/bin:$PATH"
if [ "$NO_AI" = 1 ]; then
  warn "Skipped (--no-ai). The app works without AI; set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env.local to use an API instead."
elif has claude; then ok "Claude Code $(claude --version)"
elif curl -fsSL https://claude.ai/install.sh | bash; then
  ok "Claude Code installed. Run 'claude' once to log in with your Claude account."
else
  warn "Could not install Claude Code. AI features will show a warning and fall back to rules."
fi

step "App setup"
npm run setup

if [ "$SERVICE" = 1 ]; then
  step "Service"
  if has systemctl && [ "$(uname)" = "Linux" ]; then
    unit="$HOME/.config/systemd/user/menu-del-dia.service"
    mkdir -p "$(dirname "$unit")"
    cat > "$unit" <<EOF
[Unit]
Description=Menu del dia - La Sazon de Luis
After=network-online.target

[Service]
WorkingDirectory=$DIR
Environment=PATH=$(dirname "$(command -v node)"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$(command -v npm) start
Restart=on-failure

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable menu-del-dia.service >/dev/null
    systemctl --user restart menu-del-dia.service
    ok "Service running (systemctl --user status menu-del-dia)"
    loginctl enable-linger "$USER" 2>/dev/null || $SUDO loginctl enable-linger "$USER" 2>/dev/null || warn "Run 'sudo loginctl enable-linger $USER' so it also runs when you're logged out."
    NO_START=1
  else
    warn "--service needs Linux with systemd; start manually with ./iniciar.sh"
  fi
fi

if [ "$NO_START" = 0 ]; then
  step "Starting"
  if curl -fs -o /dev/null "http://localhost:${PORT:-3000}"; then ok "Already running on http://localhost:${PORT:-3000}"
  else nohup ./iniciar.sh >/tmp/menu-del-dia.log 2>&1 & ok "Starting on http://localhost:${PORT:-3000} (log: /tmp/menu-del-dia.log)"; fi
fi
printf '\n\033[32mListo.\033[0m\n'
