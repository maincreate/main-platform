# TinkerTunnel

**Connect your AI. Build something real.**

TinkerTunnel is an open-source project connecting AI assistants to makers' code, build environments, and physical devices.

> **Early development:** Currently only a minimal local read-only MCP server over stdio exists. No remote tunnel, GitHub auth, hardware access, portal, or OTA yet. Do not expose this server to the internet.

## Quick start

Requires Go 1.23+.

```sh
go test ./...
go build -o tinkertunnel ./cmd/tinkertunnel
```

Launch the binary as a local MCP stdio subprocess in a compatible client. It supports `system_status` (local-process health only) and `capabilities_list` (registered tools).

See [architecture](docs/architecture.md) and [security policy](SECURITY.md).

## Principles

- Run on existing affordable hardware without a mandatory SaaS account.
- Use interoperable MCP with scoped authorization.
- Treat checked-out code and agent-generated instructions as untrusted.
- Keep signing keys and credentials away from untrusted builds.
- Validate execution outcomes with evidence rather than agent assertions.

## Planned

Authenticated remote MCP, optional outbound managed relay, GitHub project integration, paired runners, board discovery, firmware builds and flashing, execution lineage, and signed OTA via GitHub Releases.

Contributions will be opened once maintainer policies are finalized.
