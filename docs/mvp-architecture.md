# Main{Create} MVP architecture — secure device gateway + firmware artifacts

Status: Proposed architecture, not yet deployed
Pilot: WaymarkerOS on `waymarker-build-01` (ARM64, USB-connected ESP32-S3 Dial)
Second test node: `waymarker-lab-01` (Main{Create} gateway and distributed-node experiments)

## Product outcome

From ChatGPT, a user can connect a trusted Main{Create} node with a short sign-in/authorization flow, discover allowed capabilities, request a job, and retrieve its status. The same node can build and deploy firmware while storing immutable binary artifacts in Cloudflare R2 rather than GitHub Actions storage. GitHub remains the source/release UI. MVP should work with one self-contained ARM64 node; splitting gateway and execution provider across nodes is a later, separately testable topology.

## Logical topology

```text
ChatGPT MCP client
    |
    | authenticated HTTPS / MCP with explicit scoped tool permissions
    v
Main{Create} control plane (Cloudflare Worker + registry / session state)
    |                           \
    | job routing + audit        \ artifact metadata & signed download mediation
    v                            v
Outbound-only Main{Create} agent   Private R2 Standard bucket
(on Build Pi for all-in-one pilot)    ^    |
    |                                 |    | versioned, checksum-verified downloads
    +--> GitHub Actions self-hosted    +----+
    |      runner: ARM64 build
    +--> local firmware verifier
    +--> ESP32 USB flash provider
    +--> bounded serial logs -> journald -> VictoriaLogs
    |
GitHub repo/actions/releases (source, run status, R2 download links)
```

The agent maintains an outbound authenticated connection or secure polling to the control plane; no inbound port-forwarding is required. Worker-to-agent transport details (polling vs WebSocket, reconnect semantics) are an implementation choice with an explicit delivery/ack contract. Cloudflare R2 is the artifact store, **not** the message bus or capability authorization service.

## MVP components

| Component | Scope |
| --- | --- |
| Cloudflare Worker / control plane | Device enrollment, identity, authorization, allowlisted capability dispatch, job lookup, delivery acknowledgments |
| Agent on Build Pi | Outbound check-in, signed/scope-checked jobs, local execution, status/heartbeat and error reporting |
| Capability providers | `firmware.build`, `firmware.flash`, `firmware.logs`, `artifact.publish`; no arbitrary shell execution |
| GitHub Actions | Automatic build + auto-flash for current WaymarkerOS pilot; record exact commit and successful/failed jobs |
| R2 Standard bucket | Immutable firmware binaries and manifest by project/architecture/commit SHA, checksum and size verification |
| Artifact delivery Worker | Authenticated download/manifest endpoint; future OTA delivery (not implemented in MVP) |
| Retention controller | Lifecycle expiry for dev/beta prefixes; scheduled storage-budget guard; pinned release protection |
| VictoriaLogs | Forward USB serial stream and deployment events via existing journald/rsyslog route; dashboards/query links |
| GitHub UI | Workflow summary with durable R2 links; release notes with external R2 download links |

## Storage key and manifest contract

Use a **private** R2 bucket (proposed `maincreate-artifacts`) and Standard storage class. Names are examples, not deployed URLs.

```text
waymarkeros/dev/esp32s3/<sha40>/manifest.json
waymarkeros/dev/esp32s3/<sha40>/waymarker_dial.bin
waymarkeros/dev/esp32s3/<sha40>/bootloader.bin
waymarkeros/dev/esp32s3/<sha40>/partition-table.bin
waymarkeros/dev/esp32s3/<sha40>/flasher_args.json
waymarkeros/stable/<release-id>/...    # future pinned version
```

Manifest includes `repository`, `commit_sha`, `target`, `flash_layout`, each file's SHA-256 and byte count, `build_id`, creation timestamp and retention class. The upload worker validates each digest, stores content under immutable commit keys, and only marks a manifest as ready after all expected objects exist. Reads revalidate the manifest and object hashes at deployment. Reserve signing of release manifests as an explicit OTA security milestone; SHA-256 alone verifies integrity against the manifest but does not authenticate the firmware author.

Avoid mutable `latest.bin` keys: a mutable channel pointer may reference immutable SHA-qualified versions. Never expose R2 API credentials to the ESP32 or GitHub release notes.

## Storage cost controls

Cloudflare R2 **Standard** has an included 10 GB-month of storage per month, 1 million Class A and 10 million Class B operations monthly, and zero R2 internet egress fees, subject to current pricing; Worker use can incur its own charges. A GB-month is an averaged daily peak measurement, **not** a hard 10 GB capacity ceiling. This policy targets **<=8 GB retained objects** to leave headroom, not an absolute bill-limiting guarantee.

