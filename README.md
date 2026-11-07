# TinkerTunnel Local

Self-hosted orchestration for curated development toolchains, approved jobs and platform-specific action runners. This repository is the **local product**, not the future hosted SaaS.

## Deploy from the repository root

The root [`compose.yaml`](compose.yaml) is the canonical deployment entry point. Do not configure a `/portal` base directory.

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:13000/healthz
```

The initial container serves the **portal/API preview only** (read-only framework catalog and installation plans). Authentication, a real controller, MCP, tunnel and action runners are **not implemented yet**. They must not be presented as functioning or exposed publicly.

### Coolify Git-based Application

- **Repository:** `TinkerTunnel/tinkertunnel`
- **Branch:** `main`
- **Build Pack:** **Docker Compose**, not Railpack
- **Base Directory:** `/` (repository root)
- **Docker Compose Location:** `compose.yaml` (at root)
- **Public domain:** None while the UI is unauthenticated

The service binds container port 3000 to `127.0.0.1:13000` on the Docker host by default. From a remote workstation, use `ssh -L 13000:127.0.0.1:13000 USER@COOLIFY-HOST` and open `http://127.0.0.1:13000`.

### Deployment roles (target design)

The same repository and root deployment entry point will support these roles:

- **All-in-one:** Controller + Web + MCP Gateway + tunnel adapter (optional) + an isolated local runner; additional remote runners permitted.
- **Management:** Controller + Web (no local runner).
- **Infrastructure:** MCP Gateway + tunnel adapter.
- **Runner:** Independently installed OS-specific agent on Linux, macOS or Windows.

These roles are **architectural plans**, not currently enabled Compose profiles. Split deployments may use profiles or root-level Compose overrides when implemented; **no base-directory change is needed**.

See [portal/README.md](portal/README.md) for the current preview API, access restrictions and roadmap.
