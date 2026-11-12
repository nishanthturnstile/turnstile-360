# Customer-owned routing only; selected application images remain independently pinned.
FROM nginx:1.30.2-alpine@sha256:5f979dcfed4ce6461873f087e8c980d6e29b084b9e8776d9704a7e989b5f4898
COPY deploy/customer/nginx.conf.template /opt/customer/nginx.conf.template
COPY deploy/customer/entrypoint /opt/customer/entrypoint
COPY LICENSE THIRD_PARTY_NOTICES /usr/share/doc/thaarei-customer/
USER nginx
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/opt/customer/entrypoint"]
