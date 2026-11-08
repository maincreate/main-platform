# Root entrypoint for Coolify Dockerfile deployments. This is intentionally only
# the private administration portal; the MCP gateway is a separate service.
FROM golang:1.23-alpine AS host-build
WORKDIR /src
COPY host/ /src/host/
RUN cd /src/host && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/maincreate-host-linux-arm64 .

FROM node:22-alpine
RUN apk add --no-cache openssh-client sshpass
WORKDIR /app
COPY --chown=node:node portal/worker.js portal/server.mjs portal/setup.html portal/setup.js portal/appearance.js portal/account.js portal/appearance.css portal/setup.css portal/dashboard.html portal/dashboard.js portal/dashboard.css portal/activity.css portal/github.html portal/github.js portal/github.css portal/topology.html portal/topology.js portal/jobs.html portal/jobs.js portal/jobs.css portal/settings.html portal/settings.js portal/projects.html portal/projects.js portal/devices.html portal/devices.js portal/builders.html portal/builders.js portal/builder-actions.css portal/marketplace.html portal/marketplace.js portal/marketplace-planning.css portal/actions.js portal/workspace.css ./portal/
COPY --chown=node:node controller/routes.mjs controller/host_routes.mjs controller/hosts.mjs controller/runner_provisioning.mjs controller/project_monitor.mjs controller/fabric.mjs controller/devices.mjs controller/microcontrollers.mjs controller/projects.mjs controller/repository_creation.mjs controller/marketplace_planning.mjs controller/build_flash_routing.mjs controller/github_workflow_routing.mjs ./controller/
COPY --chown=node:node controller/builder_decommission.test.mjs controller/marketplace_planning.test.mjs ./controller/
RUN node --test ./controller/builder_decommission.test.mjs ./controller/marketplace_planning.test.mjs
COPY --chown=node:node runner/agent.mjs runner/sdk_install.mjs runner/scan_devices.py ./runner/
COPY --chown=node:node registry/capabilities.json registry/toolkits.json registry/microcontrollers.json registry/ux-flows.json ./registry/
# Fail image builds immediately if the portal has any missing static ESM dependencies.
RUN node -e "import('./controller/routes.mjs').then(() => console.log('Portal runtime modules resolved'))"
COPY --from=host-build /out/maincreate-host-linux-arm64 ./downloads/maincreate-host-linux-arm64
COPY --chown=node:node scripts/install-linux.sh scripts/uninstall-linux.sh ./scripts/
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MAIN_DATA_DIR=/data MAIN_REQUIRE_LOGIN=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","portal/server.mjs"]
