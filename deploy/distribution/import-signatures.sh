#!/bin/sh
set -eu
umask 077
cd /incoming
[ "$(wc -l < SHA256SUMS)" -eq 3 ]
[ "$(grep -Ec '^[a-f0-9]{64}  (main|daily|bytecode)\.cvd$' SHA256SUMS)" -eq 3 ]
[ "$(awk '{print $2}' SHA256SUMS | sort -u | wc -l)" -eq 3 ]
sha256sum -c SHA256SUMS
revision=$(sha256sum SHA256SUMS | awk '{print $1}')
set_dir="/var/lib/clamav/sets/$revision"
for database in main.cvd daily.cvd bytecode.cvd; do
  test -f "$database"
  sigtool --info "$database" >/tmp/signature-info
  grep -q 'Verification OK' /tmp/signature-info
done
if [ -d "$set_dir" ]; then
  # A completed revision is never rewritten while a daemon could still use it.
  (cd "$set_dir"; sha256sum -c /incoming/SHA256SUMS)
else
  temporary=$(mktemp -d /var/lib/clamav/sets/.import.XXXXXX)
  trap 'rm -rf "$temporary"' EXIT
  for database in main.cvd daily.cvd bytecode.cvd; do
    cp "$database" "$temporary/$database"
  done
  (cd "$temporary"; sha256sum -c /incoming/SHA256SUMS)
  mv "$temporary" "$set_dir"
  trap - EXIT
fi
previous=$(readlink /var/lib/clamav/current || true)
ln -sfn "sets/$revision" /var/lib/clamav/current.new
mv -Tf /var/lib/clamav/current.new /var/lib/clamav/current
# Keep the active and immediately previous signed sets. Never traverse arbitrary paths.
for directory in /var/lib/clamav/sets/*; do
  name=${directory##*/}
  printf '%s' "$name" | grep -Eq '^[a-f0-9]{64}$' || continue
  [ "$name" = "$revision" ] && continue
  [ "sets/$name" = "$previous" ] && continue
  rm -rf "$directory"
done
printf '%s\n' 'Verified offline signature set installed atomically; restart scanner and check freshness'
