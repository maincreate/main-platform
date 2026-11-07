# TinkerTunnel Local

Self-hosted development infrastructure: web/controller, authenticated MCP gateway, optional Cloudflare Tunnel connector, and OS-specific action runners. The future **SaaS lives in a separate repository**.

This repository is deployed from its **root**: `compose.yaml`. The `portal/`, `controller/`, `gateway/` and `runner/` folders are components, not deployment roots.

## Foundation release: what works

- Responsive web portal with a protected five-step setup wizard at `/setup`
- Durable local instance preferences in a Docker volume
- GitHub App configuration with AES-256-GCM-encrypted private key, explicit live installation verification and repository access check
- Single-use 10-minute runner invitations, hashed runner credentials and heartbeat registry
- Standalone Streamable HTTP MCP gateway (bearer-authenticated) with four **read-only** tools: status, runner list, framework catalog and dry-run install plan
- Optional Cloudflare Tunnel **connector container**, with separate gateway-only network route

**Not yet implemented:** ChatGPT-compatible OAuth authorization, installer/job execution, firmware flashing, artifact publishing, automatic GitHub triggers, live tunnel connectivity verification, or ability to switch deployed Compose roles from the portal. The onboarding role selector currently records intent; it does **not** reconfigure running containers.

## Install locally

**User accounts are created entirely in the web portal.** No `TT_ADMIN_TOKEN` or password environment variable is used. A persistent `/data` volume stores the administrator's salted password hash and the locally generated 32-byte encryption key (both with restrictive permissions). Back up the volume: deleting it deletes the account and any encrypted GitHub App credentials.

Only the separate MCP gateway uses machine-to-machine secrets; configure these **later** if deploying the gateway:

```sh
openssl rand -hex 32    # TT_SERVICE_TOKEN (controller ↔ gateway)
openssl rand -hex 32    # TT_MCP_TOKEN (MCP client authentication)
```

The optional legacy `TT_MASTER_KEY` is supported for migrations of existing encrypted state, but is not needed for fresh installations. Then deploy:

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:13000/healthz
curl -fsS http://127.0.0.1:13001/healthz
```

The portal is at `http://127.0.0.1:13000/setup` **on the Docker host**. When using a workstation, SSH-forward it:

```sh
ssh -L 13000:127.0.0.1:13000 -L 13001:127.0.0.1:13001 USER@DOCKER-HOST
```

Then visit `http://127.0.0.1:13000/setup`. On first boot, create an administrator username and a strong password (12+ characters) directly in the web portal. No setup code is needed. Once the first administrator exists, further registration is disabled. Subsequent visits use the username/password sign-in form. **Important:** whoever reaches an unclaimed instance first can register, so keep the service on a trusted private network or behind Cloudflare Access during initial setup.

### Coolify deployment: portal-first login milestone

Deploy the **portal/controller only** before enabling MCP or runners. This is deliberately a smaller, safer release than the entire Compose stack:

- **Git repository:** `TinkerTunnel/tinkertunnel`; **branch:** `main` once merged
- **Build Pack:** **Dockerfile**, with build context at the repository root `/` and Dockerfile path `/Dockerfile` (not a shell-based default image)
- **Container port:** `3000`, and expected CMD `node portal/server.mjs`
- **Environment:** `TT_REQUIRE_LOGIN=1`, `TT_DATA_DIR=/data`, `HOST=0.0.0.0`, `PORT=3000`. No `TT_ADMIN_TOKEN` or user password is required. Machine-to-machine gateway tokens are optional at this milestone.
- **Persistent storage:** mount a durable, node-writable volume at `/data`, with permissions for UID 1000. Back up this volume: `/data/master.key` is generated once, must persist, and encrypts stored GitHub App credentials.
- **Reachability:** use only private/VPN access or a properly authenticated Cloudflare Access hostname. Do **not** expose the bare administration portal to the public Internet just because it has a token login.
- **Readiness:** `GET /healthz` must respond 200; anonymous `GET /` redirects to `/setup`; `POST /api/local/login` validates the admin token and grants an HttpOnly session; authenticated `GET /` serves the dashboard.

The original deployment did not have a usable start command and repeatedly exited when its entrypoint invoked `/bin/bash`. Switching to the repository's root Dockerfile fixes that configuration only when Coolify is actually set to build using Dockerfile. The administrator account and encryption key must be writable and persistent under `/data`.

