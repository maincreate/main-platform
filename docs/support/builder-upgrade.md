# Upgrade Host Service

> Status: **implemented** · UX contract: `builder-upgrade` · Version: `2026.11.08`

**Where:** [/builders](/builders) · **Entry:** Builders → Actions → Upgrade Host Service

**Outcome:** /builders

**Resume:** Builders → Actions → Upgrade Host Service

## User journey

| Step | What you do | Confirmation | When it fails | Recovery |
| --- | --- | --- | --- | --- |
| 1. Check installed version | Compare installed and available Host Service versions. | Version known and upgrade supported. | Version unverified or older than Host Service 0.7.0. | Migrate the existing host installation over SSH before upgrading to 0.7.0. |
| 2. Queue and stage upgrade | Choose Upgrade remotely. | Builder verifies and stages version-pinned binary. | Host unavailable or checksum mismatch. | Inspect host logs, artifact digest and controller connection; do not bypass checksum verification. |
| 3. Restart Host Service | Wait for service restart. | Host service restarts; rollback attempted on immediate failure. | Service did not restart. | Inspect systemd logs and restore backup if necessary. |
| 4. Verify heartbeat | Watch the modal. | Fresh heartbeat reports target version; modal closes. | Timeout or incorrect version. | Inspect service and controller logs; do not assume an action acknowledgment proves installation. |

## Known limitations

- Remote upgrades require a compatible installed Host Service.
- Rollback only covers immediate restart failures, not every possible runtime regression.

## Support escalation

Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.

_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._
