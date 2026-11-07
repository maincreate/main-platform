# TinkerTunnel Local — web portal/API preview

This component is part of the **self-hosted TinkerTunnel product**, not a separately deployed SaaS product. Its Docker build context is `portal/`, but operators deploy **from the repository root** via [../compose.yaml](../compose.yaml).

## Run

From the repository root:

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:13000/healthz
```

For Coolify, use the Git-backed Docker Compose Application, repository `TinkerTunnel/tinkertunnel`, branch `main`, **Base Directory `/`**, **Compose Location `compose.yaml`**. Do not use Railpack. Do not set a public domain until authentication is implemented.

The service binds `127.0.0.1:13000` on the **Docker host**. For access from a laptop:

```sh
ssh -L 13000:127.0.0.1:13000 USER@COOLIFY-DOCKER-HOST
```

Then open `http://127.0.0.1:13000`. If that host port is already used, set `PORTAL_PORT` and adjust the tunnel. The older `portal/compose.coolify.yaml` is retained for compatibility but is **not the canonical deployment configuration**.

## Implemented preview endpoints

- `GET /` — dashboard preview: Overview, Connections, Marketplace, Build nodes and Activity
- `GET /healthz` — container health check
- `GET /api/v1/status` — deliberately unconnected preview status
- `GET /api/v1/catalog` — curated framework catalog
- `POST /api/v1/plans` — read-only OS/architecture-aware install plan
- `GET /mcp`, `/api/v1/install`, `/api/v1/enroll` and `/oauth/...` — intentionally disabled (503)

Run source contract tests on Node 22+:

```sh
cd portal
node --test *.test.cjs
```

## Security and deployment roles

The current Node container is unprivileged, read-only, resource limited, and does not mount the Docker socket or host filesystem. The unauthenticated portal is accessible only through the Docker-host loopback binding unless an operator changes it. **Do not publish it on a LAN or public reverse proxy yet.**

The product's eventual logical roles are Controller + Web, MCP Gateway + optional tunnel, and isolated action runners. **All-in-one** packages these on one host; **Management + infrastructure** separates controller/web, gateway/tunnel and runners onto different hosts. No runner can execute arbitrary shell actions; only approved and policy-scoped recipes are allowed.

The current build contains **only this portal/API preview**. Real identity, encrypted local secrets, GitHub App integration, agent enrollment, runner execution, OAuth-protected MCP and tunnel connectivity remain to be built.

When available, R2 artifact publishing will be optional: the Controller stores protected credentials, provides a short-lived scoped upload URL, and the runner uploads its artifact without receiving permanent R2 secrets.

## Future SaaS

Future hosted SaaS belongs in a **different repository**. This repository remains the local distribution.
