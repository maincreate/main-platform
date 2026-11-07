# Workspace topology: first functional version

## Objective

Show a horizontal, UniFi-inspired overview of how cloud services and user-owned machines relate to the local TinkerTunnel workspace. Inspired by a separately supplied clickable design prototype; **do not** import its simulated organizations, machines, job histories, SDK versions, or success badges into production data.

The account-first flow is unchanged. Users create a username/password and immediately reach the Midnight dashboard; no infrastructure configuration is required first. The six-stage diagram lives on its own authenticated **/topology** page, reached through the primary navigation or a compact dashboard link. It is **not shown on the initial dashboard** and is not part of setup.

## Horizontal lanes

1. **Cloud services:** GitHub account identity and optional AI assistant (unconnected unless the backend says otherwise).
2. **Secure access:** external tunnel/connection (currently *not verified*).
3. **MCP gateway:** remote assistant authorization (currently *not connected*).
4. **Workspace:** the logged-in portal/controller, identified by its saved display name.
5. **Build machines:** real enrolled runners from persisted controller state, using OS, architecture and last heartbeat.
6. **Toolkits:** intentionally *not discovered yet* until authenticated runner inventory and validated SDK metadata are available.

Dashed connectors mean **illustrative or unverified relationships**, not observed network traffic. A solid GitHub-to-workspace connector means a GitHub user authorization is valid and an organization installation was selected; it does **not** mean a tunnel or data path is online. A solid connector from workspace to a runner means its authenticated heartbeat was recorded within the last five minutes; it does **not** mean it can perform builds. Expired GitHub authorization remains visibly marked **Reconnect required**, retaining the saved organization as context but never showing the link as connected. Do not infer tunnel connectivity from DNS, installation selection or installed binaries.

## Data contract

Authenticated `GET /api/local/overview` provides:

- `username`, `csrf`, `workspace.name`
- `github.identityConnected`, `github.organization`, `github.integrationVerified`
- `runners.count`, `runners.items[]` containing only `id,name,os,arch,lastSeen`, `runners.truncated`, `runners.executionEnabled=false`
- `assistant.connected=false`
- `topology.secureConnectionVerified=false`, `topology.remoteMcpVerified=false`, `topology.toolkitsDiscovered=false`

The API does not include runner bearer tokens, token hashes, machine IPs, private GitHub keys or unverified detected SDK versions. It limits machine records returned for this summary; the renderer shows a maximum of eight nodes to preserve legibility and reports overflow.

### Current interactions

- The dedicated topology page uses a wider layout than the main dashboard; horizontal scrolling remains available (including keyboard-focusable region) on narrow screens.
- Select an enrolled runner to view its actual OS/architecture and last heartbeat; selecting again or **Clear selection** resets the focus.
- Connection status and topology are refreshed on dashboard page load.
- The existing GitHub card opens the separate post-login authorization screen.
- Palette choice remains browser-local, with Midnight the default.

### Planned follow-up

- Add machine-specific pages and filtered topology edges when runner inventory APIs exist.
- Introduce authenticated toolkit/SDK inventory per runner with detected-versus-validated distinctions.
- Provide structured approval/job state and job lineage before rendering any active-job animation.
- Add server-side verification of tunnel and gateway links before showing solid connections.
- Do not draw fake “online”, “validated” or “connected” states based on sample data.

## Deployment

Assets are packaged in both the root Dockerfile and the portal Dockerfile. The dashboard and topology API require an authenticated administrator session. This view is independent of Docker, Coolify or any particular hosting provider.
