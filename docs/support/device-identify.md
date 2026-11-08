# Verify microcontroller chip

> Status: **planned** · UX contract: `device-identify` · Version: `2026.11.08`

**Where:** [/devices](/devices) · **Entry:** Devices → Identify chip

**Outcome:** /devices


## User journey

| Step | What you do | Confirmation | When it fails | Recovery |
| --- | --- | --- | --- | --- |
| 1. Select connected target | Choose an enrolled builder and connected USB device. | Fresh identity and port validated. | Device absent or moved. | Reconnect device and rescan. |
| 2. Run read-only chip probe | Approve supported chip identification. | Supported tool reports chip family and revision. | Unsupported probe or port busy. | Inspect connection and supported adapters; never guess from USB IDs. |

## Known limitations

- Read-only chip probing is not implemented.
- Chip verification is required before flash eligibility.

## Support escalation

Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.

_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._
