FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.16.1
COPY . .
RUN --mount=type=cache,id=thaarei-pnpm-12,target=/pnpm/store --mount=type=cache,id=thaarei-pnpm-metadata,target=/root/.cache/pnpm pnpm install --frozen-lockfile --store-dir /pnpm/store
RUN pnpm exec turbo run build --filter=@thaarei/thaarei-control-plane
RUN rm -rf apps/thaarei-control-plane/.next/cache
RUN --mount=type=cache,id=thaarei-pnpm-12,target=/pnpm/store --mount=type=cache,id=thaarei-pnpm-metadata,target=/root/.cache/pnpm pnpm --filter @thaarei/thaarei-control-plane deploy --prod --prefer-offline --store-dir /pnpm/store /runtime
RUN node scripts/package-control-plane.mjs apps/thaarei-control-plane /runtime

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /runtime/ ./
COPY LICENSE ./LICENSE
COPY THIRD_PARTY_NOTICES ./THIRD_PARTY_NOTICES
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
