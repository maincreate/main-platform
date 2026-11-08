# Build routing for GitHub Actions (ESP-IDF pilot)

**Status: GitHub Actions build workflow generation and exact-runner label provisioning implemented.** GitHub repository workflow installation remains a reviewed commit; Main{Create} does not silently edit repository workflows. Hardware flashing is not implemented.

## Goal

An AI assistant writing code via a GitHub PR and a developer pushing code from an IDE should converge on the **same** GitHub source commit, version-pinned SDK, self-hosted builder and immutable firmware artifact. Main{Create}'s Projects page holds the routing assignment.

## Supported first workflow

| Dimension | Current support |
|---|---|
| GitHub repository | Private, non-archived, synchronized into Main{Create} |
| Build machine | Online Main{Create} managed Linux ARM64 GitHub Actions runner |
| SDK | ESP-IDF **v5.5.6** (operator-installed, environment verified by workflow) |
| Triggers | Pushes to `main` and manual GitHub `workflow_dispatch` |
| Artifact | Binaries, `flasher_args.json`, project description, SHA-256 manifest |
| Flashing | **Not included**; separate verified device/firmware adapter required |
| Other SDKs/architectures | Compatibility catalog and installer work are separate; no silent fallback |

Do not use a public repository to execute untrusted workflows on a shared self-hosted runner. Public projects need a separately isolated runner pool and a distinct policy.

## Setup

1. **Enroll a builder** in Main{Create}, ensure the managed GitHub Actions runner is registered **online** for the selected organization, and install/verify ESP-IDF v5.5.6 on it. The runner environment must export `IDF_PATH` to the **approved v5.5.6 directory** (for example an operator-managed `/opt/.../esp-idf-v5.5.6`), with working `export.sh` and compiler environment.
2. Under **Projects**, synchronize a private GitHub repository.
3. Choose **Assign build / flash route**, select a managed Linux ARM64 builder, choose **GitHub Actions** and **ESP-IDF 5.5.6**, and save the routing policy.
4. Reopen the route. Click **Provision builder label**. Main{Create} verifies the GitHub organization runner **name, ID, and online state**, then adds one unique label `maincreate-host-<GitHubRunnerId>` without removing other labels. This requires the GitHub App's Self-hosted runners: **write** permission.
5. Click **Generate workflow**. Preview and copy the YAML. Commit it as `.github/workflows/maincreate-firmware.yml` in **the selected private repository** after reviewing it.
6. An IDE push to `main` or an AI-generated change merged into `main` starts the **same** pinned GitHub build. Use the GitHub Actions run link and artifact manifest as the source of truth.

The generated workflow never accesses the Main{Create} management token or device serial ports. It does not auto-flash, regardless of the route's saved auto-flash preference.

## What GitHub permissions actually change

- Provisioning the runner label modifies the organization's selected registered runner labels **only**. It does not install a workflow, clone a repository, run an SDK installer, flash hardware or grant new repository rights.
- Committing the generated workflow is a separate code change requiring repository contents write permission, which Main{Create} deliberately does not assume.
- GitHub Actions `push` triggers do not require a live MCP tunnel or agent at build time. This is the key that makes IDE and ChatGPT development equivalent.
- Jobs execute code from the repository on the designated machine. Do not enable pull-request-from-fork triggers on persistent privileged builders.
- Firmware integrity and target verification are separate. Hashing an artifact after build verifies integrity across transport, but does not authenticate who authored it. End-to-end flash requires provenance enforcement and device-specific approval.

## Planned next milestones

- Support generating workflows for validated Arduino CLI and other SDK/toolchains only after their build adapters, board target configuration and artifact layouts are reviewed.
- Install workflow YAML into the selected repo via an explicitly approved GitHub PR with minimal repository contents permissions.
- Track GitHub run IDs, commit SHAs and artifacts back into Main{Create}'s project history; currently they are visible in GitHub Actions separately.
- Verify exact attached ESP32 chip/board and flash layout using a fresh read-only probe, bind it to a pinned immutable artifact, lock the serial device and require explicit approval before USB writes.
- Add verified auto-flash policy only after that complete safety path exists.
