# Add a build machine

> Status: **implemented** · UX contract: `builder-add` · Version: `2026.11.08`

**Where:** [/builders](/builders) · **Entry:** Add a Build Machine

**Outcome:** /builders

**Resume:** Builders → Actions → View setup progress

## User journey

| Step | What you do | Confirmation | When it fails | Recovery |
| --- | --- | --- | --- | --- |
| 1. Choose machine and connection | Choose platform and pairing method, then confirm the SSH fingerprint. | Pairing request accepted. | SSH identity or connection rejected. | Recheck hostname, SSH credentials and fingerprint before retrying. |
| 2. Enroll Host Service | Wait for controller enrollment. | Host enrollment exists and heartbeat is received. | Host cannot reach controller or enrollment fails. | Inspect the Host Service and outbound HTTPS connectivity; retry without creating duplicate enrollment. |
| 3. Install GitHub runner | Watch the builder claim the provisioning action. | Host provisioning action completed. | Provisioning action failed or expired. | Review Host Service logs and use Retry GitHub registration after checking action state. |
| 4. Register with GitHub | Wait for GitHub runner inventory to show this runner. | GitHub runner registered in the selected organization. | Registration missing or GitHub authorization expired. | Verify the organization and reconnect GitHub; do not create duplicate runners. |
| 5. Verify runner online | Wait for both heartbeat and runner online status. | Runner online and host heartbeat fresh. | Runner remains offline. | Inspect runner service and network connection; use View setup progress. |

## Known limitations

- The displayed setup stages are not a persisted event log; they are derived from enrollment and GitHub state.
- An already enrolled host must not be paired twice.

## Support escalation

Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.

_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._
