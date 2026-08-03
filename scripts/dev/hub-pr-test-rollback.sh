#!/usr/bin/env bash
# Roll back hub-pr-test-deploy.sh to Hub-pinned production images.
set -euo pipefail

HUB_CONTAINER="${HUB_CONTAINER:-ci-os-hub}"
APP_STORE_ID="${APP_STORE_ID:-ci-marketplace}"
APP_NAME="${APP_NAME:-ci-memory}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-ci-memory_ci-marketplace}"

ROOT_FOLDER_HOST="${ROOT_FOLDER_HOST:-${HOME}/.local/share/companion-hub}"
APP_DIR_HOST="${ROOT_FOLDER_HOST}/apps/${APP_STORE_ID}/${APP_NAME}"
APP_ENV_HOST="${ROOT_FOLDER_HOST}/app-data/${APP_STORE_ID}/${APP_NAME}/app.env"
USER_ENV_HOST="${ROOT_FOLDER_HOST}/user-config/${APP_STORE_ID}/${APP_NAME}/app.env"
OVERRIDE_FILE="${APP_DIR_HOST}/docker-compose.pr-test.yml"

HUB_APP_ENV="/app-data/${APP_STORE_ID}/${APP_NAME}/app.env"
HUB_USER_ENV="/data/user-config/${APP_STORE_ID}/${APP_NAME}/app.env"
HUB_APP_DIR="/data/apps/${APP_STORE_ID}/${APP_NAME}"

if [[ ! -f "$APP_ENV_HOST" ]]; then
  echo "Missing app.env: $APP_ENV_HOST" >&2
  exit 1
fi

ENV_FILE_ARGS="--env-file ${HUB_APP_ENV}"
if [[ -f "$USER_ENV_HOST" ]]; then
  ENV_FILE_ARGS="${ENV_FILE_ARGS} --env-file ${HUB_USER_ENV}"
fi

if [[ -f "$OVERRIDE_FILE" ]]; then
  rm -f "$OVERRIDE_FILE"
  echo "==> Removed override: $OVERRIDE_FILE"
fi

echo "==> Recreating api + gateway from Hub-pinned compose..."
docker exec "$HUB_CONTAINER" sh -c "
  set -eu
  cd '${HUB_APP_DIR}'
  docker compose ${ENV_FILE_ARGS} --project-name '${COMPOSE_PROJECT}' \
    -f docker-compose.yml \
    up -d --force-recreate --no-deps api gateway
"

echo "==> Rollback complete."
