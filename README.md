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

The dashboard includes a horizontal six-lane workspace topology inspired by developer infrastructure maps: cloud services, secure access, MCP, the workspace, build machines and toolkits. Builder nodes use real enrollment/heartbeat metadata; unverified routes stay dashed, and SDK/toolkit inventory isn't fabricated. You can select a machine to inspect its last heartbeat. See [workspace topology](docs/workspace-topology.md).

The dashboard shows actual connection status rather than pretending integrations are already configured:

- **GitHub:** connect your account and choose an organization. Organizations are recommended for sharing runners across repositories. A single repository does not require an organization.
- **Build machines:** enroll trusted Linux, macOS or Windows nodes when you're ready; existing foundation agents provide enrollment and heartbeat, **not job execution**.
- **AI assistant:** remote OAuth authorization and ChatGPT connection are future work. A local read-only MCP gateway exists separately.

The dashboard defaults to **Midnight**, with **Graphite + Iris** and **Warm Paper** available as alternatives. Each browser remembers its selection.

## GitHub connection

After account creation, choose **Connect GitHub** on the dashboard. TinkerTunnel implements an OAuth device flow like HACS: start the connection, open `https://github.com/login/device`, enter the displayed code, approve access, and return to select an organization. TinkerTunnel encrypts the returned credential at rest. No personal access token or GitHub App private key should be pasted into the onboarding screen.

For a fresh installation, create a **dedicated GitHub App** for TinkerTunnel, separate from any GitHub App your hosting system uses to deploy the portal. In GitHub App settings, enable **Device Flow**. Keep permissions minimal (repository Metadata read-only is sufficient for initial identity and installation discovery); disable unneeded webhooks and do not enable user authorization during installation solely for this device flow. Install the App on the organization you want to connect.

The public GitHub Client ID for **TinkerTunnel Connect** (`Iv23liAxFGcez9en0tY8`) is included in the product as the default GitHub identity. After the administrator signs in, open `/github` and choose **Sign in with GitHub**. **End users do not need to create GitHub Apps or enter Client IDs.** A deployment operator can optionally use `TT_GITHUB_CLIENT_ID` to override the app identity, or a self-hosting admin can supply a different Client ID on the connection page for a private installation. The Client ID is public; never put a GitHub App private-key PEM into source control or into the OAuth device-authorization form.

Click **Sign in with GitHub**, approve GitHub's device authorization, and select an organization where this particular App is installed. GitHub App user tokens obtain eligible organizations from `GET /user/installations` (not `GET /user/orgs`). If the installation was added after authorization, click **Refresh organizations**. Selecting an organization records the preferred connection; it does **not** grant runner permissions, create runners, or authorize arbitrary repository builds. GitHub App user tokens may expire and require reauthorization until token refresh is implemented.

## Validation and boundaries

```sh
npm test
```

Login behavior can also be checked from a trusted client using `scripts/smoke-login.mjs` (credentials are provided only to the local verification process, never as server login configuration).

This foundation supports password-based administration, password changes, persistent settings, encrypted GitHub credentials, one-time runner enrollment and a read-only MCP gateway. It **does not** support arbitrary command execution, installation, firmware flashing, production OAuth-protected ChatGPT access, or live automated runner jobs. Do not enable those actions without explicit capability policies and authentication.

For deeper architecture and deployment details, see [architecture](docs/mvp-architecture.md), [portal API](portal/README.md), [appearance choices](docs/design-directions.md) and [a provider-specific deployment example](docs/coolify-deployment.md).
