# TinkerTunnel Capability Fabric v0.2

**Status:** Implemented for release testing. Physical builder validation and remote ChatGPT OAuth are separate acceptance gates.

## Stable MCP surface

The authenticated `/mcp` gateway now advertises six tools. Capability IDs are arguments, not separate MCP tools.

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `tt_discover` | `resource`, optional `query` | List workspace, runners, capabilities, toolkits, jobs, or assets |
| `tt_inspect` | `resource`, `id` | Read a capability input schema, runner, toolkit, or job |
| `tt_plan` | `capability`, `runner_id`, `parameters` | Validate a versioned capability or workflow; persist a 30-minute plan |
| `tt_execute` | `plan_id` | Request an approval-pending job, idempotently per plan |
| `tt_jobs` | `action=list|get|logs|cancel`, `job_id` | Query or cancel **unclaimed** jobs |
| `tt_assets` | `action=list|begin|chunk|finish|get` | Upload/download bounded artifacts with ordered chunks and SHA-256 |

The four prototype tool names remain callable as legacy aliases but are no longer advertised.

The MCP server uses protocol version `2025-11-25`, returns `structuredContent` as well as text, and supports the HTTP POST path. **Remote OAuth, resource metadata and ChatGPT-facing authentication are not implemented yet**. The current gateway requires an operator-provisioned `TT_MCP_TOKEN` bearer secret and must remain private.

## Curated registry and workflows

`registry/capabilities.json` holds version, JSON argument schema, supported OS, risk, availability, and ordered steps. `registry/toolkits.json` holds catalog entries and marks SDKs **operator-managed** rather than falsely installed. Adding a manifest does not change the six public MCP tool names. The controller refuses to enable a capability without a reviewed runner adapter; adding JSON alone cannot create a generic shell command.

Implemented adapters:
- `host.snapshot@1.0.0`: read-only host diagnostics and a JSON asset.
- `firmware.esp_idf.build@1.0.0`: compile a clean, operator-allowlisted local checkout at an exact pinned SHA; no clone, shell, install, flash, or deploy.
- `workflow.esp_idf.preflight_build@1.0.0`: host snapshot then ESP-IDF build, with one approval covering the ordered steps.

Visible but **unavailable**: `sdk.esp_idf.install`, `firmware.esp_idf.flash`, and `deployment.release`.

Example planning request:

```json
{
  "capability": "workflow.esp_idf.preflight_build",
  "runner_id": "enrolled-runner-id",
  "parameters": {
    "repository": "MainCreate/WaymarkerOS",
    "revision": "40-character-commit-sha-from-git"
  }
}
```

Use that result's `plan_id` in `tt_execute`; it creates a job awaiting approval. A signed-in administrator approves the exact job on `/jobs`. The agent then claims approved work outbound.

## Machine opt-in

The operator must set `TT_ENABLE_FABRIC_EXECUTION=1` on the **controller** after testing. Its default is **off**, even after a job is approved.

To enroll a machine, open **Jobs & Builders**, generate an expiring pairing token, and run the shown enrollment command from the trusted machine. Then start `node runner/agent.mjs run` using the same controller URL and saved enrollment state.

For ESP-IDF builds, the **runner** independently requires:

```sh
TT_RUNNER_ENABLE_BUILDS=1 \
TT_RUNNER_PROJECTS_JSON='{"MainCreate/WaymarkerOS":"/home/builder/WaymarkerOS"}' \
TT_CONTROLLER_URL=https://your-private-controller.example \
node runner/agent.mjs run
```

The runner checks the explicit local checkout allowlist, the planned 40-character Git commit, and clean working tree. It then runs `idf.py -C <allowlisted-path> build` with `shell:false`. An operator may set `TT_RUNNER_IDF_CMD` to the trusted executable. No MCP argument controls the binary, flags, directory or shell. **ESP-IDF builds run CMake/project code**; use an unprivileged isolated host and only trusted repositories.

## Jobs and files

Job statuses include approval pending, queued, running, completed, failed, rejected and cancelled. Running jobs cannot yet be interrupted; crashed runners can leave a job `running` and require operator reconciliation. There is no automatic redispatch.

Artifacts use random IDs under `TT_DATA_DIR/assets`, with upload/download chunks no larger than **48 KiB**, a per-file limit of **8 MiB**, and **80 MiB** aggregate quota. Uploads support optional SHA-256 verification. The runner may upload only for its own claimed job. Incomplete uploads count toward quota; automated garbage collection is future work. Logs are bounded. Data persists in `TT_DATA_DIR/fabric.json` and `assets` and needs backup.

The state store is deliberately single-controller. Do not share its writable directory between active-active instances.

## Verification before enabling live builds

1. Run `npm test` on Node.js 22+ and verify the Docker image builds.
2. With execution disabled, test the authenticated `/jobs` page, plan creation, approval flow, and rejected unsupported capabilities.
3. Enroll a machine and verify heartbeats.
4. Deliberately enable controller execution; approve `host.snapshot` and retrieve the JSON artifact.
5. On a sandboxed ESP-IDF machine, opt into builds and verify a clean pinned checkout, logs, firmware artifacts, and SHA-256.
6. Test cancellation before claim, failed jobs, and token rejection.
7. Add standards-compliant remote MCP OAuth before treating a ChatGPT cloud connection as supported.

This v0.2 release does **not** implement arbitrary shell commands, unsigned SDK installation, firmware flashing, automated deployment, production OAuth or multi-tenant isolation.
