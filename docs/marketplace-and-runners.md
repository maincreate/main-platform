# TinkerTunnel — Marketplace + shared runner foundation

Status: implementation preview. Catalog lookup and dry-run planning are implemented.
Host installation, GitHub dispatch, flashing, OAuth, remote MCP, and runner registration
are **not** implemented. This document is a plan, not a deployment report.

## Product design

ChatGPT is the interface; TinkerTunnel is the authenticated capability router.
The marketplace is a *signed/versioned-source-of-truth aspiration*, not an unrestricted
catalog of executable install scripts. Recipes commit to the repository, pass schema
validation, and eventually require review, provenance, integrity checks and signatures
before publication. A repository commit alone is not a software supply-chain signature.

Chat tools, organized by lifecycle:

| Phase | MCP capability | State | Policy |
| --- | --- | --- | --- |
| Discover | `framework_search`, `framework_inspect` | Local MCP preview | Read only |
| Plan | `framework_install_plan` | Local MCP preview | Read only, no host access |
| Prepare | `node_list`, `node_capabilities`, `framework_install` | Future | Bound node, scoped identity, user approval |
| Build | `project_list`, `build_submit`, `job_status`, `job_logs` | Future | Repo and ref allowlist, job isolation |
| Devices | `device_list`, `device_flash_plan`, `device_flash` | Future | Human approval + identity + exclusive lock |
| Delivery | `artifact_verify`, `artifact_publish`, `release_promote` | Future | Immutable hashes, release signing |
| Operations | `audit_search`, `agent_health`, `device_logs` | Future | Scoped read access |

**No generic run-command or arbitrary installer-script MCP tool.** Rich
conversational control comes from composable *bounded* capabilities, not unrestricted
root access. The executor verifies permissions and arguments even when the LLM
requests the action. Tool descriptions are not authorization.

## Marketplace contract v1

`catalog/frameworks/*.json` describes: id, exact version, classification,
supported OS/architecture, capabilities provided, upstream provenance and a
hardcoded implementation adapter. All fields are validated and unknown fields
are rejected. There is no `shell` or `command` field. Current installation
strategy is `verify-existing` only: managed installation is an explicit next
milestone after authenticated agents, execution sandboxing, and approvals exist.

Initial recipes:
- `esp-idf@5.5.6`: validated ARM64 Linux build-host target, existing Waymarker
  builder toolchain must be detected; no global `latest` alias.
- `swift@6.1.2`: macOS toolchain verification; Xcode build tools, licenses,
  provisioning and signing need separate managed adapters.

Future community marketplace: proposed recipe -> automated validation ->
maintainer review -> signed version -> optionally install; no unreviewed
community recipes executing on a personal or production host. Dependencies,
hardware-specific verified installer packs and version compatibility rules come
before opening submissions to the public.

## Runner pools and organization boundaries

Use a *single development organization* for shared project runners (proposed:
`Lotus-Link-Technologies`, pending explicit choice). Keep the product's main
`TinkerTunnel/tinkertunnel` code in its existing product organization. An
organization-level GitHub runner does **not** become available to repositories
in other organizations; cross-organization sharing needs an enterprise-level
runner group or an orchestration boundary. TinkerTunnel can coordinate builds
via registered agents or permitted GitHub dispatch without pretending all
repositories use one native runner group.

| Role | Existing machine | Runner selector (target) | Responsibilities |
| --- | --- | --- | --- |
| Shared ESP32 builder | `waymarker-build-01` Pi ARM64 | `tt-esp32` | Compile many ESP-IDF projects with separately pinned toolchains |
| USB verification/flashing | `waymarker-lab-01` Pi | Separate restricted device provider | Chip identification, flashing, serial capture |
| Shared Apple builder | `macos-sequoia-dev` candidate | `tt-apple` | Swift/Xcode builds, subject to supported Mac hosting/licensing |
| Future Linux builders | Dedicated worker | `tt-linux` | Generic Linux application builds |

One physical builder can service many projects serially. One queue does not
mean unlimited parallelism: limit a 16GB Pi to one heavy IDF compile job until
measured. Install toolchains side-by-side under versioned paths; use immutable
project locks and version-specific caches. A project may require different
ESP-IDF versions. The runner should have no Docker socket, administrator
credentials, access to the flashing USB device, or deploy secrets.

**Security:** Self-hosted runner labels are routing hints, not security
boundaries. Use organization runner group/repository access restrictions,
reusable workflows pinned to reviewed immutable refs, project allowlists,
least-privilege GitHub App credentials, and isolated build workspaces. Do not
run untrusted pull requests or public forks on a persistent lab host. Prefer
ephemeral per-job runner instances or clean container/VM boundaries where
feasible. A Mac build runner must use a legally supported Apple host.

Existing Waymarker workflow is manual, checked out at
`a728870299b4a2f1a80dda4334ff5b8f78d8efef`, and **build-only**; do not
replace it or enable auto-flash as part of runner migration. That is the
trusted regression reference until the new setup passes parity tests.

## Operator migration sequence

1. Confirm which org owns the shared build farm. `TinkerTunnel` and
   `Lotus-Link-Technologies` are separate org installations.
2. Confirm GitHub Actions is enabled for the chosen org and identify plan
   limits for self-hosted runner groups and reusable workflows.
3. Create a restricted org runner group for selected **private** repos; protect
   the workflow entry point and reject fork/PR-triggered runs on lab hardware.
4. Audit the current Waymarker Pi runner and installed ESP-IDF 5.5.6. Avoid
   duplicate registration that accidentally causes two competing jobs.
5. Migrate WaymarkerOS using GitHub **Settings -> General -> Danger Zone ->
   Transfer ownership** after confirming receiving-org permissions. Transfer
   is an admin operation and is not provided by the current GitHub connector.
6. Register a dedicated unprivileged org runner, validate its health and a
   pinned Waymarker build, compare hashes/output, and preserve old rollback
   files; only then retire the per-repo registration.
7. Register a supported Mac builder after verifying Xcode availability and
   licensing; do not assume a generic macOS VM provides a compliant iOS
   signing environment.
8. Add node enrollment/authorization, approved installer adapters, GitHub
   dispatch and asynchronous job tracking to TinkerTunnel's secure MCP
   control plane; connect R2 artifacts and VictoriaLogs per existing
   `docs/mvp-architecture.md`.

## MCP remote access boundary

`tinkertunnel.mcp_server` is **local stdio only** and exposes three read-only
marketplace tools. It is not deployed and not wired into ChatGPT. Remote
ChatGPT integration requires a public HTTPS MCP entry point with supported
OAuth, per-user identity, short-lived scoped authorizations, tenant isolation,
audit records, and agent-to-control-plane outbound connection. Auth and
approval cannot be delegated to prompt wording.

References:
- https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access
- https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
- https://docs.github.com/en/actions/reference/runners/self-hosted-runners
- https://modelcontextprotocol.io/
