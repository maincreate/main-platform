# Root entrypoint for Coolify Dockerfile deployments. This is intentionally only
# the private administration portal; the MCP gateway is a separate service.
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS host-build
WORKDIR /src
COPY host/ /src/host/
RUN cd /src/host && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tinkertunnel-host-linux-arm64 .

FROM node:22-alpine
RUN apk add --no-cache openssh-client sshpass
WORKDIR /app
COPY --chown=node:node portal/worker.js portal/server.mjs portal/setup.html portal/setup.js portal/setup.css portal/dashboard.html portal/dashboard.js portal/dashboard.css portal/github.html portal/github.js portal/github.css portal/topology.html portal/topology.js portal/jobs.html portal/jobs.js portal/jobs.css portal/settings.html portal/settings.js portal/projects.html portal/projects.js portal/devices.html portal/devices.js portal/builders.html portal/builders.js portal/marketplace.html portal/marketplace.js portal/actions.js portal/workspace.css ./portal/
COPY --chown=node:node controller/routes.mjs controller/host_routes.mjs controller/hosts.mjs controller/fabric.mjs controller/devices.mjs controller/projects.mjs controller/repository_creation.mjs ./controller/
COPY --chown=node:node runner/agent.mjs runner/scan_devices.py ./runner/
COPY --chown=node:node registry/capabilities.json registry/toolkits.json ./registry/
COPY --from=host-build /out/tinkertunnel-host-linux-arm64 ./downloads/tinkertunnel-host-linux-arm64
COPY --chown=node:node scripts/install-linux.sh ./scripts/install-linux.sh
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TT_DATA_DIR=/data TT_REQUIRE_LOGIN=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","portal/server.mjs"]
