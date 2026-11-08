# TinkerTunnel portal and controller

## Account-first onboarding

The same first-use experience applies to any supported deployment: visiting the portal without an administrator redirects to `/setup`, which shows **only** username, password and confirmation. Successful creation establishes an authenticated session and opens `/`, the dashboard. Existing users see a sign-in form.

The instance's default display name is **TinkerTunnel**, not “TinkerTunnel Local”. Host topology, GitHub, runner enrollment and other settings are not part of creating the first user.

The dashboard is a **live operational homepage**: recent build jobs, GitHub repository inventory, enrolled builders, detected USB serial devices, and activity. Optional GitHub, AI, appearance, and account security settings are in `/settings`. USB inventory is at `/devices`; Projects at `/projects`; Jobs & Builders at `/jobs`; the topology at `/topology`. First-use setup remains account-only.

## API and access

| Method | Route | Access |
| --- | --- | --- |
| GET | `/healthz` | Health check |
| GET | `/setup`, `/setup.js`, `/setup.css` | Create first user / sign in |
| POST | `/api/local/bootstrap` | Creates only the first administrator |
| POST | `/api/local/login` | Username and password |
| GET | `/`, `/dashboard.*` | Signed-in admin; main dashboard |
| GET | `/api/local/overview` | Signed-in admin; current status |
| GET | `/github`, `/github.*` | Signed-in admin; GitHub connection |
| GET | `/api/local/github/device/status` | Signed-in admin |
| POST | `/api/local/github/device/config` | Signed-in admin + CSRF; save public Client ID |
| POST | `/api/local/github/device/installations/refresh` | Signed-in admin + CSRF; refresh installed organizations |
| POST | `/api/local/github/device/start` | Signed-in admin + CSRF |
| POST | `/api/local/github/device/poll` | Signed-in admin + CSRF |
| POST | `/api/local/github/device/organization` | Signed-in admin + CSRF |
| POST | `/api/local/github/device/disconnect` | Signed-in admin + CSRF |
| POST | `/api/local/account/password` | Signed-in admin + CSRF; invalidates sessions |
| GET/POST | `/api/local/config` | Signed-in admin; controller configuration API |
| POST | `/api/local/runners/invite` | Signed-in admin; short-lived enrollment invite |
| POST | `/api/agent/enroll`, `/api/agent/heartbeat` | Runner-specific credentials |
| GET | `/api/internal/status` | Internal service bearer token |
| GET | `/api/v1/catalog` | Framework catalog (read-only) |
| POST | `/api/v1/plans` | Dry-run framework planner |

## Security boundaries

- First-run registration requires no code, but whoever reaches an unclaimed instance first can become its administrator. Restrict first-use access to a private or identity-gated network.
- Passwords are salted scrypt hashes. Session cookies are HttpOnly and SameSite=Strict, with Secure when served over HTTPS via a trusted proxy. Mutation APIs require CSRF.
- The portal requires durable, writable `/data`; a fresh 32-byte AES-256-GCM key is generated and persisted as `/data/master.key`, and credentials are encrypted before writing `state.json`.
- A dedicated GitHub App with Device Flow enabled is required for GitHub authorization. Its public Client ID is configured directly in the authenticated `/github` page (optional environment override: `TT_GITHUB_CLIENT_ID`). GitHub App user tokens are encrypted at rest; authorized organization installations are discovered via `GET /user/installations`. Only installed organizations can be selected. Selecting one does not grant runner permissions or create runners.
- Local MCP is bearer authenticated, read-only, and separate. Remote ChatGPT OAuth, build execution, installation and flashing are not active.
- The full catalog/preview route implementation remains inside `worker.js`; it is not the default authenticated first-run experience.

## Design

The static portal uses CSS variables and simple accessible HTML, with no runtime UI framework dependency. Three palettes can be previewed on the dashboard. See [design directions](../docs/design-directions.md) before choosing a more comprehensive component system.

