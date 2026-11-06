FROM clamav/clamav:1.5.1_base@sha256:f4bb8882123f505292b4ead6826ff79c56e01d0abaa46b20b42b65f11fce8b21
COPY deploy/assessment/legal/ /usr/share/licenses/clamav/
COPY LICENSE THIRD_PARTY_NOTICES /usr/share/doc/thaarei/
ARG DMS_RELEASE=development
LABEL org.opencontainers.image.version=$DMS_RELEASE
USER clamav
