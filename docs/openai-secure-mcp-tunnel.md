# Connect Main{Create} to ChatGPT — Secure MCP Tunnel

**Recommended: use Main{Create} → Settings → Connect ChatGPT.** Ordinary users do **not** edit environment variables, Compose, terminal commands, or files. Main{Create} runs its own private local MCP listener and manages the officially released OpenAI tunnel-client (pinned v0.0.19). Each self-hosted installation connects directly using its **owner's own** OpenAI tunnel identity; Main{Create} Cloud is not involved.

The tunnel is **outbound-only**. It is not a published public MCP endpoint. Claude and Gemini are deferred.

## Three-step self-hosted connection

1. Visit [OpenAI Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels) to create your private tunnel. Create a [runtime API key](https://platform.openai.com/settings/organization/api-keys) whose principal has **Tunnels Read + Use**. A Platform admin API key is unnecessary for the long-lived connection.
2. Open **Main{Create} → Settings → Connect ChatGPT**, paste the tunnel ID and the runtime key, and press **Save & connect**. Main{Create} validates the values, encrypts the key in its local controller state, starts a private loopback MCP listener and the official outbound tunnel client, and monitors readiness. It never returns the key to the browser. **Disconnect** stops the processes but retains the encrypted credentials; **Forget credentials** also removes them.
3. When Settings says **Ready**, open [ChatGPT connections](https://chatgpt.com/#settings/Connectors), add a custom MCP server, choose **Tunnel**, select your tunnel and approve the tools. This final ChatGPT-side authorization remains a user action. Main{Create} cannot determine that the ChatGPT plugin is installed merely from tunnel readiness.

The local MCP listener is **not** a public web route. Its bearer and internal service credentials are generated per portal process, never exposed in the UI. The stored OpenAI runtime key is decrypted only in-process into a private, mode 0600 ephemeral file for the upstream tunnel-client; it is not passed in process arguments, log messages, or the normal user-facing environment. The Settings API requires a signed-in administrator and CSRF protection. Firmware execution remains approval-gated.

**What Ready means:** the loopback MCP gateway passed its local health check and OpenAI tunnel-client reported ready on its loopback-only readiness endpoint. It does not mean a ChatGPT custom plugin has already been added or that a physical device can safely be flashed.

Official references: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [official tunnel-client configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), and [ChatGPT custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).

## Advanced: manually operated Compose tunnel (optional)

This section is an **operator-only fallback** when the bundled portal-managed tunnel cannot be used, for example, when the MCP gateway is deployed separately from the portal. Do not activate the bundled Settings-managed tunnel and the separate Compose profile under the same tunnel ID simultaneously.

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

### Prerequisites for manual Compose

- A running Main{Create} **portal** and separate **gateway** from the repo-root Compose deployment.
- Existing matching `MAIN_SERVICE_TOKEN` and `MAIN_MCP_TOKEN` variables for the portal and gateway. Use random 32+ character secrets; never add secrets to source control.
- An OpenAI Platform tunnel ID, and a **runtime** API key with Tunnels Read + Use. Do not use a Platform admin key as a tunnel daemon key.
- The OpenAI tunnel must be associated with the intended ChatGPT workspace, and the user must have permission to create a custom MCP plugin.

Create or inspect a tunnel at https://platform.openai.com/settings/organization/tunnels. Create the runtime key at https://platform.openai.com/settings/organization/api-keys.

### One-time manual private setup

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

- In the **Settings flow**, the OpenAI runtime key is stored **encrypted** in Main{Create}'s local private controller state; only the short-lived runtime consumes its decrypted bytes. In **manual Compose mode**, the OpenAI runtime key stays in the external `openai-tunnel` secret file.
- MCP gateway bearer stays between `openai-tunnel` and `gateway`; it is never sent to the OpenAI tunnel control plane.
- Do not publish `gateway:3001`, `openai-tunnel:/ui`, `/readyz`, or `/healthz` to a public hostname.
- Use **separate** tunnel IDs and keys for Main{Create} and unrelated MCP products; don't reuse an existing Agentic/HomeCloud tunnel.
- Plan/execute tools are permissioned by Main{Create} itself. A tunnel is a transport, not authorization for arbitrary local commands.
- Neither connection method claims ChatGPT plugin registration merely from an OpenAI tunnel process health check.
- Claude integration is paused. Do not confuse an outbound Cloudflare Tunnel connector with a private OpenAI-hosted tunnel; Cloudflare can supply public HTTPS ingress without inbound origin ports, but an independently authenticated Claude connector requires separate review.

## Debugging

- Tunnel client exits immediately: check file secret mounts, tunnel ID, Platform permission/association and private MCP URL. Do not paste auth errors containing credentials.
- Portal healthy but no tools: check gateway's `/healthz` privately; ensure `MAIN_SERVICE_TOKEN` matches the controller and `MAIN_MCP_TOKEN` matches the bearer header file.
- Tunnel exists but not selectable in ChatGPT: verify tunnel-to-workspace association and ChatGPT plugin creation permission. Wait for newly granted roles to propagate.
- MCP discovery fails: run `tunnel-client doctor` with the exact configured profile/credentials; verify that connector Accept headers and the gateway's HTTP authentication succeed.
- Main{Create} gateway deliberately requires an approved bearer credential and never exposes its tool list anonymously.

## Deferred product features

- Verified live ChatGPT connection from a new Main{Create} tunnel.
- Automated provisioning of OpenAI Platform tunnel resources (requires delegated Platform permissions).
- OAuth/DCR for a public remote MCP endpoint; not necessary for the private transport MVP.
- Claude and Gemini connectors.
