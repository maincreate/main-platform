# TinkerTunnel

Local-first AI development orchestration platform.

## Portal preview

The portal lives in [portal/](portal/README.md). It provides a dashboard, framework catalog, OS-aware dry-run installation plans and a private Docker deployment. It does not yet support GitHub OAuth, secure agent enrollment, write-enabled MCP or actual installations.

To run locally:

```sh
cd portal
docker compose up -d --build
curl -fsS http://127.0.0.1:3000/healthz
```

**Coolify:** Use Git-based **Docker Compose**, base directory `/portal`, Compose location `compose.coolify.yaml`, internal service port 3000. On the feature branch use `feat/docker-portal-foundation`; on merge use `main`. Railpack on repository root is not the portal build strategy.

Keep the management portal private until authentication exists. [Full deployment instructions](portal/README.md).
