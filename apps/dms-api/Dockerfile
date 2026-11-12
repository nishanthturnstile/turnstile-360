FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /workspace
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dms-api/package.json apps/dms-api/package.json
COPY apps/dms-processing/package.json apps/dms-processing/package.json
COPY apps/thaarei-control-plane/package.json apps/thaarei-control-plane/package.json
COPY apps/turnstile-api/package.json apps/turnstile-api/package.json
COPY apps/turnstile-web/package.json apps/turnstile-web/package.json
COPY packages/control-plane-contracts/package.json packages/control-plane-contracts/package.json
COPY packages/deployment-control/package.json packages/deployment-control/package.json
COPY packages/dms-client/package.json packages/dms-client/package.json
COPY packages/dms-contracts/package.json packages/dms-contracts/package.json
COPY packages/module-catalog/package.json packages/module-catalog/package.json
COPY packages/turnstile-contracts/package.json packages/turnstile-contracts/package.json
COPY packages/installation-engine/package.json packages/installation-engine/package.json
COPY patches ./patches
RUN --mount=type=cache,id=thaarei-pnpm-12,target=/pnpm/store --mount=type=cache,id=thaarei-pnpm-metadata,target=/root/.cache/pnpm pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN pnpm exec turbo run build --filter=@thaarei/dms-api...
RUN --mount=type=cache,id=thaarei-pnpm-12,target=/pnpm/store --mount=type=cache,id=thaarei-pnpm-metadata,target=/root/.cache/pnpm pnpm --filter @thaarei/dms-api deploy --prod --prefer-offline --store-dir /pnpm/store /runtime

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=build --chown=node:node /runtime/ ./
COPY scripts/provision-auth-database.mjs ./maintenance/provision-auth-database.mjs
ARG DMS_RELEASE=development
ENV DMS_BUILD_VERSION=$DMS_RELEASE
LABEL org.opencontainers.image.version=$DMS_RELEASE
COPY LICENSE ./LICENSE
COPY THIRD_PARTY_NOTICES ./THIRD_PARTY_NOTICES
USER node
EXPOSE 3001
CMD ["node", "dist/main.api.js"]
