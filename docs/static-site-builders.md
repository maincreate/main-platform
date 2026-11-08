# Website builders and publishing targets — planned

**Status:** roadmap/capability registry only. Neither site builds nor publishes are executable through the current TinkerTunnel Host Service. Tracking: [issue #31](https://github.com/TinkerTunnel/tinkertunnel/issues/31).

## The critical separation

A **builder** is any enrolled, compatible machine. A **website build profile** specifies an approved toolchain and versioned build recipe. A **publishing target** is where verified output is delivered. There is no reason to provision a dedicated GitHub-hosted Actions runner merely to compile a static website.

```text
GitHub repository @ exact commit SHA
       │
       ▼
TinkerTunnel controller (requirements and policy)
       │
       ├── Linux ARM64 Pi [small site/toolchain workloads]
       ├── Linux x64 VM [default/heavier Node builds]
       ├── macOS ARM64/x64 [when the toolchain needs macOS]
       └── Windows x64 [when Windows-only tools are required]
       │
       ▼
Pinned build adapter → verified static output → immutable artifact
       │
       ▼
TinkerTunnel controller (provider credential; scope and audit)
       ├── GitHub Pages branch/path → GitHub Pages hosting
       ├── Cloudflare Workers Static Assets/Pages
       └── Later: S3-compatible bucket, Netlify, self-hosted static server
```

## Build-host profile compatibility

| Host | Typical static-site workload | Requirements |
| --- | --- | --- |
| Linux ARM64 — Raspberry Pi 5 | Hugo, MkDocs, smaller Vite/Astro/Node sites | Verified generator/runtime, RAM and disk headroom; native arm64 dependencies |
| Linux x64 — Proxmox VM | Larger Node apps, Astro/Vite/Docusaurus, headless/browser build tooling | Verified tool versions, isolated build workspace and resource budget |
| macOS x64/arm64 | macOS-specific web toolchains or scripts | Native macOS requirement from project, not assumed for ordinary websites |
| Windows x64 | Windows-specific tooling and build dependencies | Native Windows requirement from project, not assumed for ordinary websites |

Do not equate “Linux host online” with “compatible”: it must report every required tool at a version satisfying the project's manifest and a working runner.

## Initial adapter boundaries

- **Source:** selected connected GitHub repository, branch policy and immutable source SHA.
- **Builder:** choose an online, scoped managed runner with verified OS/architecture and tool versions; no arbitrary SSH/shell execution capability.
- **Recipe:** reviewed, pinned commands for supported frameworks; controlled dependencies, isolated workspace, no unbounded execution or credential injection.
- **Output:** validated relative directory, size/file-count limits, content hashes, artifact manifest and build logs. Reject server-only projects without a supported static-export workflow.
- **Publish:** controller-only provider credentials and exact allowlisted destination. GitHub Pages publishing should update only the chosen publishing branch/path with validated files; GitHub Pages handles serving them. For Cloudflare, use the configured Workers Static Assets or Pages API. Existing site state and branch history must remain recoverable.
- **Validation:** target endpoint health, provenance of artifact to source SHA, optional screenshot/browser UAT, failure notices and manual rollback.
- **Triggers:** manual initially, then authenticated push webhook on selected branches. Triggering a build is not blanket permission to overwrite every environment.

## Proposed capability IDs

All four are currently **unavailable**, discoverable for planning only:

- `web.static.build`
- `web.static.publish.github_pages`
- `web.static.publish.cloudflare`
- `workflow.web.static_build_publish`

## First dogfood acceptance test

Build the TinkerTunnel marketing/docs repository `TinkerTunnel/tinkertunnel.github.io` on a TinkerTunnel-managed Linux build host, publish to its existing Cloudflare-hosted `tinkertunnel.com` destination, and check the live response and source/artifact revisions. This is **not currently automatic**: the Cloudflare Worker website snapshot is deployed separately from GitHub pushes. A separate test covers GitHub Pages' publishing branch/path. GitHub Pages may perform its own hosting deployment even if a TinkerTunnel host generated the files, but it must not require a GitHub-hosted runner for the build.
