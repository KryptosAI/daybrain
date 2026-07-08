#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}→${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*"; }
info() { echo -e "${CYAN}ℹ${NC}  $*"; }

echo ""
echo -e "${BOLD}🧠  DayBrain Installer${NC}"
echo -e "${CYAN}   Private local memory for your AI${NC}"
echo ""

# --- OS detection ---
OS="$(uname -s)"
case "$OS" in
  Darwin)  OS="macos" ;;
  Linux)   OS="linux" ;;
  *)       err "Unsupported OS: $OS. DayBrain currently supports macOS and Linux."; exit 1 ;;
esac

# --- Node.js check ---
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    log "Node.js $(node -v) found"
  else
    warn "Node.js $(node -v) is too old (need >=18)"
    NEED_NODE=1
  fi
else
  NEED_NODE=1
fi

if [ -n "${NEED_NODE:-}" ]; then
  log "Installing Node.js..."
  if command -v brew &>/dev/null; then
    brew install node
  elif command -v curl &>/dev/null; then
    curl -fsSL https://nodejs.org/dist/v20.0.0/node-v20.0.0-$([ "$OS" = "macos" ] && echo "darwin" || echo "linux")-x64.tar.gz | tar -xz -C /usr/local --strip-components=1
  else
    err "Please install Node.js >=18 from https://nodejs.org and re-run this script."
    exit 1
  fi
fi

# --- Python check for native watcher ---
if [ "$OS" = "macos" ]; then
  PYTHON=""
  for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
      PYTHON="$cmd"
      break
    fi
  done

  if [ -z "$PYTHON" ]; then
    warn "Python 3 not found — native window tracking requires it."
    if command -v brew &>/dev/null; then
      log "Installing Python via Homebrew..."
      brew install python3
      PYTHON="python3"
    else
      info "Install Python 3 from https://python.org for zero-permission window tracking."
      info "Or install ActivityWatch from https://activitywatch.net for richer data."
    fi
  fi

  if [ -n "$PYTHON" ]; then
    log "Python found ($PYTHON)"
    if ! $PYTHON -c "import Quartz" 2>/dev/null; then
      log "Installing PyObjC framework (zero-permission window tracking)..."
      $PYTHON -m pip install pyobjc-framework-Quartz --quiet 2>/dev/null || \
        warn "PyObjC install failed. Run manually: pip3 install pyobjc-framework-Quartz"
    else
      log "PyObjC framework found — native watcher ready"
    fi
  fi
else
  info "Linux detected — install ActivityWatch for window tracking: https://activitywatch.net"
fi

# --- Install DayBrain ---
log "Installing DayBrain..."
npm install -g daybrain 2>/dev/null || {
  warn "npm install -g failed. You can install from source:"
  info "  git clone https://github.com/daybrainhq/daybrain && cd daybrain && npm install && npm run build && npm link"
}

# --- Done ---
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  DayBrain installed!${NC}"
echo ""
echo -e "  Start the server:"
echo -e "    ${CYAN}daybrain${NC}"
echo ""
echo -e "  Add to Claude:"
echo -e "    ${CYAN}claude mcp add daybrain -- npx -y daybrain${NC}"
echo ""
echo -e "  Then ask Claude:"
echo -e "    ${CYAN}\"What did I do today and what am I avoiding?\"${NC}"
echo ""
echo -e "  Config: ${CYAN}~/.daybrain/config.json${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
