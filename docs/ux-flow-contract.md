# UX flows as a documentation contract

The product's canonical user journeys live in [`registry/ux-flows.json`](../registry/ux-flows.json), independent of UI component markup.

**Why:** Support writers, the marketing/documentation website, the portal, and ChatGPT should not have to reverse engineer stage order, success evidence, recovery paths or feature availability from JavaScript.

## Update a user journey

1. Update the matching entry in `registry/ux-flows.json`. Keep the stable `id` and stage IDs; increment `version` when changing the contract.
2. Update the actual portal/controller behavior. The manifest **documents** behavior; it does not execute or grant access to operations.
3. Run `npm run docs:generate` to regenerate `docs/support/<flow-id>.md`.
4. Commit the manifest, generated support pages, implementation, and tests together. `npm run docs:check` and `npm test` run in CI. The documentation check rejects generated pages that have drifted.
5. For new flows, add the entry with `status: planned` until users can actually complete it end-to-end. Move to `pilot` for partially validated experiences and `implemented` after operational verification.

## Stable flow fields

| Field | Intended use |
| --- | --- |
| `id` and `steps[].id` | Durable analytics, support links, UI status mapping |
| `status` | Product availability (implemented / pilot / planned); not inferred from UI visibility |
| `route`, `entry` | Where a user begins |
| `steps[].userAction` | Human-facing action / instruction |
| `steps[].success` | Evidence required to advance; avoid treating a queued action as completed |
| `steps[].failure` | Failure states that must be communicated |
| `steps[].recovery` | Support instructions after failure |
| `paths.success`, `paths.resume` | Where to go on success and how to recover a closed modal |
| `limitations` | Known capability and validation boundaries |

Avoid storing passwords, access tokens, machine IP addresses, private project names, or credentials in the flow contract.

## Documentation website integration

An authenticated portal endpoint, `GET /api/local/ux-flows`, returns the versioned contract. It is intended for first-party portal help and authorized integrations; **do not proxy this admin API publicly**.

For a separate public documentation website, consume the **generated Markdown** from `docs/support/` at build time, or compile a sanitized static JSON export from the same manifest. The support site must render `planned` features as planned, not as functional instructions. A website release can be pinned to the commit SHA or manifest version.

The manifest is a contract for **what should be communicated**. The controller remains the source of truth for **what actually happened**. Future runtime event logs should reference stable flow and stage IDs so support articles can link directly to an observed failed step.

## Current canonical flows

- `builder-add` — paired machine to verified GitHub runner
- `builder-remove` — exact-name confirmation, password, four removal stages
- `builder-upgrade` — version check, staged binary, restart, fresh heartbeat
- `device-discover` — USB inventory and candidate SDK association
- `device-identify` — read-only chip identification (**planned**)
- `firmware-flash` — gated firmware flashing (**planned**)

**Boundary:** Today the manifest is versioned and checked against generated support text, but it is not yet a comprehensive machine-verified state transition specification. When adding runtime instrumentation, assert each stage against controller event data rather than inferring success from UI labels.
