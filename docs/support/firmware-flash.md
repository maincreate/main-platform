# Flash verified firmware

> Status: **planned** · UX contract: `firmware-flash` · Version: `2026.11.08`

**Where:** [/jobs](/jobs) · **Entry:** Jobs → Flash device

**Outcome:** /jobs


## User journey

| Step | What you do | Confirmation | When it fails | Recovery |
| --- | --- | --- | --- | --- |
| 1. Select verified artifact | Choose immutable build output. | Checksum, source commit, SDK and board target verified. | Missing or mismatched metadata. | Build a compatible firmware artifact first. |
| 2. Verify connected device | Confirm exact chip and physical port. | Fresh chip identity and port lock confirmed. | Chip mismatch, device moved or port busy. | Reidentify device. Do not override safety gates. |
| 3. Authorize flash | Approve explicit target and artifact. | Audited operation approved. | Approval missing or expired. | Review selection and request approval again. |
| 4. Flash and verify | Watch controlled flash adapter. | Adapter verifies written firmware and records deployment. | Flash error or disconnect. | Use adapter-specific recovery and bootloader instructions; never assume device is safe to retry blindly. |

## Known limitations

- Flashing is not enabled.
- No automatic flashing on commit.

## Support escalation

Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.

_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._
