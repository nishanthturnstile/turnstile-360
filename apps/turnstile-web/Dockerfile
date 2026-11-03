FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /workspace
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.16.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@thaarei/turnstile-web...

FROM nginx:1.30.2-alpine@sha256:5f979dcfed4ce6461873f087e8c980d6e29b084b9e8776d9704a7e989b5f4898
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY LICENSE /usr/share/doc/turnstile360/LICENSE
COPY --from=build /workspace/apps/turnstile-web/dist/ /usr/share/nginx/html/
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
