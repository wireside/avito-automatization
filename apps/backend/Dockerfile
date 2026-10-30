FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/mini-app/package.json apps/mini-app/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/queue/package.json packages/queue/package.json

FROM dependencies AS build
RUN pnpm --filter '@avito/backend...' install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
COPY packages packages
RUN pnpm --filter '@avito/backend...' build

FROM dependencies AS production-dependencies
RUN pnpm --filter '@avito/backend...' install --prod --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=production-dependencies /app ./
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/database/migrations packages/database/migrations
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/integrations/dist packages/integrations/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/packages/queue/dist packages/queue/dist
USER node
CMD ["node", "apps/backend/dist/api.js"]
