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

Builder enrollment uses a single SSH modal for hostname/IP, username and password. The controller first probes the SSH host public-key fingerprint **without transmitting the password**. The user explicitly trusts the fingerprint before remote provisioning. The password is used only during enrollment, never persisted to TinkerTunnel state. On successful supported Linux ARM64/x64 enrollment, the controller installs a SHA-256 verified GitHub Actions runner, registers it using a short-lived organization runner registration token, installs the TinkerTunnel companion as a systemd service, and attaches automatic `tt-managed`, `tt-linux`, and architecture labels. GitHub supplies its built-in OS/architecture labels.

Requirements: reachable SSH, a sudo-capable non-root account, systemd, curl, tar, SHA-256 utilities and outbound HTTPS connectivity to GitHub and TinkerTunnel. Node.js 22 is installed from an official SHA-256 verified Node.js distribution if necessary. The GitHub App requires approved **Self-hosted runners (write)** organization permission, and the authorized user must have organization administration access. Enrollment is intentionally restricted to Linux ARM64/x64 until macOS and Windows provisioning adapters are validated. For host SSH fingerprint verification, compare against the host's own SSH host-key fingerprint; do not accept an unexpected changed fingerprint.

The read-only builder inventory reports detected tool versions and automatically discovers Linux USB serial devices using sysfs. Update actions should only become available when a signed, validated package-specific update adapter exists. The current implementation **does not provide automated SDK updates**. GitHub Actions execution, TinkerTunnel management permissions, and firmware flashing remain independent; flashing is not implicitly authorized by a successful build.

Deployment images include the `ssh2` client dependency and the host agent sources. Managed host enrollment runs asynchronously; operation progress is available via an authenticated polling endpoint and is not persisted across controller restarts. Partial failed remote installations should be inspected before retrying, and an enrollment must not be treated as fully successful without confirming both GitHub Actions runner and companion service health.
