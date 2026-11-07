# TinkerTunnel

A self-hosted workspace for connecting GitHub, approved development tools and your own build machines. The portal runs independently of your hosting or deployment provider.

## First use

**Initial setup has one step: create your administrator account.**

1. Start the TinkerTunnel portal using the root `Dockerfile` or a supported container deployment.
2. Open the portal. If no administrator exists, it takes you to `/setup`.
3. Create a username and password (at least 12 characters).
4. You're signed in and redirected immediately to **the dashboard**. GitHub, runners and assistant integration can be connected later.

No environment-provided administrator token, one-time setup code, workspace role or GitHub credentials are needed to create the account. Further registration closes once the first administrator is saved. After that, `/setup` is a simple sign-in form.

**Protect first use:** the first person who reaches an unclaimed instance can register. Keep it on a trusted private network or behind an identity-protecting reverse proxy until the administrator exists. The application is not ready for unrestricted public exposure.

## Deploy the portal

The root `Dockerfile` builds the portal/controller and listens on port `3000`. It needs a **persistent, writable** `/data` volume owned or writable by the Node user (UID 1000). It stores the password hash and a generated encryption key. Back this volume up.

```sh
docker build -t tinkertunnel .
docker volume create tinkertunnel-data
docker run --rm --name tinkertunnel -p 127.0.0.1:13000:3000 \
  -v tinkertunnel-data:/data tinkertunnel
```

If your Docker platform creates the volume with root ownership, set ownership on an empty volume before first launch; do not run the portal as root. For a fresh named volume, Docker may initialize the volume from the image's writable `/data` directory.

Open `http://127.0.0.1:13000/setup` from the host, or use a trusted SSH forwarding/private HTTPS route from another machine. Use your own container management system or the optional repository-root `compose.yaml`; **the user-facing account flow is identical regardless of hosting provider**.

The initial portal can be started without `TT_SERVICE_TOKEN`, `TT_MCP_TOKEN` or `TT_GITHUB_CLIENT_ID`. Those relate to features connected later.

## Dashboard — subsequent choices

The dashboard shows actual connection status rather than pretending integrations are already configured:

- **GitHub:** connect your account and choose an organization. Organizations are recommended for sharing runners across repositories. A single repository does not require an organization.
- **Build machines:** enroll trusted Linux, macOS or Windows nodes when you're ready; existing foundation agents provide enrollment and heartbeat, **not job execution**.
- **AI assistant:** remote OAuth authorization and ChatGPT connection are future work. A local read-only MCP gateway exists separately.

The dashboard offers three visual palettes: **Graphite + Iris**, **Warm Paper**, and **Midnight**, with a choice saved per browser.

## GitHub connection

After account creation, choose **Connect GitHub** on the dashboard. TinkerTunnel implements an OAuth device flow like HACS: start the connection, open `https://github.com/login/device`, enter the displayed code, approve access, and return to select an organization. TinkerTunnel encrypts the returned credential at rest. No personal access token or GitHub App private key should be pasted into the onboarding screen.

A GitHub App or OAuth App **with device flow enabled** and a public client ID must first be configured by the TinkerTunnel distributor/operator through `TT_GITHUB_CLIENT_ID`. Until then, the portal clearly reports GitHub connection as unavailable. The client ID is an application identifier, not an administrator password.

Selecting an organization does **not** install GitHub Apps, grant runner access, or create organization-level runners. Verified installation, permissions, runner group policy and multi-repository execution remain later milestones. Do not reuse a deployment-system GitHub App as the identity provider.

## Validation and boundaries

```sh
npm test
```

Login behavior can also be checked from a trusted client using `scripts/smoke-login.mjs` (credentials are provided only to the local verification process, never as server login configuration).

This foundation supports password-based administration, password changes, persistent settings, encrypted GitHub credentials, one-time runner enrollment and a read-only MCP gateway. It **does not** support arbitrary command execution, installation, firmware flashing, production OAuth-protected ChatGPT access, or live automated runner jobs. Do not enable those actions without explicit capability policies and authentication.

For deeper architecture and deployment details, see [architecture](docs/mvp-architecture.md), [portal API](portal/README.md), [appearance choices](docs/design-directions.md) and [a provider-specific deployment example](docs/coolify-deployment.md).
