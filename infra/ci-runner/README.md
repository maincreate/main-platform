# TinkerTunnel organization CI runner (Coolify)

This stack runs one isolated, **persistent-registration** GitHub Actions runner named `tt-ci-linux-01` for the `TinkerTunnel` organization. It is not a TinkerTunnel-managed firmware builder.

## Deploy in Coolify

1. Create a Docker Compose service under **Development Tools** (or Testing) using [compose.yaml](./compose.yaml). Choose a host with x86-64 Linux and at least 4 GB free RAM.
2. In Coolify's environment variables, set **`TT_CI_GITHUB_TOKEN`** to a secret GitHub credential that can manage **organization self-hosted runners** (organization self-hosted runners: read/write). Do not commit the token. Prefer a narrowly scoped GitHub App installation token with short expiry and automated renewal when we implement credential brokering. For an initial bootstrap, a PAT with the necessary organization runner management permission works, but it is more privileged than ideal.
3. In **TinkerTunnel organization → Settings → Actions → Runner groups**, restrict the runner group to `TinkerTunnel/tinkertunnel` only; restrict public-repository use. The Compose `RUNNER_GROUP` setting alone does not enforce repository restrictions.
4. Deploy, check Coolify logs for successful registration, then confirm the runner is **Online** at **Organization → Settings → Actions → Runners**.
5. Once online, switch `.github/workflows/poc-validate.yml` from `ubuntu-latest` to `[self-hosted, tt-ci, linux-x64]`. Before this step, jobs will still use GitHub-hosted runners.

## Constraints and security

- No Docker socket or privileged container. Jobs requiring Docker actions, service containers, or image builds will **not work** in this stack.
- No published ports; the runner connects outbound to GitHub.
- Runner registration persists in the named volume; each job uses a temporary work directory **inside the same container**, which is not security isolation across jobs. For untrusted pull requests, replace with truly one-job disposable runners before enabling public or forked PR workflows.
- This image is third-party and mutable via `:latest`. Pin a reviewed image digest before production use. Verify image user and permissions on the Coolify host if initial registration fails.
- `ACCESS_TOKEN` is passed as an environment variable and should be treated as a high-privilege bootstrap credential. `UNSET_CONFIG_VARS` prevents it from being forwarded to workflow processes by the image entrypoint; it does not remove the secret from Docker container configuration.
- Do not automatically give this runner production Coolify, Proxmox, or TinkerTunnel controller credentials.
- For reproducible CI, run tests on pull requests first, then gate merges with required status checks.

## Initial test workflow

The existing workflow runs Node tests, Go tests/builds and Python packaging checks. It currently targets `ubuntu-latest`, so no runner jobs will start here until `runs-on` is changed.
