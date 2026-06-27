#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${DEVAGENT_REPO_URL:-https://github.com/amave423/DevAgent-Hub.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if [[ -f "$SCRIPT_DIR/package.json" && -d "$SCRIPT_DIR/installer" ]]; then
  DEFAULT_INSTALL_DIR="$SCRIPT_DIR"
else
  DEFAULT_INSTALL_DIR="$HOME/devagent-hub"
fi

INSTALL_DIR="${DEVAGENT_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
SKIP_SYSTEM_PACKAGES=0
SKIP_DOCKER=0
SKIP_OLLAMA=0
APT_UPDATED=0
CLI_ARGS=()

log() {
  printf "\n==> %s\n" "$*"
}

warn() {
  printf "\n[warn] %s\n" "$*" >&2
}

die() {
  printf "\n[error] %s\n" "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-path)
      INSTALL_DIR="$2"
      CLI_ARGS+=("$1" "$2")
      shift 2
      ;;
    --install-path=*)
      INSTALL_DIR="${1#*=}"
      CLI_ARGS+=("$1")
      shift
      ;;
    --repo-url)
      REPO_URL="$2"
      CLI_ARGS+=("$1" "$2")
      shift 2
      ;;
    --repo-url=*)
      REPO_URL="${1#*=}"
      CLI_ARGS+=("$1")
      shift
      ;;
    --skip-system-packages)
      SKIP_SYSTEM_PACKAGES=1
      shift
      ;;
    --skip-docker)
      SKIP_DOCKER=1
      shift
      ;;
    --skip-ollama)
      SKIP_OLLAMA=1
      CLI_ARGS+=("--no-model-pull")
      shift
      ;;
    -y|--yes)
      CLI_ARGS+=("--yes")
      shift
      ;;
    *)
      CLI_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  die "install.sh is for Linux servers. Use PowerShell on Windows."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This installer currently supports Debian/Ubuntu systems with apt-get."
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  command -v sudo >/dev/null 2>&1 || die "sudo is required for system package installation."
  SUDO=(sudo)
fi

apt_update_once() {
  if [[ "$APT_UPDATED" -eq 0 ]]; then
    log "Updating apt metadata"
    "${SUDO[@]}" apt-get update
    APT_UPDATED=1
  fi
}

apt_install() {
  apt_update_once
  "${SUDO[@]}" DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

version_check_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)"
}

install_base_packages() {
  log "Installing base packages"
  apt_install ca-certificates curl gnupg git build-essential software-properties-common
}

install_python312() {
  if command -v python3.12 >/dev/null 2>&1; then
    log "Python 3.12 is already installed"
    return
  fi

  log "Installing Python 3.12"
  if ! apt-cache policy python3.12 | grep -Eq "Candidate: [0-9]"; then
    if grep -qi "ubuntu" /etc/os-release; then
      "${SUDO[@]}" add-apt-repository -y ppa:deadsnakes/ppa
      APT_UPDATED=0
    else
      die "python3.12 package was not found. Install Python 3.12 manually and rerun with --skip-system-packages."
    fi
  fi

  apt_install python3.12 python3.12-venv python3.12-dev
}

install_node22() {
  if version_check_node; then
    log "Node.js $(node --version) is already installed"
    return
  fi

  log "Installing Node.js 22.x"
  local setup_script
  setup_script="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$setup_script"
  "${SUDO[@]}" bash "$setup_script"
  rm -f "$setup_script"
  apt_install nodejs
}

install_docker() {
  if [[ "$SKIP_DOCKER" -eq 1 ]]; then
    warn "Skipping Docker installation"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    apt_install docker.io
  else
    log "Docker is already installed"
  fi

  "${SUDO[@]}" systemctl enable --now docker || warn "Could not enable/start docker.service"

  if [[ "$(id -u)" -ne 0 ]]; then
    "${SUDO[@]}" usermod -aG docker "$USER" || warn "Could not add $USER to docker group"
    warn "If Docker permission errors appear, log out and log in again, then rerun this installer."
  fi
}

install_ollama() {
  if [[ "$SKIP_OLLAMA" -eq 1 ]]; then
    warn "Skipping Ollama installation"
    return
  fi

  if command -v ollama >/dev/null 2>&1; then
    log "Ollama is already installed"
    return
  fi

  log "Installing Ollama"
  local setup_script
  setup_script="$(mktemp)"
  curl -fsSL https://ollama.com/install.sh -o "$setup_script"
  "${SUDO[@]}" sh "$setup_script"
  rm -f "$setup_script"
}

clone_or_update_repo() {
  if [[ -f "$INSTALL_DIR/package.json" && -d "$INSTALL_DIR/installer" ]]; then
    log "Using existing repository at $INSTALL_DIR"
    return
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Updating existing git repository at $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only
    return
  fi

  log "Cloning DevAgent Hub"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
}

if [[ "$SKIP_SYSTEM_PACKAGES" -eq 0 ]]; then
  install_base_packages
  install_python312
  install_node22
  install_docker
  install_ollama
else
  warn "Skipping system package installation"
fi

clone_or_update_repo

log "Starting DevAgent Hub terminal installer"
chmod +x "$INSTALL_DIR/installer/cli.js" || true
node "$INSTALL_DIR/installer/cli.js" \
  --install-path "$INSTALL_DIR" \
  --repo-url "$REPO_URL" \
  "${CLI_ARGS[@]}"