For an end-to-end login check **after deployment**, run from a trusted computer with HTTPS access (or from the Docker host using localhost):

```sh
TT_PORTAL_URL="https://your-private-portal-host" TT_LOGIN_USERNAME="$TT_LOGIN_USERNAME" TT_LOGIN_PASSWORD="$TT_LOGIN_PASSWORD" node scripts/smoke-login.mjs
```

The script verifies health, setup page, anonymous redirect, real session login, authenticated dashboard and logout. It refuses non-loopback plain HTTP and never logs your token. The test-only `TT_LOGIN_USERNAME` and `TT_LOGIN_PASSWORD` are local client process inputs, **not server login configuration**. Do not put them in shell history or project files. The application must be configured in Coolify before the GitHub webhook can deploy it correctly.

**Later, full-stack deployment:** use the root `compose.yaml` to run portal and a separate bearer-protected MCP gateway. The optional `tunnel` and `runner` profiles remain disabled in this login milestone. No remote ChatGPT OAuth or device flashing is active.

## GitHub App integration

Create/install a GitHub App with only the repository permissions needed for intended workflows; grant access to explicit repositories. On the setup page supply its App ID, Installation ID, allowed `owner/repo`, and RSA private key. Select **Verify against GitHub**. This contacts GitHub using an App JWT and a short-lived installation access token and verifies repository visibility. Status remains **unverified** on failure.

This GitHub App belongs to TinkerTunnel product features. It is separate from Coolify's source/redeployment GitHub App.

## MCP gateway

Default private endpoint: `http://127.0.0.1:13001/mcp`. The gateway rejects missing or invalid bearer tokens. Test a read-only `tools/list` request on the Docker host:

```sh
curl -sS http://127.0.0.1:13001/mcp \
  -H "Authorization: Bearer $TT_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

This is a working bearer-protected MCP transport for compatible clients. **Remote ChatGPT integration is not yet enabled**: an OAuth-protected remote MCP connection needs to be implemented and tested before publishing the endpoint. It has no tools for arbitrary shell, device flashing or installing.

## Optional tunnel

Cloudflare remotely managed tunnel: create a tunnel in the Cloudflare dashboard, configure a hostname to target `http://gateway:3001` on the Compose network, and put its **connector token** in `TT_TUNNEL_TOKEN` in Coolify (never Git). Enable only after external authentication is ready:

```sh
docker compose --profile tunnel up -d tunnel
```

Tunnel connectivity and TLS are verified in Cloudflare, **not inferred from a saved hostname**. Never configure a public origin route to `portal:3000`.

## Runner enrollment

The setup wizard issues a **single-use invitation token**, valid for ten minutes. For a runner outside Docker, clone the private repository on a trusted machine with Node 22+ and an authorized HTTPS route to the controller. In a terminal on that machine:

```sh
TT_CONTROLLER_URL="https://your-private-controller" TT_ENROLLMENT_TOKEN="ONE_TIME_TOKEN" node runner/agent.mjs enroll
TT_CONTROLLER_URL="https://your-private-controller" node runner/agent.mjs run
```

The controller must be reachable privately; the default Docker-host loopback binding will not accept remote runner traffic. Do not put the enrollment token in source control, CI logs or shared chat history.

For the optional **on-host** Docker runner, generate an invitation with controller URL `http://portal:3000` in the wizard and use:

```sh
docker compose --profile runner run --rm -e TT_ENROLLMENT_TOKEN="ONE_TIME_TOKEN" runner node agent.mjs enroll
docker compose --profile runner up -d runner
```

The agent currently registers identity and sends heartbeats; it intentionally **cannot run build jobs** yet. A Linux runner, macOS Xcode runner and Windows runner share the same enrollment contract, but device/toolchain permissions and platform-specific installers remain future work. For Windows, protect the runner token file using NTFS access controls; Unix file mode alone does not apply.

## Tests

```sh
node --test portal/*.test.cjs controller/*.test.mjs
```

No GitHub Actions dependency is required for local tests.

## Deployment roles

The target distribution supports **All-in-one** (portal, MCP gateway, optional tunnel, local runner, plus remote runners) and **Management + infrastructure** (separate management/controller, MCP gateway+tunnel, and all runners remote). Role selection is represented in configuration now; independently deployable topology and secure cross-machine controller connectivity are not yet shipped. The root `compose.yaml` remains the entry point in every mode.

See [portal/README.md](portal/README.md) for endpoint and trust details.
