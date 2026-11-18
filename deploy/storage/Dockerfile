FROM chrislusf/seaweedfs:4.51@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8 AS base
COPY LICENSE THIRD_PARTY_NOTICES /usr/share/doc/thaarei/
COPY deploy/storage/SEAWEEDFS-LICENSE /usr/share/doc/seaweedfs/LICENSE
COPY deploy/storage/seaweed-entrypoint.sh /usr/local/bin/dms-seaweed
ENTRYPOINT ["/bin/sh", "/usr/local/bin/dms-seaweed"]

FROM base AS standalone
RUN addgroup -g 10001 dms && adduser -D -u 10001 -G dms dms
USER 10001:10001

FROM base AS default
