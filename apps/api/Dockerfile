# Build context is the repo root (see docker-compose.yml) so the workspace lockfile is available.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/api --include-workspace-root=false
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w apps/api && npm prune --omit=dev -w apps/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
# --chown: the app runs as the unprivileged "node" user, so it must own these files. Without it,
# files that were owner-only (600) on the host arrive owned by root and are unreadable at runtime.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./apps/api/drizzle
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
