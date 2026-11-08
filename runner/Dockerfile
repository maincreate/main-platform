FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 py3-pyserial
COPY --chown=node:node agent.mjs scan_devices.py ./
RUN mkdir -p /var/lib/tinkertunnel && chown node:node /var/lib/tinkertunnel
USER node
ENV NODE_ENV=production MAIN_RUNNER_STATE_DIR=/var/lib/tinkertunnel
CMD ["node","agent.mjs","run"]
