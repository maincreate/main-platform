# TinkerTunnel Local portal/controller

The **repository-root** `compose.yaml` deploys the portal/controller and the separate MCP gateway together; do not use a `/portal` base directory in Coolify.

The existing portal serves dashboard, framework catalog and dry-run planner. The new **/setup** page adds an authenticated onboarding wizard for instance metadata, GitHub App installation verification, optional Cloudflare tunnel preparation, MCP credentials, and one-time runner enrollment.

## Trust boundaries

- Web administration uses `TT_ADMIN_TOKEN` (at least 32 random characters) and an HttpOnly, SameSite=Strict short-lived session cookie with CSRF protection.
- `TT_MASTER_KEY` must be 32 bytes hex-encoded (64 hex chars). GitHub PEM private keys are encrypted with AES-256-GCM before being written to the local JSON state volume.
- State is mounted only on the portal service and written atomically with Unix mode 0600.
- One-time runner invite tokens expire after 10 minutes; enrolled runner tokens are stored as SHA-256 hashes in the controller.
- The separate MCP gateway has a distinct `TT_MCP_TOKEN` and `TT_SERVICE_TOKEN`. Only four read-only tools are exposed.
- The `tunnel` profile is optional and must target **gateway only**. Public browser access is not supported until proper OAuth and identity protections are implemented.
- No Docker socket, arbitrary shell interface, host filesystem mount or device passthrough is provided.

## API status

| Method | Route | Access |
| --- | --- | --- |
| GET | /healthz | Local health |
| GET | / | Dashboard preview |
| GET | /api/v1/catalog | Read-only catalog |
| POST | /api/v1/plans | Read-only dry-run plan |
| GET | /setup, /setup.js, /setup.css | Public login/setup assets |
| POST | /api/local/login | Admin token |
| GET | /api/local/session | Browser session |
| GET/POST | /api/local/config | Admin cookie + CSRF for writes |
| POST | /api/local/github | Admin: encrypted key storage |
| POST | /api/local/github/verify | Admin: live GitHub App verification |
| POST | /api/local/runners/invite | Admin: single-use enrollment token |
| POST | /api/agent/enroll | Single-use invite |
| POST | /api/agent/heartbeat | Per-runner bearer token |
| GET | /api/internal/status | Internal service bearer |
| POST | Gateway :3001/mcp | MCP bearer token |

Actual job execution, device flashing, artifact publishing, ChatGPT OAuth and tunnel reachability probes are future milestones. The current role selector records topology intent but does not reconfigure containers.

Refer to [../README.md](../README.md) for installation and Docker profile commands.
