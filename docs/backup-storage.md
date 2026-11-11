# Shared NFS backup storage — development status

Main{Create} Platform manages datastore assignments. Selected managed Linux
builders mount the export themselves and write device images directly to it.
The platform stores configuration and job metadata, not device dump payloads.

Expected layout:

- `Platform Backups/`: encrypted recoverable controller backups (not implemented).
- `Device Backups/{serial}_{device name}_{builder host}/{timestamp}-{id}/`:
  `flash.bin` and `manifest.json` (writer implemented; device reader not yet connected).

Settings → Backup storage saves an NFS server/export and two independent usage checkboxes: Platform backups and Device backups. Enabling Device backups requires at least one eligible managed Linux builder or builder group; the controller sends authenticated NFS mount requests only to those builders. Enabling Platform backups alone does not trigger builder mounts. Explicit builder and group assignments are supported. New group members inherit the export. Mount requests use the existing authenticated host
action queue. Results describe the most recent mount/write check, not continuous
mount health. Retry revalidates a completed or failed request. Authenticated management polls from Host Service 0.8.0+ reconcile assignments every five minutes, recovering mounts after reboot. Completed checks older than six minutes display as stale. Platform selection
is explicitly pending host mount integration, not a claim of backup readiness.
The non-root controller container does not receive privileged mount access.

The first implementation supports DNS/IPv4 NFSv4 exports and managed Linux hosts.
NFS client packages are included in the updated Debian installer. Existing hosts
need the new service and those packages. Root-squash permissions must allow the
mapped identity to write. Mount options are fixed, not arbitrary user commands.

The backup policy module requires a verified backup tied to the same device AND
flash job by default. Explicit skip mode requires acknowledgment. A failed backup
never silently changes the policy. This gate is not wired to a flash adapter;
flashing remains unavailable.

## Remaining implementation and validation

- Storage editing/removal and active-job interlocks (the current UI adds new datastores; it cannot safely change assignments after creation).
- Group member removal with safe mount-detachment handling (creation and additive membership implemented).
- Live reboot-recovery validation, capacity reporting and storage action history retention.
- Controller host mount integration and encrypted platform backup/restore.
- Device probe/read adapter, exclusive device lock and security compatibility gates.
- Wire backup policy and writer into approved manual flash jobs.
- Restore, retention, backup inventory and schedules.
- Live tests: root squash, server loss, full share, partial reads, device disconnect,
  concurrent jobs, rename/move identity, flash without backup and restore.

No actual NAS or physical device was modified while developing these changes.
