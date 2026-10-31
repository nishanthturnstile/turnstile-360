FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /workspace
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.16.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@thaarei/dms-api...
RUN pnpm --filter @thaarei/dms-api deploy --prod /runtime

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=build --chown=node:node /runtime/ ./
COPY LICENSE ./LICENSE
USER node
EXPOSE 3001
CMD ["node", "dist/main.api.js"]
