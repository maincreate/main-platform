# Main{Create}

A self-hosted workspace for connecting GitHub, approved development tools and your own build machines. The portal runs independently of your hosting or deployment provider.

## First use

**Initial setup has one step: create your administrator account.**

1. Start the Main{Create} portal using the root `Dockerfile` or a supported container deployment.
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

The initial portal can be started without `MAIN_SERVICE_TOKEN`, `MAIN_MCP_TOKEN` or `MAIN_GITHUB_CLIENT_ID`. Those relate to features connected later.

## Dashboard — subsequent choices

The **dedicated /topology page** includes a horizontal six-lane workspace topology inspired by developer infrastructure maps: cloud services, secure access, MCP, the workspace, build machines and toolkits. Builder nodes use real enrollment/heartbeat metadata; unverified routes stay dashed, and SDK/toolkit inventory isn't fabricated. You can select a machine to inspect its last heartbeat. See [workspace topology](docs/workspace-topology.md).

The dashboard shows actual connection status rather than pretending integrations are already configured:

- **GitHub:** connect your account and choose an organization. Organizations are recommended for sharing runners across repositories. A single repository does not require an organization.
- **Build machines:** enroll trusted Linux, macOS or Windows nodes when you're ready; use **Jobs & Builders** for enrollment, planning, approvals, jobs and artifacts. Runner execution is **disabled by default** until explicitly enabled by the operator.
- **AI assistant (optional):** remote OAuth authorization and ChatGPT connection are future work. A private MCP gateway exists separately; AI is not required for the workspace.

The dashboard defaults to **Midnight**, with **Graphite + Iris** and **Warm Paper** available as alternatives. Each browser remembers its selection.

## Capability Fabric v0.2

The gateway exposes **six stable MCP tools**: `tt_discover`, `tt_inspect`, `tt_plan`, `tt_execute`, `tt_jobs`, and `tt_assets`. These resolve versioned capabilities and workflows from curated JSON manifests rather than adding new MCP tool names per technology. The portal has an authenticated **/jobs** page for machine enrollment, planning, explicit execution approval and artifact downloads.

**The controller does not execute jobs by default.** Live job dispatch requires `MAIN_ENABLE_FABRIC_EXECUTION=1`, machine enrollment and a user-approved plan. ESP-IDF builds additionally require an operator-approved pinned clean local checkout and `MAIN_RUNNER_ENABLE_BUILDS=1` on the machine. Flash, deployment and automatic SDK installation remain unavailable. Existing runner agents must be updated to this version to claim jobs. Remote ChatGPT OAuth is not yet available; the MCP gateway continues to require a private bearer token. See [Capability Fabric v0.2](docs/capability-fabric.md).

## Operational workspace v0.3

After account creation, the **homepage is the workspace's real operational state**, not a repeated setup flow. It shows projects, recent jobs, enrolled builders, connected hardware and pending approvals. The main areas are:

- **Overview** (`/`): builds, repos, builders, attached devices and activity.
- **Projects** (`/projects`): read-only synchronization of the selected GitHub App installation's repository metadata and associated Main{Create} jobs. Synchronization is manual for now.
- **Builders & Jobs** (`/jobs`): machine enrollment, approved plans, logs and artifacts.
- **Devices** (`/devices`): read-only USB inventory reported by trusted builders. Devices are hidden after 7 unseen days, archived after 30 days, and recognized when they return.
- **Topology** (`/topology`): correctly connects GitHub directly to the workspace, and devices to their reporting builder.
- **Settings** (`/settings`): GitHub, optional AI, appearance, account and execution policy.

For the managed **Go Host Service v0.6.0** on Linux ARM64, USB serial discovery is read-only and built in (startup and every 60 seconds); no Python dependency or USB port access is required. `MAIN_HOST_DEVICE_DISCOVERY=0` disables it. The legacy Node runner can still use `MAIN_RUNNER_DEVICE_DISCOVERY=1` with Python + `pyserial` on Linux, macOS, or Windows. Existing builders without this opt-in continue heartbeat and jobs but report no devices. Physical USB access is not automatically available inside containers.

The Devices page now suggests candidate microcontroller families and related SDK versions using sourced `registry/microcontrollers.json` references. USB VID/PID never proves the exact chip; chip verification and artifact compatibility are separate gates. See [device discovery and SDK catalog](docs/device-discovery-and-sdk-catalog.md).\n\n**Manual flashing and Git-triggered build/flash automation are not enabled yet.** A discovered serial port is not sufficient proof of a safe flash target. The future flow is verified image → exact target device → fresh identity/chip check → explicit approval → audited adapter; automation additionally requires an authenticated event source and rule. See [Operational workspace and device-aware release architecture](docs/operational-workspace.md).

