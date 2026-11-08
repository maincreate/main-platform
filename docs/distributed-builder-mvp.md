# Distributed Linux ARM64 builder MVP (0.4)

The Host Service prepares a fresh Raspberry Pi to be discovered and paired; it does **not** register a GitHub runner by itself. The **controller** owns organization access, runner registration-token issuance, labels and provisioning decisions. The host executes only the fixed runner-provisioning adapter.

## Fresh Raspberry Pi acceptance test

1. Flash **Raspberry Pi OS Lite 64-bit** using Raspberry Pi Imager. Choose a hostname, Linux user and password, and enable SSH password login.
2. SSH into the freshly imaged Pi. Run **one command** (replace the URL with your own HTTPS Main{Create} controller):

   `curl -fsSL https://controller.example.com/install.sh | sudo env MAIN_CONTROLLER_URL=https://controller.example.com bash`

3. The installer obtains a separately built Linux ARM64 Host Service executable from the controller, verifies its SHA-256 checksum, installs Avahi and OpenSSH if needed, enables `tinkertunnel-host.service`, and advertises `_tinkertunnel._tcp.local` on mDNS, pointing to SSH port 22. **No GitHub runner is registered during installation.** The installer must be run with sudo from the Linux user configured in Imager so it can authorize that specific user for the fixed one-time `join` command.
4. In the portal, open **Builders → Add a Build Machine**. Discover the Pi by mDNS, or enter the hostname/IP manually. Select **Read SSH fingerprint**. Verify the fingerprint against the Pi's actual SSH host key before confirming: on the Pi, `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.
5. Supply the **Pi's local Linux username and password**, not the Main{Create} portal credentials. Controller uses the credentials for a single SSH pairing, pins the host key for the connection, and sends a one-time Main{Create} enrollment invitation via stdin to the privileged `join` command. The password is not saved. The host stores a unique revocable Main{Create} credential in `/var/lib/tinkertunnel/host.json`, mode 0600.
6. Within the next heartbeat the machine appears as **online** with its verified platform and reported tool inventory. Only then select **Provision GitHub runner** in the Builders listing.
7. The controller uses its existing selected GitHub organization, obtains a short-lived **GitHub Actions registration token**, derives labels from platform and actual installed tools, encrypts the pending token at rest, and makes a single fixed provisioning action available to that enrolled host. The host downloads a checksum-verified official Linux ARM64 GitHub Actions runner release, configures it under the dedicated `tt-runner` account, and enables its systemd service. No permanent GitHub credential is sent to the Pi.
8. Verify that the runner appears in the organization's GitHub Actions runner list, then reboot the Pi and confirm the Host Service and runner come online again.

## Build and test

```sh
cd host && go test ./...
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o tinkertunnel-host-linux-arm64 .
cd .. && npm test
```

The root Dockerfile cross-builds the binary inside the portal image; the public `/downloads/tinkertunnel-host-linux-arm64` endpoint serves those bytes, and `/downloads/tinkertunnel-host-linux-arm64.sha256` serves their digest. A freshly imaged Pi doesn't need Go, Node or GitHub credentials.

## Network and authorization boundaries

- mDNS discovery uses `_tinkertunnel._tcp.local`. It only works when multicast reaches the controller container; this often **fails across VLANs and Docker bridges**. Manual hostname/IP pairing remains fully supported, and is the reliable fallback.
- An mDNS advertisement is **not proof of host identity**. The controller exposes the SSH Ed25519 fingerprint before pairing. Users should compare it with their Pi's local SSH host key. First-use fingerprint discovery is otherwise trust-on-first-use, not PKI.
- Raspberry Pi Imager must enable SSH; the controller needs TCP/22 access to the host for initial pairing. Ongoing connections are **outbound** from the host to the controller over HTTPS.
- The GitHub App used by Main{Create} must have **organization Self-hosted runners: write** permission, approved by an organization administrator. GitHub user/installation permissions can otherwise return HTTP 403; the UI reports this explicitly.
- Only one provisioning action may be pending per host. A claimed action is not silently retried after a crash, because the registration may have succeeded on GitHub. Failed/ambiguous actions require inspection.
- No automatic SDK installation, firmware flashing, host-agent remote shell or macOS/Windows native installer is included in this Linux ARM64 milestone. The existing JavaScript host agent remains available for development/other platforms.
- The initial systemd service runs as root to perform one bounded verified runner installation, while the GitHub Actions runner itself runs as the dedicated `tt-runner` user. Privilege separation and host-service automatic updates are future hardening work.
- The installer is fetched over HTTPS. The SHA-256 manifest guards download integrity but is served by the same controller, so it is **not independent signature verification**.
- The first physical Pi enrollment and GitHub registration are required acceptance tests before this branch should be considered production-validated.

## Service troubleshooting

```sh
systemctl status tinkertunnel-host.service
journalctl -u tinkertunnel-host.service -n 100 --no-pager
avahi-browse -rt _tinkertunnel._tcp
sudo cat /var/lib/tinkertunnel/host.json  # contains a secret; DO NOT paste or share it
```

Never expose host tokens or registration tokens in logs, support requests, or tickets.
