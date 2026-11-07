FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node agent.mjs ./
RUN mkdir -p /var/lib/tinkertunnel && chown node:node /var/lib/tinkertunnel
USER node
ENV NODE_ENV=production TT_RUNNER_STATE_DIR=/var/lib/tinkertunnel
CMD ["node","agent.mjs","run"]
