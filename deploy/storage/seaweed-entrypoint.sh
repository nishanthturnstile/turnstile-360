#!/bin/sh
set -eu
identity_file=${DMS_STORAGE_IDENTITY_FILE:-/run/secrets/storage-identities.json}
[ -s "$identity_file" ] || exit 1
# Only authenticated S3 binds to the container network. Internal HTTP/gRPC stay loopback.
weed mini -dir=/data -ip=127.0.0.1 -ip.bind=127.0.0.1 -s3=false -webdav=false -admin.ui=false -filer.disableDirListing=true &
backend_pid=$!
trap 'kill "$backend_pid" "${s3_pid:-}" 2>/dev/null || true; wait || true' EXIT
trap 'exit 0' TERM INT
attempt=0
until wget -q -O /dev/null http://127.0.0.1:9333/cluster/status; do
  attempt=$((attempt+1))
  if [ "$attempt" -ge 60 ] || ! kill -0 "$backend_pid" 2>/dev/null; then exit 1; fi
  sleep 1
done
weed s3 -ip.bind=0.0.0.0 -filer=127.0.0.1:8888 -config="$identity_file" -iam=false &
s3_pid=$!
wait "$s3_pid"
