# OpenAI Secure MCP Tunnel for Main{Create}

**Status: deployment profile implemented; no OpenAI tunnel identity or runtime credentials provisioned by Main{Create}.** Live connectivity requires the operator to complete the OpenAI Platform steps and verify the gateway. This is a **private** connection, not a public MCP endpoint. Claude and Gemini are explicitly out of scope.

Official source: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [tunnel-client configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), [ChatGPT custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).

## Architecture

```text
ChatGPT custom plugin / OpenAI Platform tunnel endpoint
                |
        outbound HTTPS :443
                |
       openai-tunnel (separate, opt-in)
                |
   private Docker network / bearer header
                |
  gateway:3001/mcp --> portal:3000 --> approved capability fabric
```

Nothing listens on a public inbound port for the tunnel profile. The OpenAI `tunnel-client` polls OpenAI over HTTPS and forwards to the private gateway. The gateway independently validates its own bearer token, and device-related operations retain the portal's approval constraints.

This repository pins `ghcr.io/openai/tunnel-client:v0.0.19` for repeatability. It is a published official multi-architecture image (Linux amd64 and arm64); review the [release](https://github.com/openai/tunnel-client/releases/tag/v0.0.19) and upgrade deliberately. Verify image provenance using GitHub's documented attestation procedure for the exact tag before production.

## Prerequisites

- A running Main{Create} **portal** and separate **gateway** from the repo-root Compose deployment.
- Existing matching `MAIN_SERVICE_TOKEN` and `MAIN_MCP_TOKEN` variables for the portal and gateway. Use random 32+ character secrets; never add secrets to source control.
- An OpenAI Platform tunnel ID, and a **runtime** API key with Tunnels Read + Use. Do not use a Platform admin key as a tunnel daemon key.
- The OpenAI tunnel must be associated with the intended ChatGPT workspace, and the user must have permission to create a custom MCP plugin.

Create or inspect a tunnel at https://platform.openai.com/settings/organization/tunnels. Create the runtime key at https://platform.openai.com/settings/organization/api-keys.

## One-time private setup

From the root of the checked-out Main{Create} platform repository:

1. Create private secret files **outside Git** and restrict permissions:

   ```sh
   mkdir -p secrets && chmod 700 secrets
   umask 077
   # Use your password manager or a terminal secret-input tool to write both files.
   # secrets/openai-runtime-api-key: raw OpenAI runtime API key (no prefix)
   # secrets/main-mcp-auth-header: exactly "Bearer " followed by MAIN_MCP_TOKEN
   chmod 600 secrets/openai-runtime-api-key secrets/main-mcp-auth-header
   ```

   Do not echo either credential into CI logs, command arguments, browser code, GitHub issues, or a support request. The MCP header file must include the literal `Bearer ` prefix; `MAIN_MCP_TOKEN` alone will not authenticate against the gateway.

2. Set the **nonsecret** tunnel ID in your local, ignored `.env`:

   ```text
   MAIN_OPENAI_TUNNEL_ID=tunnel_your_exact_tunnel_id
   ```

3. Deploy the existing portal and gateway with matching `MAIN_SERVICE_TOKEN` and `MAIN_MCP_TOKEN` configured, then start the optional profile:

   ```sh
   docker compose --profile openai-tunnel up -d
   ```

   The container uses two Compose file secrets, makes outbound HTTPS requests to OpenAI, and calls `http://gateway:3001/mcp` over the private Compose network. The default profile does not expose OpenAI or Cloudflare MCP endpoints. If your portal is already deployed as an independent Coolify application, place the gateway and tunnel-client in a private network together; the root Compose profile does **not** automatically attach to that Coolify application. Keep `MCP_SERVER_URL` private.

4. Confirm container readiness without exposing the tunnel client's local admin UI. Use container logs (redacted) and its documented loopback `/readyz` and `/healthz` endpoints. `/readyz` must report ready, not merely a running process. Test initialization and `tools/list`; verify the six Main{Create} tools.

5. In **ChatGPT → Plugins → Add custom MCP server**, choose **Tunnel** and select the created tunnel ID. Choose scoped permissions, inspect the tools and risk notices, then test `maincreate_discover` before any plan/execute action. Plugin permissions and Platform tunnel permissions are independent.

## Enforcement and credential boundaries

- OpenAI runtime API key stays within `openai-tunnel`; Main{Create} never stores it in its portal database.
- MCP gateway bearer stays between `openai-tunnel` and `gateway`; it is never sent to the OpenAI tunnel control plane.
- Do not publish `gateway:3001`, `openai-tunnel:/ui`, `/readyz`, or `/healthz` to a public hostname.
- Use **separate** tunnel IDs and keys for Main{Create} and unrelated MCP products; don't reuse an existing Agentic/HomeCloud tunnel.
- Plan/execute tools are permissioned by Main{Create} itself. A tunnel is a transport, not authorization for arbitrary local commands.
- This deployment profile deliberately does not claim live connectivity until a tunnel ID, runtime key, gateway bearer, and ChatGPT custom plugin are configured and tested.
- Claude integration is paused. Do not confuse an outbound Cloudflare Tunnel connector with a private OpenAI-hosted tunnel; Cloudflare can supply public HTTPS ingress without inbound origin ports, but an independently authenticated Claude connector requires separate review.

## Debugging

- Tunnel client exits immediately: check file secret mounts, tunnel ID, Platform permission/association and private MCP URL. Do not paste auth errors containing credentials.
- Portal healthy but no tools: check gateway's `/healthz` privately; ensure `MAIN_SERVICE_TOKEN` matches the controller and `MAIN_MCP_TOKEN` matches the bearer header file.
- Tunnel exists but not selectable in ChatGPT: verify tunnel-to-workspace association and ChatGPT plugin creation permission. Wait for newly granted roles to propagate.
- MCP discovery fails: run `tunnel-client doctor` with the exact configured profile/credentials; verify that connector Accept headers and the gateway's HTTP authentication succeed.
- Main{Create} gateway deliberately requires an approved bearer credential and never exposes its tool list anonymously.

## Deferred

- Verified live ChatGPT connection from a new Main{Create} tunnel.
- Automated provisioning of OpenAI Platform tunnel resources (requires delegated Platform permissions).
- OAuth/DCR for a public remote MCP endpoint; not necessary for the private transport MVP.
- Claude and Gemini connectors.
