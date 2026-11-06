# TinkerTunnel Portal — local-first Docker MVP

The portal runs on your own Docker host. No Cloudflare, external database, SaaS billing or hosted gateway is required. This is a preview: the dashboard and OS-aware framework catalog/planning API work; account login, node enrollment, MCP and installer execution remain disabled.

## Start

Install Docker Engine and Docker Compose v2. From the repository:

```sh
cd portal
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
```

Open **http://127.0.0.1:3000** on the Docker host. Until the portal PR merges, check out branch `feat/docker-portal-foundation` first.

On a different laptop, use an SSH tunnel to the Docker host instead of exposing the HTTP service:

```sh
ssh -L 3000:127.0.0.1:3000 USER@YOUR-DOCKER-HOST
```

Then open **http://127.0.0.1:3000** on the laptop. To change the listening port on the Docker host: `PORTAL_PORT=3100 docker compose up -d --build`, and update the SSH port forwarding accordingly.

```sh
docker compose logs --tail=80
docker compose down
```

One container, no database, no cloud credentials, no paid services. Initial Docker image downloads and optional Git operations require Internet access.

## Current API

- `GET /` — Overview, Connections, Marketplace, Build nodes, Activity UI
- `GET /api/v1/catalog` — curated framework catalog
- `POST /api/v1/plans` — validated OS/architecture-specific read-only install plan
- `GET /healthz` — container health check
- `GET /api/v1/status` — deliberately unconnected preview status
- `GET /mcp` and `/api/v1/install`, `/api/v1/enroll`, `/oauth/...` — fail closed (503)

To run contract tests without Docker on Node 22+:

```sh
node --test *.test.cjs
node server.mjs
```

## Security posture

- Node runs unprivileged in a read-only container with all Linux capabilities dropped.
- No privileged containers, Docker socket mount, host filesystem access or device passthrough.
- Container memory/PID/CPU limits and a small request-body cap.
- HTTP is bound to **host loopback only**, so it isn't LAN/public accessible.
- No authentication exists yet. Do not make the management dashboard accessible over a public reverse proxy or open LAN.
- An SSH tunnel or an existing authenticated VPN is appropriate for remote administration.
- The *MCP endpoint* must remain separate and narrowly authorized. Remote ChatGPT cannot reach a local-only endpoint without an authenticated HTTPS bridge.

## Next milestones

1. Local admin identity, session, CSRF, audit and encrypted persistent state (SQLite in Docker volume).
2. Selected-repository GitHub App authorization with revocation and server-side token storage.
3. Short-lived agent enrollment; outbound-only transport, verified node identity and scoped capabilities.
4. Approved immutable framework recipes per OS/architecture, dry-run diff, explicit approvals and safe rollback.
5. OAuth-protected MCP gateway and optional minimal external rendezvous (only if the remote ChatGPT client needs it).

## Future SaaS (not part of MVP)

Run the same contracts in a thin hosted control plane that stores only identity, authorization, minimal metadata and job pointers. Build outputs, installations, secrets and detailed logs remain on user-controlled machines unless explicitly opted in. Multi-tenant isolation, abuse controls and security reviews are prerequisites for launch.

## Coolify homelab deployment

Use the Git-based **Docker Compose Application** flow (not the Docker Compose Empty service); this portal image needs a Docker build context from the repository. Choose the private repository via the authorized GitHub App or deployment key.

- **Repository:** `TinkerTunnel/tinkertunnel`
- **Branch for current preview:** `feat/docker-portal-foundation`
- **Build strategy:** Docker Compose
- **Base directory:** `/portal`
- **Compose file:** `compose.coolify.yaml` relative to that directory
- **Service:** `portal`, internal HTTP port `3000`
- **Domain:** Leave unset for now. The preview has no authentication.

The Coolify Compose variant maps container port 3000 to **127.0.0.1:13000 on the Docker host**. This prevents unauthenticated access from the LAN or public Internet. Use an SSH tunnel to access it from another computer:

```sh
ssh -L 13000:127.0.0.1:13000 USER@COOLIFY-DOCKER-HOST
```

Open `http://127.0.0.1:13000` on your laptop; test `curl -fsS http://127.0.0.1:13000/healthz` on the Docker host. If 13000 is already taken, set `PORTAL_PORT` in Coolify to an unused host port and update the SSH forwarding accordingly.

Coolify will normally supply its own service/proxy labels. **Do not enable Raw Compose deployment** unless you explicitly maintain the labels and networking yourself. After local authentication is implemented, a trusted private app gateway can route to internal port 3000 using Coolify's domain configuration or a properly protected reverse proxy.

The portal should never receive the host Docker socket. Secure agent enrollment and GitHub authorization will be developed as separate capabilities; do not use shell execution to simulate them.
