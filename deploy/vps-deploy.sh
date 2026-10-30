#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Application credentials and Compose configuration remain on the VPS.
app_dir=${AVITO_DEPLOY_DIR:-/opt/avito-dev}
image=${1:?Image tag required}
incoming=${2:?Incoming directory required}
revision=${3:?Git revision required}
[[ $image =~ ^avito-backend:ci-[0-9]+-[0-9]+$ ]] || exit 2
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ $incoming == "$app_dir"/.incoming/* && $incoming != *'..'* ]] || exit 2
cd "$app_dir"
[[ -f compose.yaml && -f .env ]] || { echo 'Missing server Compose configuration or .env'; exit 1; }
exec 9> .deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
compose() { docker compose "$@"; }
compose config --quiet
# Never print resolved Compose configuration: it contains credentials.
previous_container=$(compose ps -q api)
[[ -n $previous_container ]] || { echo 'An existing API container is required for rollback'; exit 1; }
previous=$(docker inspect --format '{{.Image}}' "$previous_container")
old_previous=$(docker image inspect --format '{{.Id}}' avito-backend:previous 2>/dev/null || true)
worker_stopped=false
image_changed=false
api_changed=false

ready() {
  local attempt
  for (( attempt = 0; attempt < 30; attempt++ )); do
    if curl --fail --silent --output /dev/null --max-time 3 http://127.0.0.1:3000/health/ready; then
      return 0
    fi
    sleep 2
  done
  return 1
}
finish() {
  local result=$?
  trap - EXIT
  if (( result != 0 )); then
    echo 'Deployment failed; keeping/restoring the previous application image. Database is not rolled back.'
    if $image_changed; then
      docker tag "$previous" avito-backend:dev || true
    fi
    if $api_changed; then
      if compose up -d --no-deps --force-recreate api worker && ready; then
        echo 'Previous application image restored; inspect migration compatibility before retrying.'
      else
        echo 'ROLLBACK NEEDS ATTENTION: inspect API and worker on the VPS.'
      fi
    elif $worker_stopped; then
      compose up -d --no-deps worker || echo 'Worker restart needs attention.'
    fi
  fi
  rm -f "$incoming/backend-image.tar.gz" "$incoming/backend-image.tar.gz.sha256"
  exit "$result"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM

(cd "$incoming" && sha256sum --check backend-image.tar.gz.sha256)
gzip -dc "$incoming/backend-image.tar.gz" | docker load
actual_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
[[ $actual_revision == "$revision" ]] || { echo 'Image revision mismatch'; exit 1; }
# The existing stack must use the deployment alias for these three services.
# Include the tools profile when inspecting the one-off migration service.
compose --profile tools config --format json | python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
for name in ("api", "worker", "migrate"):
    if name not in services:
        raise SystemExit("Missing Compose service: " + name + " (migration profile: tools)")
    if services[name].get("image") != "avito-backend:dev":
        raise SystemExit("Expected avito-backend:dev for " + name)
'
compose exec -T postgres pg_isready -U avito -d avito
[[ $(compose exec -T redis redis-cli ping) == PONG ]]
install -d -m 700 backups
backup="backups/pre-deploy-${image##*:}.dump"
compose exec -T postgres pg_dump -U avito -d avito -Fc > "$backup"
[[ -s $backup ]] || { echo 'Database backup is empty'; exit 1; }
echo "Pre-migration database backup saved on VPS: $backup"

worker_stopped=true
compose stop -t 30 worker
image_changed=true
docker tag "$image" avito-backend:dev
# Keep detailed migration diagnostics on the server rather than in Actions logs.
if ! compose run --rm --no-deps migrate > "$incoming/migration.log" 2>&1; then
  echo "Migration failed. Inspect $incoming/migration.log on the VPS."
  exit 1
fi
api_changed=true
compose up -d --no-deps --force-recreate api
ready || { echo 'API readiness check failed'; exit 1; }
compose up -d --no-deps --force-recreate worker
sleep 5
worker_container=$(compose ps -q worker)
[[ -n $worker_container ]] || { echo 'Worker container is missing'; exit 1; }
[[ $(docker inspect --format '{{.State.Running}}:{{.RestartCount}}' "$worker_container") == true:0 ]] || {
  echo 'Worker stopped or restarted during startup'; exit 1;
}
expected=$(docker image inspect --format '{{.Id}}' "$image")
for service in api worker; do
  [[ $(docker inspect --format '{{.Image}}' "$(compose ps -q "$service")") == "$expected" ]] || {
    echo "Wrong image running for $service"; exit 1;
  }
done
ready || exit 1
docker tag "$previous" avito-backend:previous
printf '%s\n' "$revision" > .deployed-revision
# Keep current and previous aliases. Do not prune unrelated images or any volumes.
docker image rm "$image" >/dev/null || true
if [[ -n $old_previous && $old_previous != "$previous" && $old_previous != "$expected" ]]; then
  if [[ $(docker image inspect --format '{{index .Config.Labels "com.avito.service"}}' "$old_previous" 2>/dev/null || true) == backend ]]; then
    docker image rm "$old_previous" >/dev/null 2>&1 || true
  fi
fi
echo "Deployment succeeded: $revision"
echo 'Worker process checked; business job processing is not an end-to-end healthcheck.'
