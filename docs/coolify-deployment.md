# Coolify deployment webhook

Main{Create}'s platform application is deployed by Coolify from `maincreate/main-platform` on the `main` branch.

## Commit-to-deployment path

1. GitHub sends a signed `push` webhook to `https://hooks.ayusohaylock.com/webhooks/source/github/events`.
2. Cloudflare terminates public HTTPS and blocks methods/paths other than the webhook POST.
3. The existing Caddy HA gateways forward the exact webhook route to the private **Coolify management** service.
4. Coolify validates the webhook and matches the GitHub App, repository, and branch before queueing a deployment.
5. Coolify builds and deploys the application on its configured worker.

The public hostname must not proxy the Coolify dashboard, general APIs, or worker management endpoints. Caddy and the origin should independently enforce this restriction; edge WAF rules alone are not origin access control.

## Separate build-runner path

Project builds and device firmware compilation use GitHub Actions self-hosted runners with outbound connections to GitHub. They do not need the Coolify deployment webhook. Device flashing remains a separately authorized Main{Create} operation.

## Verification checklist

- The GitHub App delivers a signed `push` for `main` and receives a successful non-no-op response.
- Coolify records the matching deployment with `Webhook` as its source.
- The deployment completes successfully and the existing application remains healthy.
- `GET` to the webhook path and requests to other paths on the public hostname remain blocked.

## Deploy-trigger behavior

Coolify intentionally ignores push webhooks when every commit in the push includes `[skip ci]` or `[skip cd]` in its commit message. To validate automatic deployments, use a commit without a skip marker. GitHub Actions and Coolify deployments are separate systems even when both observe the same push.