## Penpot MVP UI implementation

The persistent sidebar is based on the connected Penpot MVP design and separates Builders (`/builders`) from local Jobs (`/jobs`). Marketplace (`/marketplace`) reads the existing framework catalog without enabling installation. Existing login/session checks and controller operations are unchanged.

**Not yet implemented:** native GitHub Actions runner installation/label management, GitHub workflow-run history, project-to-runner compatibility assignments, production firmware flash workflows, AI tunnel onboarding. Current builder enrollment registers a TinkerTunnel host agent, not a GitHub Actions runner. These distinctions are explicit in the interface.

## GitHub organization repository provisioning

GitHub App installations may request **Repository creation (write)** to create repositories without broad administration access. An organization administrator must approve newly requested App permissions in GitHub before creation works. The portal uses the authenticated GitHub App **user access token**, so the authorized GitHub user must also have permission to create repositories in the selected organization.

- `GET /api/local/github/repository/preferences`: Read the selected organization, default visibility (initially private) and pending/previous MCP requests.
- `POST /api/local/github/repository/preferences`: Save `{"defaultVisibility":"private"|"public"}`, authenticated with the existing administrator session and CSRF.
- `POST /api/local/github/repository/create`: Explicit, confirmed portal action with `name`, optional `description`, optional `visibility`. Creates a GitHub organization repository with a README and records the result.
- `POST /api/internal/github/repository/request`: Service-token-only endpoint used by the `tt_github_repository_request` MCP tool. **Only queues an approval**, never creates a repository automatically.
- `POST /api/local/github/repository/requests/decision`: Administrator action to approve/reject an exact MCP request (matching organization, name and visibility); only approval performs the GitHub API call.

A new repository is not automatically populated with firmware, an Actions workflow or validated runner configuration. Those require separate project templates and workflow permissions. TinkerTunnel’s MCP gateway is currently bearer-authenticated and the ChatGPT remote OAuth/tunnel experience remains a separate deployment integration.

## First-run repository synchronization and managed builders

Selecting an authorized GitHub organization now runs repository synchronization **before** the server completes organization selection. If the GitHub App's installation repositories cannot be read, setup stays on the organization-selection step with an actionable error. Repositories remain authoritative in GitHub and are cached in `projects.json`.

Builder enrollment now starts on the host itself using the lightweight, cross-platform `runner/service.mjs`. The operator runs `node runner/service.mjs pair` on Linux, macOS, or Windows with Node.js 22+, then enters the **controller HTTPS URL, TinkerTunnel local username, and password** in an interactive terminal. The service uses the existing local-admin login and a one-time runner invitation, then enrolls the bounded host companion. The administrator password is never saved, and ongoing management uses an individual revocable runner token. `node runner/service.mjs run` starts outbound polling, inventory, and bounded job operations.

**No inbound port or SSH service is necessary for Host Service pairing.** The management control plane, host companion, and GitHub Actions runner are independent: the Host Service pairing MVP does **not yet install/register a GitHub Actions runner** or install persistent background services automatically. OS-specific signed binaries and systemd, Windows Service, and launchd installers are the next packaging steps. The long-term capability protocol must include identity, allowed operations, versioned schemas, audit actor correlation, health, package inventory, update plans, and explicit approval for device writes. Do not make arbitrary shell commands remotely available.

Detected tool versions and automatic Linux USB serial discovery remain supported by the existing bounded agent. GitHub Actions runner registration, label reconciliation, and package updates should be implemented as *locally executed verified adapters* mediated by the outbound Host Service rather than controller-initiated SSH. Host software will need a trusted HTTPS certificate for the selected controller hostname. An external tunnel is reserved for remote AI/cloud access and must not be required for on-premises host management.

Deployment fix: the prior Dockerfiles incorrectly contained literal `\\n` characters between Docker instructions. The corrected deployment images use real newlines and no longer require an external npm install step to build the portal.
