FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node portal/worker.js portal/server.mjs portal/setup.html portal/setup.js portal/setup.css portal/dashboard.html portal/dashboard.js portal/dashboard.css portal/github.html portal/github.js portal/github.css portal/topology.html portal/topology.js portal/jobs.html portal/jobs.js portal/jobs.css portal/settings.html portal/settings.js portal/projects.html portal/projects.js portal/devices.html portal/devices.js portal/workspace.css ./portal/
COPY --chown=node:node controller/routes.mjs controller/fabric.mjs controller/devices.mjs controller/projects.mjs ./controller/
COPY --chown=node:node registry/capabilities.json registry/toolkits.json ./registry/
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TT_DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","portal/server.mjs"]
