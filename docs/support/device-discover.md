# Discover attached devices

> Status: **pilot** · UX contract: `device-discover` · Version: `2026.11.08`

**Where:** [/devices](/devices) · **Entry:** Devices → Refresh inventory

**Outcome:** /devices

**Resume:** Devices → Refresh inventory

## User journey

| Step | What you do | Confirmation | When it fails | Recovery |
| --- | --- | --- | --- | --- |
| 1. Attach board to builder | Connect a USB data cable to an enrolled Linux builder. | Linux presents a USB serial interface. | Charge-only cable or unsupported USB mode. | Check lsusb and /dev/serial/by-id on the physical builder. |
| 2. Collect USB descriptors | Upgrade Host Service to v0.6.0 or later and refresh inventory. | Controller receives bounded read-only descriptor report. | Sysfs inaccessible or host lacks discovery. | Check journalctl for discovery errors, verify Host Service version and builder heartbeat. |
| 3. Review candidate MCU and SDK | Select SDK options in the device row. | Catalog shows candidate families, SDK and evidence status. | USB ID unknown or only an adapter is identified. | Treat as unknown; proceed to controlled read-only chip identification when available. |

## Known limitations

- USB VID/PID cannot establish exact MCU or board identity.
- Current Go scanner covers Linux USB serial interfaces only.
- Discovery never authorizes firmware flashing.

## Support escalation

Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.

_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._
