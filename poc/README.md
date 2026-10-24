# TinkerTunnel POC

This proof of concept checks the artifact packaging contract in GitHub Actions after a commit. Its sample binary is fake and must never be flashed.

Target flow: conversation, GitHub commit, build on Build Pi, publish versioned firmware artifacts, verify and flash via HomeCloud Fabric on Lab Pi.

The Build Pi still needs a GitHub event-driven runner and complete WaymarkerOS source. The current Fabric build service does not fetch missing commits.
