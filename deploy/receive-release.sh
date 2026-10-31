#!/usr/bin/env bash
# Installed root-owned at /opt/tradizone/bin/receive-release.
# The CI SSH key is restricted to this command, without PTY or forwarding.
set -Eeuo pipefail
umask 077
BASE=/opt/tradizone
PROJECT=tradizone
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

if [[ ${SSH_ORIGINAL_COMMAND:-} == check ]]; then
  printf 'Tradizone deployment endpoint ready\n'
  exit 0
fi
if [[ ! ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([a-f0-9]{40})\ (dashboard|both)$ ]]; then
  printf 'Only a versioned Tradizone release is accepted.\n' >&2
  exit 2
fi
revision=${BASH_REMATCH[1]}
mode=${BASH_REMATCH[2]}
exec 9>"$BASE/deploy.lock"
flock -w 600 9
cd "$BASE"
release="$BASE/releases/$revision"
mkdir -p "$release"
archive="$release/images.tar.gz"
printf 'Receiving release %s (%s)\n' "$revision" "$mode"
cat > "$archive.part"
gzip -t "$archive.part"
mv "$archive.part" "$archive"
gzip -dc "$archive" | docker load

services=(dashboard)
[[ $mode == dashboard ]] || services+=(stream)
for service in "${services[@]}"; do
  image="tradizone-$service:$revision"
  actual=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
  [[ $actual == "$revision" ]] || { printf 'Image revision mismatch: %s\n' "$service" >&2; exit 3; }
done

# Keep the existing Compose resource caps, ports, network, logs and restart policy.
# Only replace images. The default Compose override also keeps manual commands aligned.
base=(docker compose -p "$PROJECT" -f "$BASE/compose.yaml")
override="$BASE/compose.override.yaml"
if [[ -f $override ]] && ! head -n 1 "$override" | grep -qx '# Managed by Tradizone automatic deployment'; then
  printf 'An unmanaged Compose override exists; refusing to overwrite it.\n' >&2
  exit 4
fi
old_dashboard_id=$("${base[@]}" ps -q dashboard)
old_stream_id=$("${base[@]}" ps -q stream)
[[ -n $old_dashboard_id && -n $old_stream_id ]] || { printf 'Existing app containers not found.\n' >&2; exit 4; }
old_dashboard=$(docker inspect --format '{{.Config.Image}}' "$old_dashboard_id")
old_stream=$(docker inspect --format '{{.Config.Image}}' "$old_stream_id")
# All names are Docker image references read from Docker, never evaluated as shell code.
[[ $old_dashboard =~ ^[a-zA-Z0-9./:@_-]+$ && $old_stream =~ ^[a-zA-Z0-9./:@_-]+$ ]] || exit 4
new_dashboard="tradizone-dashboard:$revision"
new_stream=$old_stream
[[ $mode == dashboard ]] || new_stream="tradizone-stream:$revision"
write_override() {
  printf '# Managed by Tradizone automatic deployment\nservices:\n  dashboard:\n    image: "%s"\n  stream:\n    image: "%s"\n' "$1" "$2" > "$override.tmp"
  mv "$override.tmp" "$override"
}
if [[ -f $override ]]; then cp "$override" "$release/previous.override.yaml"; fi
printf '%s\n%s\n' "$old_dashboard" "$old_stream" > "$release/previous-images.txt"
compose=(docker compose -p "$PROJECT" -f "$BASE/compose.yaml" -f "$override")
wait_healthy() {
  local service id state
  for service in "${services[@]}"; do
    for ((attempt=0; attempt<60; attempt++)); do
      id=$("${compose[@]}" ps -q "$service")
      state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)
      [[ $state != healthy ]] || break
      sleep 2
    done
    [[ $state == healthy ]] || return 1
  done
  curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3100/ -o /dev/null
  # A local handshake checks the stream process, not upstream exchange availability.
  curl --fail --silent --show-error --max-time 15 'http://127.0.0.1:3131/?EIO=4&transport=polling' | grep -q '^0{'
}
rollback() {
  local code=$?
  [[ $code -ne 0 ]] || code=1
  trap - ERR INT TERM
  printf 'Release failed; restoring previous app images.\n' >&2
  write_override "$old_dashboard" "$old_stream"
  "${compose[@]}" up -d --no-deps --pull never "${services[@]}" || true
  "${compose[@]}" ps || true
  exit "${code:-1}"
}
trap rollback ERR INT TERM
write_override "$new_dashboard" "$new_stream"
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-deps --pull never "${services[@]}"
if ! wait_healthy; then
  "${compose[@]}" logs --tail=40 --no-color "${services[@]}" >&2 || true
  false
fi
trap - ERR INT TERM
printf '%s\n' "$revision" > "$BASE/current-release"
printf 'Release %s healthy. Stream updated: %s\n' "$revision" "$([[ $mode == both ]] && printf yes || printf no)"
"${compose[@]}" ps
