#!/usr/bin/env bash
# TinkerTunnel distributed Host Service for Linux ARM64. Pair from the controller UI afterward.
set -euo pipefail
ORIGIN="${TT_CONTROLLER_URL:-https://tinkertunnel.home.ayusohaylock.com}"
ORIGIN="${ORIGIN%/}"
if [[ ! "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo 'ERROR: TT_CONTROLLER_URL must be a trusted HTTPS origin.' >&2; exit 1
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then
  echo 'ERROR: this release supports only Linux ARM64 (Raspberry Pi OS 64-bit).' >&2; exit 1
fi
if [[ $(id -u) != 0 ]]; then
  echo 'ERROR: use curl -fsSL <controller>/install.sh | sudo bash' >&2; exit 1
fi
if ! command -v apt-get >/dev/null; then echo 'ERROR: Debian or Raspberry Pi OS with apt is required.' >&2; exit 1; fi
command -v curl >/dev/null || { apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates; }
command -v sha256sum >/dev/null || { echo 'ERROR: sha256sum missing.' >&2; exit 1; }
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT
BIN=tinkertunnel-host-linux-arm64
curl --fail --show-error --silent --location --max-time 90 "$ORIGIN/downloads/$BIN" -o "$TEMP/$BIN"
curl --fail --show-error --silent --location --max-time 30 "$ORIGIN/downloads/$BIN.sha256" -o "$TEMP/$BIN.sha256"
(cd "$TEMP" && sha256sum --check "$BIN.sha256") || { echo 'ERROR: checksum mismatch.' >&2; exit 1; }
DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y avahi-daemon avahi-utils openssh-server
systemctl enable --now avahi-daemon ssh
install -m 0755 "$TEMP/$BIN" /usr/local/bin/tinkertunnel-host
id -u tt-runner >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/tt-runner --shell /usr/sbin/nologin tt-runner
install -d -m 0700 -o root -g root /var/lib/tinkertunnel
PAIR_USER="${SUDO_USER:-}"
if [[ -n "$PAIR_USER" && "$PAIR_USER" != root && "$PAIR_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  printf '%s ALL=(root) NOPASSWD: /usr/local/bin/tinkertunnel-host join\n' "$PAIR_USER" >/etc/sudoers.d/90-tinkertunnel-pair
  chmod 0440 /etc/sudoers.d/90-tinkertunnel-pair
  visudo -cf /etc/sudoers.d/90-tinkertunnel-pair >/dev/null
fi
cat >/etc/systemd/system/tinkertunnel-host.service <<'UNIT'
[Unit]
Description=TinkerTunnel Host Service (discovery and controller-managed operations)
After=network-online.target avahi-daemon.service
Wants=network-online.target avahi-daemon.service
[Service]
Type=simple
ExecStart=/usr/local/bin/tinkertunnel-host serve
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
systemctl enable --now tinkertunnel-host.service
printf '\nTinkerTunnel Host Service installed and advertising this host.\n'
printf 'Hostname: %s\n' "$(hostname)"
printf 'Next: TinkerTunnel > Builders > Add Builder; discover or enter hostname/IP and authenticate with the Pi login.\n'
