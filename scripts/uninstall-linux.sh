#!/usr/bin/env bash
# TinkerTunnel Linux Host Service removal; intentionally no remote deregistration.
set -Eeuo pipefail
HOST_UNIT=/etc/systemd/system/tinkertunnel-host.service
HOST_BIN=/usr/local/bin/tinkertunnel-host
PAIR_RULE=/etc/sudoers.d/90-tinkertunnel-pair
HOST_STATE=/var/lib/tinkertunnel
RUNNER_DIR=/opt/tinkertunnel/actions-runner
APPLY=false; PURGE_STATE=false; PURGE_FILES=false; GITHUB_REMOVED_HOST=""
for arg in "$@"; do
  case "$arg" in
    --yes) APPLY=true ;;
    --dry-run) APPLY=false ;;
    --purge-state) PURGE_STATE=true ;;
    --purge-unregistered-runner) PURGE_FILES=true ;;
    --github-removed=*) GITHUB_REMOVED_HOST="${arg#--github-removed=}" ;;
    -h|--help)
      cat <<'HELP'
Usage: sudo bash uninstall-linux.sh [--dry-run | --yes] [--purge-state] [--purge-unregistered-runner] [--github-removed=HOSTNAME]
Default is a dry-run. --yes applies changes. Optional flags separately
remove local host enrollment data or UNREGISTERED runner leftovers.
Before running, drain and deregister any GitHub Actions runner and revoke
the Host Service enrollment from TinkerTunnel's controller.
Never removes GitHub registration, SSH, Avahi, or the tt-runner OS user.
After GitHub confirms runner deletion, --github-removed=HOSTNAME permits
cleanup of a locally configured runner with the same machine hostname.
It requires --purge-state and --purge-unregistered-runner.
HELP
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != dumb ]]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  GREEN=""; RED=""; YELLOW=""; RESET=""
fi
status() {
  local color="$YELLOW" mark="[WAIT]"
  case "$1" in
    OK) color="$GREEN"; mark="[ OK ]";;
    FAIL) color="$RED"; mark="[FAIL]";;
    INFO) color="$YELLOW"; mark="[INFO]";;
  esac
  printf '%b%s%b %s\n' "$color" "$mark" "$RESET" "$2"
}
printf '\nTinkerTunnel Host Service uninstaller — %s\n' "$(hostname)"
if [[ "$(uname -s)" != Linux ]] || ! command -v systemctl >/dev/null; then
  status FAIL "Requires Linux with systemd."; exit 1
fi
if "$APPLY" && [[ "$EUID" -ne 0 ]]; then
  status FAIL "Run with sudo to apply changes."; exit 1
fi
# Never sever a still-registered GitHub runner or interrupt its service.
REGISTERED_LOCAL=false
if [[ -e "$RUNNER_DIR/.runner" || -L "$RUNNER_DIR/.runner" ||
      -e "$RUNNER_DIR/.service" || -L "$RUNNER_DIR/.service" ]]; then
  REGISTERED_LOCAL=true
  if [[ "$GITHUB_REMOVED_HOST" != "$(hostname)" || "$PURGE_STATE" != true || "$PURGE_FILES" != true ]]; then
    status FAIL "A GitHub runner is configured locally. First remove it from GitHub via TinkerTunnel."
    status INFO "Then repeat with --github-removed=$(hostname) --purge-state --purge-unregistered-runner."
    status INFO "No local changes made."; exit 3
  fi
  if [[ -L "$RUNNER_DIR" || -L "$RUNNER_DIR/.service" || -L "$RUNNER_DIR/.runner" ]]; then
    status FAIL "Unexpected symlink in runner installation; refusing removal."; exit 4
  fi
  status INFO "Operator confirms GitHub runner was removed remotely for host $(hostname)."
fi
status INFO "Will stop/disable TinkerTunnel Host Service and remove its binary, unit, and pairing sudo rule."
if "$PURGE_STATE"; then
  status INFO "Will also remove local host enrollment data (remote revocation remains separate)."
else
  status INFO "Preserving host enrollment data, including any bearer token."
fi
if "$PURGE_FILES"; then
  status INFO "Will also remove unregistered runner files and incomplete retry backups."
else
  status INFO "Preserving unregistered runner files."
fi
status INFO "Will leave SSH, Avahi, tt-runner OS account, and unrelated software untouched."
if ! "$APPLY"; then
  status INFO "DRY RUN: no changes made. Re-run with --yes to apply."; exit 0
fi
if [[ -f "$HOST_UNIT" ]]; then
  systemctl disable --now tinkertunnel-host.service
  rm -f -- "$HOST_UNIT"
  systemctl daemon-reload
  status OK "Host Service stopped, disabled, and unit removed."
else
  status INFO "Host Service unit already absent."
fi
rm -f -- "$HOST_BIN" "$PAIR_RULE"
status OK "Host executable and pairing sudo rule removed."
if "$PURGE_FILES"; then
  if "$REGISTERED_LOCAL"; then
    if [[ -e "$RUNNER_DIR/.service" && -x "$RUNNER_DIR/svc.sh" ]]; then
      (cd "$RUNNER_DIR" && ./svc.sh stop) || true
      (cd "$RUNNER_DIR" && ./svc.sh uninstall)
      status OK "Previously registered runner service uninstalled."
    elif [[ -e "$RUNNER_DIR/.service" ]]; then
      status FAIL "Runner service exists but svc.sh is unavailable; refusing runner file removal."; exit 4
    fi
  fi
  if [[ -L "$RUNNER_DIR" ]]; then
    status FAIL "Runner directory is a symlink; refusing purge."; exit 4
  fi
  shopt -s nullglob
  for dir in "$RUNNER_DIR".incomplete-*; do
    if [[ -L "$dir" || ! -d "$dir" ]]; then
      status FAIL "Unexpected retry-backup path; refusing purge: $dir"; exit 4
    fi
  done
  rm -rf -- "$RUNNER_DIR"
  for dir in "$RUNNER_DIR".incomplete-*; do rm -rf -- "$dir"; done
  status OK "Unregistered runner files removed."
fi
if "$PURGE_STATE"; then
  if [[ -L "$HOST_STATE" ]]; then
    status FAIL "Host state is a symlink; refusing purge."; exit 4
  fi
  rm -rf -- "$HOST_STATE"
  status OK "Local enrollment data removed."
fi
printf '\n'
status OK "Local Host Service removal completed."
status INFO "Revoke the host identity in TinkerTunnel; GitHub was not changed remotely."