## GitHub connection

After account creation, choose **Connect GitHub** on the dashboard. Main{Create} implements an OAuth device flow like HACS: start the connection, open `https://github.com/login/device`, enter the displayed code, approve access, and return to select an organization. Main{Create} encrypts the returned credential at rest. No personal access token or GitHub App private key should be pasted into the onboarding screen.

For a fresh installation, create a **dedicated GitHub App** for Main{Create}, separate from any GitHub App your hosting system uses to deploy the portal. In GitHub App settings, enable **Device Flow**. Keep permissions minimal (repository Metadata read-only is sufficient for initial identity and installation discovery); disable unneeded webhooks and do not enable user authorization during installation solely for this device flow. Install the App on the organization you want to connect.

The public GitHub Client ID for **MainCreate** (`Iv23li3oxxp1wVAadlN4`) is included in the product as the default GitHub identity. After the administrator signs in, open `/github` and choose **Sign in with GitHub**. **End users do not need to create GitHub Apps or enter Client IDs.** A deployment operator can optionally use `MAIN_GITHUB_CLIENT_ID` to override the app identity, or a self-hosting admin can supply a different Client ID on the connection page for a private installation. The Client ID is public; never put a GitHub App private-key PEM into source control or into the OAuth device-authorization form.

Click **Sign in with GitHub**, approve GitHub's device authorization, and select an organization where this particular App is installed. GitHub App user tokens obtain eligible organizations from `GET /user/installations` (not `GET /user/orgs`). If the installation was added after authorization, click **Refresh organizations**. Selecting an organization records the preferred connection; it does **not** grant runner permissions, create runners, or authorize arbitrary repository builds. GitHub App user tokens may expire and require reauthorization until token refresh is implemented.

## Validation and boundaries

```sh
npm test
```

Login behavior can also be checked from a trusted client using `scripts/smoke-login.mjs` (credentials are provided only to the local verification process, never as server login configuration).

This release supports password-based administration, persistent settings, encrypted GitHub credentials, runner enrollment, versioned capability discovery, approval-pending jobs and an opt-in runner execution engine. It **does not** support arbitrary shell execution, automatic SDK installation, firmware flashing, production OAuth-protected ChatGPT access, or unmanaged deployments. Execution is explicitly disabled by default.

For deeper architecture and deployment details, see [architecture](docs/mvp-architecture.md), [portal API](portal/README.md), [appearance choices](docs/design-directions.md) and [a provider-specific deployment example](docs/coolify-deployment.md).

## Main{Create} repository boundaries

This is the management repository for Main{Create}. The controller, portal, MCP gateway, optional tunnel, capability policy, and deployment configuration live here.

- [main-builders](https://github.com/maincreate/main-builders) owns the distributed host service, runner adapters, installer scripts, and OS/architecture targets.
- [main-marketplace](https://github.com/maincreate/main-marketplace) owns the SDK, toolkit, and hardware catalog.
- [main-create](https://github.com/maincreate/main-create) owns the public website.

The deployment build uses checked-in copies of the builder and catalog files recorded in `vendor-lock.json`. This keeps local and Coolify builds independent of GitHub credentials and keeps existing install URLs, configuration, and management API contracts intact.

Update the source repository first. For each entry in the lock, archive the listed paths from its reviewed commit into this checkout. Remove any files deleted in the source, update the pinned revision, commit, and verify with `node scripts/verify-vendor.mjs ../main-builders ../main-marketplace`. Run the platform tests before releasing.

### Upgrading environment configuration

Before deploying this revision, rename configured environment keys with the former `TT_` prefix to `MAIN_`, preserving their values. Apply the change to the controller, MCP gateway, and any separately configured builders or runner services as each component upgrades. Keep the existing data mount. If you use an external master key, preserve its value under `MAIN_MASTER_KEY`. Rollbacks need the environment key names expected by the rolled-back revision.

### Upgrading Compose storage

New Compose projects create `main_data` and `main_runner` volumes. When upgrading a Compose project with existing state, keep its existing volumes attached by mapping them explicitly in Compose or Coolify before redeploying. Mount controller state at `/data` and runner container state at `/var/lib/maincreate`. Standalone Linux Host Service storage is separate from the Compose runner volume.
