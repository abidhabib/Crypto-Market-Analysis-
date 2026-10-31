# Production deployment

Production dashboard: https://crypto.abidhabib.pro
Stream: https://stream.abidhabib.pro
VPS: 191.96.1.74, Ubuntu/CloudPanel, existing `tradizone` Compose project in `/opt/tradizone`.

## Automatic releases

Every push to `main` runs `.github/workflows/production.yml`. GitHub builds the dashboard image on its runner, including heatmap tests and focused lint, then streams a versioned image archive to the VPS over SSH. It does not build on the VPS or alter CloudPanel/Nginx/PM2 configuration.

Normal UI releases recreate only `tradizone-dashboard-1`, keeping `127.0.0.1:3100`, existing memory/CPU caps, restart policy and logging. A short dashboard reconnect is possible during recreation; this is not a zero-downtime blue/green deployment.

Changes under `mini-services/terminal-stream/` also build and update the stream. Changes to an already-tracked `deploy/Dockerfile` do so as well. The initial addition of the deployment Dockerfile does not force a stream restart. For a manual Actions run, select **deploy_stream** only when the backend needs updating. Stream recreation resets in-memory order-book/replay history.

Actions runs serialize through one production concurrency group. Only the `main` branch can enter the deployment job. The workflow can also be started from **GitHub → Actions → Production → Run workflow**.

## Connection and permissions

Repository variables:
- `PROD_HOST`: production IP.
- `PROD_USER`: SSH account used by the restricted key.

Repository Actions secrets:
- `PROD_SSH_PRIVATE_KEY`: a dedicated CI key, never a general-purpose personal SSH key.
- `PROD_KNOWN_HOSTS`: the previously trusted SSH host key entries, verified through existing SSH access.

The server key entry uses `restrict,command="/opt/tradizone/bin/receive-release"`. That root-owned receiver only accepts `check` or `deploy <40-character commit SHA> dashboard|both`; it cannot be used as an interactive shell or for SSH forwarding. The Actions workflow contains no private key values.

The receiver is installed once by the administrator from `deploy/receive-release.sh`. Pushing a modified receiver script does not silently replace that privileged server-side script. Review/test and install receiver changes deliberately over the administrator's existing SSH connection.

## Health and rollback

`receive-release.sh` loads images and checks their revision labels before rollout. It preserves the existing Compose configuration and writes a managed `compose.override.yaml` for image selection. Ordinary manual Compose commands in `/opt/tradizone` therefore keep using the selected release.

After recreation it waits for container health and checks the local dashboard and Socket.IO handshake. If the rollout or health check fails, it restores the previous image references and recreates only the selected app services. An unhealthy application is not guaranteed to recover if its previous image is also broken or the host itself is unavailable; inspect the failed workflow/server logs in that case.

A successful local stream handshake proves the stream process responds, not that Binance or other upstream services are reachable. Check real prices/trades in the browser after a backend change.

Release archives and previous image references live in `/opt/tradizone/releases/<SHA>/`. The active commit is recorded in `/opt/tradizone/current-release`. Old images are retained for rollback; monitor disk use and remove only verified obsolete Tradizone artifacts. No global Docker prune, PM2 restart, Nginx restart or host Node upgrade is performed.

Read-only status commands on the VPS:

```sh
cd /opt/tradizone
cat current-release
docker compose -p tradizone ps
docker compose -p tradizone logs --tail=60 dashboard
```

For a manual rollback, inspect `releases/<release-being-reverted>/previous-images.txt`, restore those image values in the managed Compose override, and run `docker compose -p tradizone up -d --no-deps dashboard` (include `stream` only if rolling it back too). Do not delete the previous images until the release is accepted.

## Local checks

```sh
python3 tests/production-deploy.test.py
bash -n deploy/receive-release.sh
```

The receiver tests use fake Docker/curl inside a temporary directory. They check dashboard-only isolation, explicit backend updates, rejection of arbitrary SSH commands and wrong image revisions, rollback after health failure, and protection of unmanaged overrides. They never operate on the local Docker daemon.

## Build manually

```sh
docker buildx build --load --platform linux/amd64 --target dashboard \
  --build-arg NEXT_PUBLIC_STREAM_URL=https://stream.abidhabib.pro \
  --build-arg APP_REVISION=<full-commit-SHA> \
  -f deploy/Dockerfile -t tradizone-dashboard:<full-commit-SHA> .
```

The public stream URL is baked into the frontend at build time. GitHub builds target Linux amd64 to match this VPS. The project still permits builds with pre-existing unrelated TypeScript errors; focused tests/lint do not imply a clean project-wide typecheck.
