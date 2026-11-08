# Device discovery, compatibility and safe flashing

## Current milestone: discovery and reference catalog

The managed **Go** Host Service v0.6.0 discovers connected USB serial adapters on Linux using `/sys/class/tty`; it does not open a serial port or execute a chip-probe command. It reports the observed descriptor to `POST /api/agent/devices` using the enrolled host's own credential. Discovery runs at boot and every 60 seconds unless `MAIN_HOST_DEVICE_DISCOVERY=0`. An unavailable sysfs is an error, **not** an empty device report.

The controller stores observations in `MAIN_DATA_DIR/devices.json`. The Devices page lists the reporting builder, connection status, USB ID, port and possible microcontroller/SDK associations. The Marketplace page reads the source-linked `registry/microcontrollers.json` catalog.

**Important**: USB VID/PID identifies a USB interface, not necessarily the MCU behind a USB-UART bridge. Espressif `303a:1001` means USB Serial/JTAG, **not** proof of ESP32-S3 or a particular Waveshare display. A generic CP210x or CH34x converter cannot establish the target MCU. The compatibility catalog always sets `verifiedChip:null` and `flashReady:false`.

## Test on a Linux ARM64 builder

1. Confirm the controller has deployed Host Service 0.7.0 and the builder is online. Migrate pre-0.7.0 installations over SSH before using remote upgrades.
2. Connect the device by USB **data** cable to the same enrolled builder. Do not confuse the separate CI container runner with a physical USB-attached builder.
3. Wait up to 60 seconds and refresh **Devices**. The inventory should show the port (`/dev/ttyACM*` or `/dev/ttyUSB*`), actual VID/PID, identity confidence, last seen and candidate SDKs.
4. If missing, check locally with `ls -l /dev/serial/by-id/` and `lsusb`; check `journalctl -u maincreate-host -n 100 --no-pager` for `USB discovery` or `USB inventory report` errors. Those are *read-only diagnostics*.
5. If a device is in USB mass-storage boot mode or exposes no serial interface, the current serial-only scanner will not see it. Add a separate bounded USB-interface inventory before claiming full board discovery.

No automatic USB permission changes or user-space shell execution are required for the sysfs scanner.

## Compatibility marketplace policy

- Reference `status:pilot`: a version/platform combination has been selected for testing, **not** an end-to-end installation certification.
- `status:review`: an upstream SDK exists but its specific chip version and host installation recipe have not been verified.
- `status:board-dependent-review`: the framework can support boards in the family, but no chip-wide claim or verified board configuration is implied.
- A successful test should record board SKU, chip ID, supported target, SDK commit/tag, toolchain dependency locks, host OS/arch, firmware output and a review timestamp. Only then can the entry be promoted to a validated install recipe.

## Next milestone: read-only chip probe

Use a controller-approved structured capability `device.identify`, scoped to a device ID and reporting builder. For Espressif, invoke a version-pinned esptool executable with fixed read-only chip identification flags and bounded timeout. Verify the port identity before and after the probe, and do not flash, erase, write eFuses or reset into a destructive mode. The probe result should include chip model, revision and serial/MAC only where permissible. A common USB bridge is never enough to select a flash adapter.

## Later: gated flashing

A separate `firmware.flash` capability must require all of: verified chip identity, exact target board/flash layout, immutable artifact digest and source commit, explicit user confirmation of the connected target, fresh connection/port validation, builder exclusivity lock, compatible and reviewed adapter, structured results and audit trail. Device identity, artifacts and SDK version should form the immutable execution record. No automatic flashing on source pushes until a separately configured approval policy exists.
