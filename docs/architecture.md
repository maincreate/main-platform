# TinkerTunnel architecture

## Planned components (not yet implemented)

- Core: MCP/API, authorization, project records and execution lineage.
- Connect: optional managed HTTPS MCP ingress with secure outbound relay.
- Runner: isolated build, test, flash and verification on local or paired devices.
- Portal: setup, project/workflow views, approvals and credentials configuration.
- OTA: artifact metadata, signed manifests, GitHub Releases and device-native update/rollback.

## Deployment patterns

1. All-in-one laptop or low-power computer.
2. Distributed Core and paired capability-advertising runners.
3. Managed Connect relay with private runners, without port forwarding.
4. Local-only or bring-your-own HTTPS endpoint, independent of managed hosting.

## Security boundaries

MCP authentication is not administrative authorization. Remote authentication, runner pairing, and hardware action approvals must be implemented before publishing write tools. Project code is untrusted. Builders get restricted workspaces and no inherited credential access. Artifacts should be content addressed and associated with an exact Git SHA, target, and verified build metadata.

Managed relay ingress can inspect MCP traffic unless additional application-level encryption exists. Never describe it as end-to-end encrypted without that design.

## Executable first slice

Go standard-library, local stdio MCP with two read-only tools. No network listener, filesystem mutations, compilation, flashing, or secret handling yet.
