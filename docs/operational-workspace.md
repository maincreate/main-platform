# Operational workspace and device-aware release architecture

## Why the homepage changes

A workspace is not a configuration wizard. First use is an account and optional source connection; regular use starts with state and activity. The authenticated homepage now shows real counts and recent rows for projects, enrolled builders, connected USB serial devices and approved jobs. GitHub, optional AI, themes and password policy live in `/settings`.

Routes: `/` Overview, `/projects` GitHub inventory, `/jobs` builders and jobs, `/devices` serial inventory, `/topology` connection visualization, `/settings` optional integrations and preferences. None of these pages imply AI is required.

## Project inventory

A signed-in administrator selects a GitHub App installation under Settings → GitHub. On Projects, **Sync repositories** calls GitHub's user-installation repository metadata API with the existing encrypted GitHub user token, retaining a bounded snapshot of up to 500 repositories in `TT_DATA_DIR/projects.json`.

The Projects page joins repository names with *actual TinkerTunnel job records* carrying an explicit source repository and pinned revision. A Git push is not recorded as a successful build. The snapshot is not continuously polled; it needs manual sync in this release. GitHub App user-token expiry currently requires reconnecting.

## Read-only device discovery

A trusted enrolled runner can explicitly enable `TT_RUNNER_DEVICE_DISCOVERY=1`. It invokes the bundled `runner/scan_devices.py` through an operator-selected Python interpreter with `pyserial`. It enumerates ports on Linux, macOS and Windows without opening them, then sends a bounded authenticated report outbound to the controller.

The controller keeps `TT_DATA_DIR/devices.json` with: opaque device ID, reporting runner identity/name, port (e.g. `/dev/ttyACM0`, `/dev/cu.usbmodem...`, `COM3`), USB VID/PID, device serial if present, interface, location, manufacturer, product, optional user label, first-seen and last-seen timestamps.

**Identity rules**:
- USB VID/PID + manufacturer-provided serial + interface is the preferred persistent match, scoped to the enrolling runner. Port renumbering does not create a new record.
- Without a serial, match only by USB location or port within that runner. The UI explicitly labels this lower-confidence identity. **Never permit unattended flashing on a location- or port-only identity.**
- A complete successful scan that omits a previously attached device marks it offline. Scan failures preserve previous observations; stale connected displays age into offline after two minutes.
- After 7 days unseen, records leave the default visible list and appear in Hidden. After 30 days unseen, they move to Archived. They are retained and restored if seen again. No automatic permanent deletion.
- An administrator may rename devices without changing their hardware keys.

Existing MCP tools expose the inventory read-only: `tt_discover({resource:"devices"})` lists visible reported devices and `tt_inspect({resource:"device",id:"..."})` returns a single sanitized device record. Neither tool opens a serial port or changes hardware. No seventh MCP tool is required.

The runner opt-in does not grant execution capabilities. For a host installation: install Python 3 and `pyserial`, then run the current TinkerTunnel agent with `TT_RUNNER_DEVICE_DISCOVERY=1`. A containerized runner must have explicit access to USB host devices; Docker containers do not automatically see physical ports. Do not grant a Docker socket or privileged mode merely to enable discovery.

## Topology correctness

A GitHub App authorization links source identity to TinkerTunnel's controller directly. Its connecting line passes **above** the Secure Access and MCP tool gateway cards. It is not routed through MCP. Another lane represents attached USB serial devices; device edges originate from the enrolled builder that reported each device. Only actual recent observations are displayed as connected.

## Safe manual firmware flash — next controlled capability, NOT enabled

The user-facing desired workflow is:

1. Select an existing **successful** TinkerTunnel build job and its downloadable artifact.
2. Select one currently connected discovered device attached to an authorized runner.
3. Verify artifact provenance: repo + exact commit SHA + builder + declared target chip + checksum + complete flash layout. A plain application binary is **not** a safe general replacement for a complete ESP-IDF image.
4. Ask the target runner to re-enumerate ports and verify hardware identity, chip and port immediately before flashing. Reject missing or ambiguous serial identity or unsupported targets.
5. Produce an immutable flash plan showing chip, build, bytes, port, and any memory sections touched; require explicit user approval and device-level opt-in.
6. Execute one fixed, version-validated `esptool` adapter without a shell and stream logs/artifacts. Support safe failure, timeout and serialization per physical port.
7. Persist flash history on the device record, including build SHA, image digest, operator, timestamp and outcome.

Espressif's esptool supports creating a merged image and flashing it at its correct offset. TinkerTunnel must only accept flash layouts it can verify; it must not guess partition offsets or reuse firmware for a different board. This release does not expose a flash button that does nothing, and it does not enable the reserved `firmware.esp_idf.flash` capability.

## Git-driven automation — design gate, NOT enabled

The requested eventual operator workflow is **commit → build → match an attached device → flash**, even without an AI assistant. To make it safe and predictable, it should be a versioned, auditable policy, separate from GitHub identity:

```yaml
trigger:
  source: github
  event: push
  repository: MainCreate/WaymarkerOS
  branch: release-test
build:
  capability: firmware.esp_idf.build
  runner: approved-arm64-builder
  require_exact_commit: true
flash:
  enabled: false   # intentionally disabled until manual flash is proven
  device_id: stable-serialized-device-id
  image_type: merged-esp32s3
  only_if: [build_succeeded, artifact_verified, device_online, device_idle, chip_matches]
  on_absent_device: skip
policy:
  review_required: true
  debounce_seconds: 120
  max_in_flight: 1
```

Requirements before enabling: signed GitHub webhook events or properly authenticated polling (not page views), replay protection, policy scope by repository and branch, exact SHA builds, idempotency per event/commit/device, verified artifacts, manual flashing validated on test hardware, per-port leases, user audit trail, and a stop/disable mechanism. If the device disappears or changes identity, fail closed. Never interpret a GitHub notification itself as authorization to flash.

## Release scope

**Implemented in the operational-home branch:** homepage and Settings move, GitHub repository metadata sync, USB device reporting and persistence, 7/30 lifecycle and restoration, readable hardware inventory, topology bypass and builder/device edges, existing jobs associated with repositories.

**Not implemented by this branch:** actual serial write/flash, GitHub webhook receiver, automatic build/flash policy engine, SDK autodetection, or production ChatGPT OAuth. Those are separate adapter and authorization milestones, not UI states to fabricate.

To verify: run Node 22+ `npm test`; verify the private Dockerfile image has the new controller modules and assets; log in and visit all pages; connect/sync GitHub; enroll a test runner and enable read-only device discovery; unplug/replug a USB device, changing port if possible; validate 7/30 lifecycle in unit tests; ensure the controller has `TT_ENABLE_FABRIC_EXECUTION=0` unless separately enabled.
