# TinkerTunnel interface directions

The product should feel like a professional developer tool, not a dark-green home-lab administration console. Do not couple themes to infrastructure or hosting vendors.

## Three palettes

| Theme | Canvas | Surface | Text | Primary accent | Personality |
| --- | --- | --- | --- | --- | --- |
| Graphite + Iris | `#F6F7FB` | `#FFFFFF` | `#19243C` | `#6058EE` | Clean, modern, focused |
| Warm Paper | `#FAF7F1` | `#FFFDF8` | `#36332D` | `#AD593F` | Editorial, human, approachable |
| Midnight | `#0D1526` | `#172339` | `#F2F6FF` | `#24C9BD` | Technical, immersive, low light |

The default for the current preview is Graphite + Iris, replacing the original teal/mint-on-black theme. The dashboard allows users to select among the three; the selection is browser-local and does not affect other users yet.

## Design-system candidates

1. **Accessible primitives + custom tokens** (current direction): very small footprint, no UI framework required, fits self-hosted Node server. The downside is that consistent focus management, form validation and richer components require more in-house work.
2. **shadcn/ui + Radix primitives + Tailwind**: flexible code-owned UI components and a large ecosystem; strongest longer-term choice if the portal moves to React. Downsides: framework/toolchain migration and ongoing component upgrades.
3. **Mantine**: integrated React component library with forms, tables and theme tooling; faster to build complex settings, more opinionated visually and a larger dependency footprint.

For the foundation release, use semantic HTML/CSS tokens and a small component vocabulary (Button, TextInput, Card, State, Modal) rather than adopting React and delaying deployment. Reevaluate when adding complex workspace/runner tables.

## Onboarding information hierarchy

**Before creating the first user**
- Brand, one-sentence product purpose, administrator username, password and confirmation
- Absolutely no GitHub App key, organization selector, MCP, tunnel, host port, deployment role or installation plan

**Immediately after creating the first user**
- Authenticated dashboard with real account and connection status, not an empty preview
- Three clearly explained optional areas: GitHub, Build machines, AI assistant
- Primary recommendation: GitHub, then organization selection for shared runners, then runners, then assistant

**GitHub connection (after account creation)**
- GitHub device authorization link and displayed GitHub device code, analogous to HACS
- Return to TinkerTunnel and select from organizations visible to the OAuth authorization
- State explicitly that selecting an organization is not permission to execute builds or install runners
- No raw GitHub App private keys or personal access tokens pasted into the initial experience

**Hosting**
- The same interface must work under Docker Compose, Kubernetes, Coolify and other compatible deployment environments
- Vendor-specific deployment guides belong in docs, not user-facing wizard copy
