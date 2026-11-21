# Coolify GitHub push delivery verification

Main{Create}'s production application in Coolify is **Main-Platform** and tracks `maincreate/main-platform` branch `main`.

A successful release must satisfy all of these independent checks:

1. The exact GitHub `main` commit passes CI and is merged.
2. Coolify reports a deployment created by **webhook**, not MCP or an API/manual operation.
3. That deployment reaches the finished state and matches the GitHub commit SHA.
4. The live Main{Create} controller reflects the expected Host version, and enrolled builders converge to it.

If step 2 fails, check that the application is using the `maincreate` GitHub App source, that the App is installed on the `maincreate/main-platform` repository, and that Coolify Advanced → Deployment → Auto deploy is set to **Deploy on push (webhooks)**. The GitHub App needs a reachable webhook endpoint and a successful push-event delivery. Public-repository cloning by itself does **not** configure event delivery.

Do not treat an MCP-deployed build as proof of automatic GitHub push delivery.
