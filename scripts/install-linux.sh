#!/usr/bin/env bash
# Main{Create} distributed Host Service for Linux ARM64. Pair from the controller UI afterward.
set -Eeuo pipefail
ORIGIN="${MAIN_CONTROLLER_URL:-}"
ORIGIN="${ORIGIN%/}"
# The one-time installer sets up the Host Service. Pairing and GitHub Actions
# provisioning happen later, so those states must never be reported as success.
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'
  BLUE=$'\033[36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=""; RED=""; YELLOW=""; BLUE=""; BOLD=""; RESET=""
fi
status() {
  local kind="$1" label="$2" color="$BLUE" marker="[ .. ]"
  case "$kind" in
    PASS) color="$GREEN"; marker="[ OK ]" ;;
    FAIL) color="$RED"; marker="[FAIL]" ;;
    PENDING) color="$YELLOW"; marker="[WAIT]" ;;
    SKIPPED) color="$YELLOW"; marker="[SKIP]" ;;
  esac
  printf '%b%s%b %s\n' "$color" "$marker" "$RESET" "$label"
}
stages=("Preflight" "OS dependencies" "Host download and checksum" "Host executable and user" "Pairing permissions" "Host Service"
        "Host pairing" "GitHub runner installation" "GitHub registration" "GitHub runner online")
declare -A stage_result=()
CURRENT_STAGE="Preflight"
TEMP=""
on_exit() {
  local exit_code="$1" component state
  trap - EXIT
  if (( exit_code != 0 )); then
    stage_result["$CURRENT_STAGE"]="FAIL"
    printf '\n'
    status FAIL "Installer stopped at: $CURRENT_STAGE (exit $exit_code). See the command output above."
  fi
  printf '\n%b────────────────── Main{Create} setup summary ──────────────────%b\n' "$BOLD" "$RESET"
  printf '  Machine: %s\n' "$(hostname)"
  for component in "${stages[@]}"; do
    state="${stage_result[$component]:-PENDING}"
    status "$state" "$component"
  done
  if (( exit_code == 0 )); then
    if [[ "${UPGRADING:-false}" == true ]]; then
      printf '\\n%bHOST SERVICE UPGRADED • ENROLLMENT PRESERVED%b\\n' "$GREEN$BOLD" "$RESET"
      printf 'Return to Builders and verify the reported software version.\\n'
    else
      printf '\\n%bHOST SERVICE INSTALLED • BUILDER NOT YET READY%b\\n' "$YELLOW$BOLD" "$RESET"
      printf 'Next: Main{Create} > Builders > Add a Build Machine.\\n'
      printf 'Pair the host, then verify the GitHub Actions runner reports Online.\\n'
    fi
  else
    printf '\n%bSETUP INCOMPLETE — DO NOT CONSIDER THIS BUILDER READY%b\n' "$RED$BOLD" "$RESET"
    printf 'Fix the failed step above before proceeding to pairing.\n'
  fi
  [[ -z "$TEMP" ]] || rm -rf -- "$TEMP" || true
}
trap 'on_exit "$?"' EXIT
run_stage() {
  CURRENT_STAGE="$1"
  shift
  status RUNNING "$CURRENT_STAGE"
  "$@"
  stage_result["$CURRENT_STAGE"]="PASS"
  status PASS "$CURRENT_STAGE"
}
fail() { printf 'ERROR: %s\n' "$*" >&2; return 1; }
preflight() {
  [[ "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || { fail "MAIN_CONTROLLER_URL must be a trusted HTTPS origin."; return 1; }
  [[ "$(uname -s)" == Linux && "$(uname -m)" == aarch64 ]] || { fail "This release requires Linux ARM64 (Raspberry Pi OS 64-bit)."; return 1; }
  [[ "$(id -u)" == 0 ]] || { fail "Run the installer with sudo."; return 1; }
  command -v apt-get >/dev/null || { fail "Debian or Raspberry Pi OS with apt is required."; return 1; }
  command -v sha256sum >/dev/null || { fail "sha256sum is missing."; return 1; }
  command -v systemctl >/dev/null || { fail "systemd is required."; return 1; }
}
install_dependencies() {
  if ! command -v curl >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates
  fi
  DEBIAN_FRONTEND=noninteractive apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y avahi-daemon avahi-utils openssh-server nfs-common util-linux
  systemctl enable --now avahi-daemon ssh
  systemctl is-active --quiet avahi-daemon
  systemctl is-active --quiet ssh
}
download_host() {
  TEMP="$(mktemp -d)"
  local bin="maincreate-host-linux-arm64"
  curl --fail --show-error --silent --location --max-time 90 "$ORIGIN/downloads/$bin" -o "$TEMP/$bin"
  curl --fail --show-error --silent --location --max-time 30 "$ORIGIN/downloads/$bin.sha256" -o "$TEMP/$bin.sha256"
  (cd "$TEMP" && sha256sum --check "$bin.sha256")
}
install_host() {
  # Install through a same-directory rename: overwriting a running executable in-place can fail with ETXTBSY.
  install -m 0755 "$TEMP/maincreate-host-linux-arm64" /usr/local/bin/maincreate-host.new
  mv -f /usr/local/bin/maincreate-host.new /usr/local/bin/maincreate-host
  id -u maincreate-runner >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/maincreate-runner --shell /usr/sbin/nologin maincreate-runner
  install -d -m 0700 -o root -g root /var/lib/maincreate
}
configure_pairing() {
  local user="$1"
  printf '%s ALL=(root) NOPASSWD: /usr/local/bin/maincreate-host join\n' "$user" >/etc/sudoers.d/90-maincreate-pair
  chmod 0440 /etc/sudoers.d/90-maincreate-pair
  visudo -cf /etc/sudoers.d/90-maincreate-pair >/dev/null
}
install_service() {
  cat >/etc/systemd/system/maincreate-host.service <<'UNIT'
[Unit]
Description=Main{Create} Host Service (discovery and controller-managed operations)
After=network-online.target avahi-daemon.service
Wants=network-online.target avahi-daemon.service
[Service]
Type=simple
ExecStart=/usr/local/bin/maincreate-host serve
User=root
Group=root
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now maincreate-host.service
  systemctl restart maincreate-host.service
  systemctl is-active --quiet maincreate-host.service
}

UPGRADING=false
if [[ -s /var/lib/maincreate/host.json ]]; then UPGRADING=true; fi
printf '\\n%bMAIN{CREATE}  /  LINUX ARM64 HOST SETUP%b\\n' "$BOLD" "$RESET"
printf 'Controller: %s\n' "$ORIGIN"
printf 'The GitHub Actions runner will be installed only after host pairing.\n\n'
run_stage "Preflight" preflight
run_stage "OS dependencies" install_dependencies
run_stage "Host download and checksum" download_host
run_stage "Host executable and user" install_host
PAIR_USER="$(printenv SUDO_USER || true)"
if [[ -n "$PAIR_USER" && "$PAIR_USER" != root && "$PAIR_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  run_stage "Pairing permissions" configure_pairing "$PAIR_USER"
else
  stage_result["Pairing permissions"]="SKIPPED"
  status SKIPPED "Pairing permissions (no eligible sudo user; configure access before pairing)"
fi
run_stage "Host Service" install_service
