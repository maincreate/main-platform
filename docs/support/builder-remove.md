# Remove a build machine

> Status: **implemented** · UX contract: `builder-remove` · Version: `2026.11.08`

**Where:** [/builders](/builders) · **Entry:** Builders → Actions → Remove runner

**Outcome:** /builders

**Resume:** Builders → Actions → View removal progress

## User journey

| Step | What you do | Confirmation | When it fails | Recovery |
| --- | --- | --- | --- | --- |
| 1. Confirm machine identity | Copy the read-only hostname and type the exact value. | Exact match enables Continue. | Hostname mismatch. | Use the copy icon in the read-only field; do not substitute a display label. |
| 2. Confirm as administrator | Enter administrator password. | Controller accepts the destructive request. | Password rejected or removal preconditions unmet. | Confirm credentials and check running jobs; never bypass controller authorization. |
| 3. Stop runner | Watch removal status. | Host reports stop completed; unavailable host may require skipped stage. | Runner cannot stop or action expires. | Check GitHub jobs and host service before choosing Retry or Force remove. |
| 4. Unregister from GitHub | Watch GitHub removal. | Runner registration removed. | GitHub API or permission failure. | Check organization Actions runners and reconnect GitHub before retrying. |
| 5. Remove software | Watch managed host cleanup. | Managed software cleanup acknowledged; unreachable hosts require manual cleanup. | Cleanup failed or host offline. | Use documented host uninstall instructions; preserve unrelated project files. |
| 6. Remove from controller | Verify inventory and audit. | Enrollment removed with audit trail. | Controller state failed to finalize. | Check removal audit, reconcile or retry; do not claim successful uninstall from an offline host. |

## Known limitations

- Closing the modal does not cancel removal.
- Force removal does not prove local software cleanup.
- A persisted phase without a live action is stalled, not active.

## Support escalation

Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.

_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._
