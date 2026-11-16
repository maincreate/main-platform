# Main{Create} toolkit workflows

Main{Create} separates **toolkit installation**, **build execution**, and **device operations**. A toolkit installed on a builder does not imply that every connected device operation is available on that host.

## Ownership and execution

- `main-marketplace` publishes exact toolkit versions, host OS/architecture compatibility, target profiles, artifacts, capabilities, and lifecycle requirements.
- `main-platform` resolves compatible builders, dispatches installation/cleanup workflows, reconciles verified GitHub runner labels, and generates project workflows.
- `main-builders` owns the version-pinned installer and device-operation adapter, vendored here as `scripts/maincreate-toolkit.sh`.
- GitHub Actions self-hosted runners execute the workflows. Builds and device operations may run on different machines.

The Marketplace page dispatches `.github/workflows/toolkit-install.yml` to one selected managed builder using its unique `maincreate-host-<runner-id>` label. After the workflow verifies the exact installed version, the controller adds the version and capability labels to that GitHub runner. Cleanup is dispatched separately and removes only the selected version's labels after successful removal.

## Current toolkit targets

| Toolkit | Installed on | MainCreate build host support |
|---|---|---|
| ESP-IDF 5.5.6 | Linux x64, Linux ARM64 | Linux x64, Linux ARM64 |
| ESP-IDF 6.1.1 | Linux x64, Linux ARM64 | Linux x64, Linux ARM64 |
| Android SDK 2026.2.2 Patch 1 | Linux x64 | Linux x64 |
| Arduino CLI 1.5.1 | Linux x64, Linux ARM64 | Linux x64, Linux ARM64 |

The catalog includes upstream compatibility for additional platforms where applicable, but Main{Create} only marks the Linux installation/build combinations above as validated by its current installer workflow.

Android ADB device operations are separate from Android SDK installation. The deployment builder can be Linux ARM64 with `adb` and USB access; it does not need the full Android SDK. Debian builder prerequisites include `adb`, `android-sdk-platform-tools-common`, `unzip`, and Python. Linux x64 Android build hosts also require JDK 17 or newer.

## Project workflow

The project routing page generates `.github/workflows/maincreate-device-pipeline.yml`. Commit the generated workflow to the project's private repository.

- Push to the project's default branch triggers the build reusable workflow on the selected compatible build runner.
- `workflow_dispatch` exposes a build operation and separate device operations.
- Build artifacts are uploaded with a checksum/provenance manifest and retained for 30 days.
- Device operations download an artifact from a previous workflow run using its run ID and artifact name. This is the cross-runner handoff; the build runner does not need to be connected to the target device.
- Device operations are manually dispatched. Flash/install/restore require an explicit boolean confirmation.

### ESP-IDF

The build workflow invokes the exact installed EIM-managed version, runs `idf.py build`, then produces a merged firmware image and manifest. The device workflow supports:

- `esp32-probe` — read-only chip-family and eFuse MAC discovery.
- `esp32-flash` — writes a verified firmware bundle to a matching ESP32.
- `esp32-backup` — reads the complete flash image and stores a manifest.
- `esp32-restore` — restores a backup only to the same eFuse MAC, matching chip family and flash size.

The ESP32 workflow requires an expected eFuse MAC for every write/readback operation. USB VID/PID and `/dev/ttyUSB0` are not stable hardware identity. The current USB-serial bridge may not expose a USB serial number; the ESP32 eFuse MAC provides the stable chip identity after a live probe.

### Android

The Android build workflow supports two target profiles:

- `android-current-api37` — current Android application target, API 37.
- `android-legacy-api22-eink` — Android 5.1.1/API 22, targetSdk 22, APK output, and `armeabi-v7a` native ABI where native code is used.

The registered E Ink device is `avalue-epd-42s`: Avalue EPD-42S / `SABRESD_MX7D`, product `sabresd_7d_eink`, NXP/Freescale i.MX7D ARMv7, Android 5.1.1/API 22, and EPD-42S-SIDA0-01R 2880x2160 panel. The legacy install step also checks the live Android product/model, API level, ABI, and ADB serial.

Android device operations are application-object operations, not firmware flashing:

- `android-probe` — read-only ADB serial, API, ABI, product and model discovery.
- `android-install` — installs a verified APK with `adb install -r`.
- `android-backup` — exports the installed APK and checksum manifest. It does not claim to back up private app data or the entire device.
- `android-restore` — reinstalls the verified APK on the same ADB serial. It does not restore Android OS firmware or private app data.

The generic Android SDK does not include the E Ink vendor HAL, EPDC driver, waveform files, or BSP integration. Those remain device-specific application integration work.

## Preflight and testing

1. Install ESP-IDF 6.1.1 on both Linux builders using Marketplace (choose all compatible builders).
2. Install Android SDK 2026.2.2 Patch 1 on the Linux x64 builder. Explicitly accept the Google SDK license in the Marketplace UI.
3. Ensure the Pi host has `adb` and `android-sdk-platform-tools-common`. If its host installer predates this change, run `sudo apt-get update && sudo apt-get install -y adb android-sdk-platform-tools-common unzip python3-venv`.
4. Ensure the x64 builder has JDK 17 or newer. If missing, run `sudo apt-get install -y openjdk-17-jdk-headless`.
5. Open the Main{Create} Platform repository's Actions tab and dispatch `device-preflight.yml` to the Pi runner using its unique host label. Supply `/dev/ttyUSB0` for the ESP32 probe. The workflow lists stable serial paths and authorized ADB devices.
6. Record the ESP32 chip family and eFuse MAC from the probe; record the EPD-42S ADB serial from `list-android`.
7. Configure the project build route to use the x64 builder for builds and the Pi builder for device operations. Provision both unique runner labels and commit the generated project workflow.
8. Run a build, note its workflow run ID and artifact name, then manually dispatch `esp32-flash` or `android-install` with the exact device identity and explicit confirmation.

Do not flash an ESP32 until the live eFuse MAC matches the intended board. Do not install the E Ink APK unless the live ADB product/model, API 22 and `armeabi-v7a` checks pass.

## Cleanup

Marketplace cleanup dispatches `.github/workflows/toolkit-cleanup.yml` with a second explicit confirmation. ESP-IDF removal uses EIM for the exact selected version; Android cleanup removes the API 37 platform and Build-Tools 36.0.0 while preserving API 22, command-line tools and Platform-Tools shared by other work. Project checkouts, firmware/APK artifacts, backups, signing keys, Gradle data and user data are not deleted.