- `dev/`: expire objects after 30 days via native R2 lifecycle rule.
- `beta/`: expire after 90 days via native R2 lifecycle rule (future).
- `stable/` and `pinned/`: no automatic expiry; explicit unpin/retirement only.
- A scheduled retention controller measures actual bytes in the relevant bucket/prefixes, then deletes **oldest unpinned complete dev builds as groups** if above 8 GB (with emergency alert at 9 GB). Never delete an active deployment, a referenced channel target, or the designated known-good rollback build.
- Account for storage and operation counts in telemetry; throttle publishes and alert if approaching allowances. Lifecycle expiration is eventual, not instantaneous; refuse new optional dev uploads if close to a configured safety margin.
- Use lifecycle cleanup for abandoned multipart uploads as applicable. Do not transition automatically to Infrequent Access under the MVP: R2 free tier applies to Standard, and Infrequent Access has different fees.

These are *initial policy defaults*, not currently configured bucket rules.

## Identity and security

- Device enrollment: user signs into control plane (GitHub/OIDC supported later) and completes one-time node enrollment; device has a unique revocable credential.
- ChatGPT connection: register an authenticated MCP endpoint and grant narrow capability scopes; capability calls carry project, exact commit hash, target device, requested action, request ID and audit identity.
- Agent only accepts approved structured commands; no arbitrary commands/SSH, no exposure of Docker socket or broad root sudo.
- Flashing: verify expected ESP32-S3 identity and serial port, preapproved offsets, image hash, and job policy. Keep local USB flashing separate from control-plane credentials.
- Deduplicate by idempotency key; dispatch and flash operations use a per-device exclusive lock; retries cannot unintentionally reflash a different commit.
- Keep Cloudflare credentials on the node uploader/control plane and make download tokens short-lived; redact tokens from logs.
- Protect pinned stable and rollback artifacts from automated deletion.
- For pilot WaymarkerOS, deployment policy is currently auto-flash on successful configured-branch builds. The MVP must not silently broaden that to other devices/projects.

## MVP behavior and user experience

1. Enroll Build Pi as a trusted Main{Create} agent via a guided sign-in/registration experience.
2. Discover `waymarkeros` as a project and the connected `esp32s3` device without exposing host credentials.
3. User/ChatGPT commits to GitHub. Existing self-hosted ARM64 runner automatically compiles and verifies.
4. Build Pi uploads the immutable verified bundle to R2 and records the artifact locator, hash and build status.
5. GitHub Actions appends Markdown download links in `GITHUB_STEP_SUMMARY`; versioned GitHub Releases include the same external links in descriptions. External R2 objects do **not** show up as native GitHub Release assets.
6. Current WaymarkerOS pilot auto-flashes locally following successful build; reports status and bounded serial logs. Other capabilities remain policy gated.
7. User can query Main{Create} for build/flash/connected-device status and open VictoriaLogs for near-real-time serial interactions.
8. Future ESP32 HTTPS OTA can read authenticated immutable artifacts + channel manifest; requires OTA partition changes, firmware signature validation, health checks and rollback before enabling OTA deployment.

## MVP acceptance criteria

- One ARM64 node enrolls and remains available via outbound connection without router port forwards.
- MCP client can list permitted capabilities, request a structured operation and retrieve precise final status; no arbitrary shell execution.
- GitHub push compiles WaymarkerOS, uploads manifest + binaries to private R2, and shows links in job summary; matching hashes can be downloaded and independently checked.
- Automatic USB flash reports successful image checks and device-reported boot; no duplicate simultaneous flash jobs.
- Serial data is forwarded to VictoriaLogs with device identity, UTC event time and log source; a live query can show new interactions with a small ingestion delay. Serial reader releases port while flashing and reconnects afterward.
- Development build expirations work, pinned releases survive, and storage budget controller preserves the known-good rollback.
- Errors (offline node, expired authorization, upload failure, wrong chip, full storage budget) are visible with actionable status and cannot be reported as a successful flash.

## Build order

**M0:** Preserve current working GitHub runner/USB flow; add persistent serial-to-journald monitor and prove VictoriaLogs ingestion.

**M1:** Create R2 Standard bucket, strict uploader credentials, manifest format and immutable uploads. Add job summary links; retain GitHub artifact upload as fallback until checksum/download validation succeeds.

**M2:** Configure 30-day dev lifecycle and an 8 GB headroom controller; pin rollback/stable releases. Then disable GitHub binary artifact upload and confirm external links work.

**M3:** Deploy Main{Create} control plane + single Build Pi agent; implement secure enrollment, discovery, `job.submit` and `job.status` with explicit policy.

**M4:** Repurpose Lab Pi as a second Main{Create} node and prove routing from gateway to a different ARM64 executor. Only then generalize to other architectures.

**M5 (not MVP):** OTA partition scheme, signed firmware release manifests, HTTPS OTA, boot health validation and rollback; optional per-project automatic OTA policy.

## Non-goals

No multi-tenant billing/subscriptions, generic remote shell, unattended arbitrary firmware flashing, multi-architecture build farm, customer-facing OTA fleet management, or enforced hard 10 GB billing cap in MVP.

## References

- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- https://developers.cloudflare.com/r2/get-started/
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary
