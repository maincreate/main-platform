# TinkerTunnel portal and controller

## Account-first onboarding

The same first-use experience applies to any supported deployment: visiting the portal without an administrator redirects to `/setup`, which shows **only** username, password and confirmation. Successful creation establishes an authenticated session and opens `/`, the dashboard. Existing users see a sign-in form.

The instance's default display name is **TinkerTunnel**, not “TinkerTunnel Local”. Host topology, GitHub, runner enrollment and other settings are not part of creating the first user.

The dashboard shows the actual status of GitHub identity/organization selection, enrolled build machines and assistant availability. Identity and account password management are in the account menu, not the first-use wizard.

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
- GitHub OAuth device authorization requires an application configured with device flow and its public client ID supplied through `TT_GITHUB_CLIENT_ID`. Tokens are encrypted at rest; selecting an organization does not grant runner permissions or install a GitHub App.
- Local MCP is bearer authenticated, read-only, and separate. Remote ChatGPT OAuth, build execution, installation and flashing are not active.
- The full catalog/preview route implementation remains inside `worker.js`; it is not the default authenticated first-run experience.

## Design

The static portal uses CSS variables and simple accessible HTML, with no runtime UI framework dependency. Three palettes can be previewed on the dashboard. See [design directions](../docs/design-directions.md) before choosing a more comprehensive component system.
