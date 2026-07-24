#!/usr/bin/env bash
set -euo pipefail

# ── CI-Server Image Publish Script ─────────────────────────────────────
#
# Pushes the companion/* images that make up ci-memory to a container
# registry.
#
# By default this script pushes images ONLY. The ci-memory entry in the
# CI-Portal store catalog is owned by CI-Marketplace (apps/ci-memory/),
# whose deploy workflow ingests and publishes it. CI-Server used to
# register the same slug from here, which made two repos independent
# writers of one catalog entry — last write won, and the manifest
# generated below had silently drifted from the one CI-Marketplace ships
# (see issue #1745).
#
# The Portal phases are kept for local development against a throwaway
# store, behind an explicit opt-in:
#
#   PUBLISH_TO_PORTAL=true ./publish.sh
#
# Never enable it against a shared Portal — it will overwrite whatever
# CI-Marketplace published.
#
# Opted in, the run is the original three-phase publish workflow:
#
#   Phase 1: POST /api/store/ingest         (upload .tar.gz bundle → pending)
#   Phase 2: docker push                    (push images to registry)
#   Phase 3: POST /api/store/publish/:slug  (pending → published)
#
# Usage:
#   ./publish.sh                    # images only (default)
#   ./publish.sh -q                 # quiet mode
#   REGISTRY=ghcr.io/companionintelligence ./publish.sh
#
# Environment:
#   REGISTRY             Docker registry host          (default: portal.ci.localhost)
#   REGISTRY_USERNAME    Registry login username       (required, unless GITHUB_TOKEN is set)
#   REGISTRY_PASSWORD    Registry login password       (required, unless GITHUB_TOKEN is set)
#   GITHUB_TOKEN         Token used as registry password fallback (e.g. inside GitHub Actions)
#   GITHUB_ACTOR         Username paired with GITHUB_TOKEN          (default: github-actions)
#   VERSION              Override version              (default: git tag or "latest")
#   SKIP_IMAGE_PUSH      Skip Step 3 (docker login + image push)    (default: false)
#   PUBLISH_TO_PORTAL    Opt in to Portal ingest/publish (local dev) (default: false)
#   PORTAL_API           Portal API base URL           (default: https://portal.ci.localhost/api)
#   STORE_ADMIN_API_KEY  Admin key for publish API     (required when PUBLISH_TO_PORTAL=true).
#                        The only value this script reads from ${REPO_ROOT}/.env,
#                        and only on the opt-in path.
#   SKIP_PORTAL          Legacy kill switch; still forces the Portal phases off
#   TAG_SUFFIX           Suffix appended to the pushed version tag, e.g. "-amd64".
#                        Used by the multi-arch publish workflow: each native
#                        build leg pushes :VERSION-<arch>, and merge-manifests.sh
#                        combines them into the :VERSION manifest list.
#
# The boolean switches accept true/1/yes/y/on (any case). Registry credentials
# are never read from .env — pass them in the environment.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Truthiness for this script's env switches. An exact `== "true"` match turns
# `PUBLISH_TO_PORTAL=1` into a silent images-only run — the opt-in is dropped
# and the run still exits 0, which is exactly the "reported success without
# doing the work" failure the summary below exists to prevent.
is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    true | 1 | yes | y | on) return 0 ;;
    *) return 1 ;;
  esac
}

# Read STORE_ADMIN_API_KEY from .env on the opt-in Portal path — it is the sole
# variable this script wants from there. Extract that one key rather than
# sourcing the file: `set -a` exports every key in a developer's .env, and a
# plain `source` overwrites values the caller passed in, so any collision with
# this script's own knobs (REGISTRY, VERSION, GITHUB_TOKEN, TAG_SUFFIX,
# SKIP_PORTAL, …) would silently win — including a stale SKIP_PORTAL=true
# quietly cancelling the opt-in that triggered the read in the first place.
if is_true "${PUBLISH_TO_PORTAL:-}" && [[ -z "${STORE_ADMIN_API_KEY:-}" && -f "${REPO_ROOT}/.env" ]]; then
  STORE_ADMIN_API_KEY=$(
    sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}STORE_ADMIN_API_KEY[[:space:]]*=[[:space:]]*//p' \
      "${REPO_ROOT}/.env" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
  )
  export STORE_ADMIN_API_KEY
fi

# ── Configuration ──────────────────────────────────────────────────────

REGISTRY="${REGISTRY:-portal.ci.localhost}"
PORTAL_API="${PORTAL_API:-https://portal.ci.localhost/api}"
ADMIN_KEY="${STORE_ADMIN_API_KEY:-}"

# Slug is derived from the manifest's config.json `id` so it always matches the
# value the Portal ingest handler reads from the bundle. Keeping it in sync this
# way prevents Step 2 (ingest, keyed on config.json id) and Step 4 (publish,
# keyed on this slug) from ever disagreeing on which app is being published.
SLUG=$(jq -r '.id' "${SCRIPT_DIR}/manifest/config.json")
if [[ -z "$SLUG" || "$SLUG" == "null" ]]; then
  echo "  ✗ Could not read 'id' from ${SCRIPT_DIR}/manifest/config.json" >&2
  exit 1
fi

# Portal catalog registration is opt-in (see the header): CI-Marketplace is the
# single writer of the ci-memory store entry. When it is opted into, it stays
# best-effort — pushing images is the part that actually matters for installs,
# so an unreachable Portal or a missing admin key must NOT abort the push.
# PORTAL_REQUESTED records the opt-in itself, separately from PORTAL_ENABLED,
# which the phases below clear as soon as one of them fails. Without it a caller
# who explicitly asked for a catalog publish would get the images-only success
# message and exit 0 when the publish never happened.
PORTAL_ENABLED=false
PORTAL_REQUESTED=false
PORTAL_SKIP_REASON='Portal publishing not enabled'
if is_true "${PUBLISH_TO_PORTAL:-}"; then
  if is_true "${SKIP_PORTAL:-}"; then
    # The legacy kill switch still wins, but it must not win quietly: an
    # explicit opt-in that vanishes without a word is an hour of "why is the
    # catalog entry not there?".
    PORTAL_SKIP_REASON='SKIP_PORTAL overrides PUBLISH_TO_PORTAL'
    echo "  ⚠ PUBLISH_TO_PORTAL and SKIP_PORTAL are both set — the kill switch wins; pushing images only." >&2
  else
    PORTAL_REQUESTED=true
    if [[ -n "${ADMIN_KEY}" ]]; then
      PORTAL_ENABLED=true
      PORTAL_SKIP_REASON=''
    else
      PORTAL_SKIP_REASON='STORE_ADMIN_API_KEY unset'
      echo "  ⚠ PUBLISH_TO_PORTAL is set but STORE_ADMIN_API_KEY is unset — pushing images only." >&2
    fi
  fi
fi

# Allow insecure TLS only for local development
if [[ "$REGISTRY" == *".localhost" || "$REGISTRY" == "localhost"* ]]; then
  CURL_OPTS="-sk"
else
  CURL_OPTS="-s"
fi

# Version: git tag (exact match) → fallback to "latest"
if [[ -z "${VERSION:-}" ]]; then
  VERSION=$(git -C "$REPO_ROOT" describe --tags --exact-match 2>/dev/null || echo "latest")
fi


QUIET=false
for arg in "$@"; do
  [[ "$arg" == "-q" || "$arg" == "--quiet" ]] && QUIET=true
done

# ── Image Map ──────────────────────────────────────────────────────────
# Shared with merge-manifests.sh — see scripts/publish/images.sh.

# shellcheck source=scripts/publish/images.sh
source "${SCRIPT_DIR}/images.sh"

# ── Helpers ────────────────────────────────────────────────────────────

log() { $QUIET || echo "$@"; }
logn() { $QUIET || printf "%s" "$@"; }

fail() {
  echo "  ✗ $*" >&2
  exit 1
}

# ── Generate docker-compose.json ───────────────────────────────────────
#
# Used only by the opt-in local-dev Portal publish. The manifest real installs
# receive is CI-Marketplace's apps/ci-memory/docker-compose.json; keep the two
# in step.
#
# The database volume is the one worth not getting wrong. These values track
# infrastructure/database/Dockerfile, which is postgres:18.4-bookworm: PGDATA
# lives under /var/lib/postgresql and the server runs as uid 999. Reverting to
# the /home/postgres/pgdata and uid 1000 of the earlier timescale/timescaledb-ha
# base does not fail loudly — that image declares VOLUME /var/lib/postgresql, so
# Docker quietly puts the cluster in an anonymous volume, outside APP_DATA_DIR
# and outside every backup. CI-Marketplace shipped exactly that from 2026-06-14
# until CI-Marketplace#739. See issue #1745.

generate_compose() {
  local reg="$1"
  local ver="$2"

  cat <<COMPOSE_EOF
{
  "schemaVersion": 2,
  "\$schema": "https://schemas.runtipi.io/v2/dynamic-compose.json",
  "services": [
    {
      "name": "gateway",
      "image": "${reg}/companion/gateway:${ver}",
      "isMain": true,
      "internalPort": 8642,
      "addToMainNetwork": true,
      "restart": "unless-stopped",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "api": { "condition": "service_started" }
      }
    },
    {
      "name": "api",
      "image": "${reg}/companion/api:${ver}",
      "restart": "unless-stopped",
      "environment": [
        { "key": "ENABLE_REQUIRE_SIGNUP_CODES", "value": "false" }
      ],
      "extraHosts": ["host.docker.internal:host-gateway"],
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "migrate-database": { "condition": "service_completed_successfully" },
        "database": { "condition": "service_healthy" }
      }
    },
    {
      "name": "fix-db-permissions",
      "image": "busybox:latest",
      "restart": "no",
      "user": "root",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/db", "containerPath": "/var/lib/postgresql" }
      ],
      "command": ["sh", "-c", "chown -R 999:999 /var/lib/postgresql"]
    },
    {
      "name": "database",
      "image": "${reg}/companion/database:${ver}",
      "restart": "unless-stopped",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/db", "containerPath": "/var/lib/postgresql" },
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn" : {
        "fix-db-permissions": { "condition": "service_completed_successfully" },
        "setup-secrets": { "condition": "service_completed_successfully" }
      },
      "healthCheck": {
        "test": "pg_isready",
        "interval": "5s",
        "timeout": "5s",
        "retries": 5
      }
    },
    {
      "name": "object-store",
      "image": "${reg}/companion/object-store:${ver}",
      "restart": "unless-stopped",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/objects", "containerPath": "/data/objects" },
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "setup-secrets": { "condition": "service_completed_successfully" }
      }
    },
    {
      "name": "orchestrator",
      "image": "${reg}/companion/orchestrator:${ver}",
      "restart": "unless-stopped",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "setup-orchestrator": { "condition": "service_completed_successfully" },
        "database": { "condition": "service_healthy" },
        "setup-secrets": { "condition": "service_completed_successfully" }
      }
    },
    {
      "name": "summary-service",
      "image": "${reg}/companion/summary-service:${ver}",
      "restart": "unless-stopped",
      "extraHosts": ["host.docker.internal:host-gateway"],
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "database": { "condition": "service_healthy" },
        "orchestrator": { "condition": "service_started" },
        "setup-secrets": { "condition": "service_completed_successfully" }
      }
    },
    {
      "name": "setup-database",
      "image": "${reg}/companion/setup-database:${ver}",
      "restart": "no",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "database": { "condition": "service_healthy" },
        "setup-secrets": { "condition": "service_completed_successfully" }
      }
    },
    {
      "name": "setup-orchestrator",
      "image": "${reg}/companion/setup-orchestrator:${ver}",
      "restart": "no",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "setup-database": { "condition": "service_completed_successfully" },
        "database": { "condition": "service_healthy" },
        "setup-secrets": { "condition": "service_completed_successfully" }
      }
    },
    {
      "name": "setup-secrets",
      "image": "${reg}/companion/setup-secrets:${ver}",
      "restart": "no",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets" }
      ]
    },
    {
      "name": "hbpe-service",
      "image": "${reg}/companion/hbpe-service:${ver}",
      "restart": "unless-stopped",
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/hbpe-models", "containerPath": "/app/models" },
        { "hostPath": "\${APP_DATA_DIR}/data/hbpe-corpus", "containerPath": "/app/data" },
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "database": { "condition": "service_healthy" },
        "orchestrator": { "condition": "service_started" },
        "setup-secrets": { "condition": "service_completed_successfully" }
      }
    },
    {
      "name": "migrate-database",
      "image": "${reg}/companion/api:${ver}",
      "restart": "no",
      "command": ["yarn", "migrate"],
      "volumes": [
        { "hostPath": "\${APP_DATA_DIR}/data/secrets", "containerPath": "/run/secrets", "readOnly": true }
      ],
      "dependsOn": {
        "setup-secrets": { "condition": "service_completed_successfully" },
        "database": { "condition": "service_healthy" }
      }
    }
  ]
}
COMPOSE_EOF
}

# ── Main ───────────────────────────────────────────────────────────────

main() {
  if ! $QUIET; then
    echo "╔══════════════════════════════════════╗"
    echo "║  CI-Server Image Publish             ║"
    echo "║  ${SLUG}@${VERSION}"
    echo "║  Registry: ${REGISTRY}"
    echo "╚══════════════════════════════════════╝"
    echo ""
  else
    echo "Publishing ${SLUG}@${VERSION} → ${REGISTRY} …"
  fi

  # ── Step 1: Prepare bundle ──────────────────────────────────────────
  # Only the Portal phases consume the bundle, so skip building it entirely
  # on the default images-only path. BUNDLE_DIR / BUNDLE are deliberately not
  # `local`: the EXIT trap below runs after main() returns and would other-
  # wise see them unset under `set -u`.
  if [[ "$PORTAL_ENABLED" == "true" ]]; then
    log "=== Step 1: Prepare app bundle ==="

    # generate_compose emits the un-suffixed :VERSION tag, which is what a real
    # install pulls. With TAG_SUFFIX set, Step 3 pushes :VERSION-<arch> instead,
    # so the bundle would point at a tag that does not exist until
    # merge-manifests.sh has run.
    if [[ -n "${TAG_SUFFIX:-}" ]]; then
      echo "  ⚠ TAG_SUFFIX=${TAG_SUFFIX} is set: images push as :${VERSION}${TAG_SUFFIX}, but the" >&2
      echo "    bundle references :${VERSION} — merge the manifest lists before installing." >&2
    fi

    BUNDLE_DIR=$(mktemp -d)
    BUNDLE=$(mktemp /tmp/bundle-XXXXXX.tar.gz)
    trap 'rm -rf "$BUNDLE_DIR" "$BUNDLE"' EXIT

    # Copy static manifest files
    cp -r "${SCRIPT_DIR}/manifest/." "${BUNDLE_DIR}/"

    # Patch version in config.json
    local CONFIG="${BUNDLE_DIR}/config.json"
    local TMP_CONFIG="${BUNDLE_DIR}/config.json.tmp"
    jq --arg v "$VERSION" '.version = $v' "$CONFIG" > "$TMP_CONFIG" && mv "$TMP_CONFIG" "$CONFIG"

    # Generate docker-compose.json
    generate_compose "$REGISTRY" "$VERSION" > "${BUNDLE_DIR}/docker-compose.json"

    log "  config.json version: $(jq -r .version "$CONFIG")"
    log "  docker-compose.json: $(jq '.services | length' "${BUNDLE_DIR}/docker-compose.json") services"

    # Create .tar.gz (BUNDLE is outside BUNDLE_DIR, so no self-referencing)
    tar -czf "$BUNDLE" -C "$BUNDLE_DIR" .

    log "  Bundle size: $(du -h "$BUNDLE" | cut -f1)"
    log ""
  else
    log "=== Step 1: Prepare app bundle (SKIPPED) ==="
    log "  The ci-memory catalog entry is published by CI-Marketplace."
    log ""
  fi

  # ── Step 2: Upload bundle (Phase 1) ────────────────────────────────
  local RESULT HTTP_CODE BODY STATUS
  if [[ "$PORTAL_ENABLED" == "true" ]]; then
    log "=== Step 2: Upload bundle → pending ==="

    # Non-fatal: a connection error (curl exits non-zero) or non-200 must not
    # abort the run — we degrade to image-only publish.
    RESULT=$(curl $CURL_OPTS -w '\n%{http_code}' -X POST "${PORTAL_API}/store/ingest" \
      -H "x-admin-key: ${ADMIN_KEY}" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@${BUNDLE}" 2>/dev/null) || RESULT=""

    HTTP_CODE=$(echo "$RESULT" | tail -1)
    BODY=$(echo "$RESULT" | sed '$d')
    STATUS=$(echo "$BODY" | jq -r '.status // empty' 2>/dev/null || echo "")

    if [[ "$HTTP_CODE" == "200" && "$STATUS" == "pending" ]]; then
      log "  HTTP ${HTTP_CODE} — status: pending"
    else
      log "  ⚠ Portal ingest failed (HTTP ${HTTP_CODE:-none}) at ${PORTAL_API}"
      log "    Skipping catalog registration — images will still be pushed."
      PORTAL_ENABLED=false
      PORTAL_SKIP_REASON='Portal ingest failed'
    fi
    log ""
  else
    log "=== Step 2: Upload bundle → pending (SKIPPED — ${PORTAL_SKIP_REASON}) ==="
    log ""
  fi

  # ── Step 3: Tag and push images ────────────────────────────────────
  if is_true "${SKIP_IMAGE_PUSH:-}"; then
    log "=== Step 3: Tag and push Docker images (SKIPPED) ==="
    log "  SKIP_IMAGE_PUSH is set — assuming images already exist in ${REGISTRY}"
    log ""
  else
    log "=== Step 3: Tag and push Docker images ==="

    # Resolve registry credentials. Prefer explicit REGISTRY_USERNAME /
    # REGISTRY_PASSWORD, but fall back to GITHUB_TOKEN (with GITHUB_ACTOR or a
    # default username) so this script can run unmodified inside GitHub Actions.
    local REG_USER REG_PASS
    if [[ -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]]; then
      REG_USER="${REGISTRY_USERNAME}"
      REG_PASS="${REGISTRY_PASSWORD}"
    elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
      REG_USER="${GITHUB_ACTOR:-github-actions}"
      REG_PASS="${GITHUB_TOKEN}"
    else
      fail "Registry credentials not set: provide REGISTRY_USERNAME and REGISTRY_PASSWORD, or GITHUB_TOKEN"
    fi

    logn "  Logging in to ${REGISTRY} as ${REG_USER} … "
    local LOGIN_OUTPUT
    if LOGIN_OUTPUT=$(echo "${REG_PASS}" | docker login "${REGISTRY}" -u "${REG_USER}" --password-stdin 2>&1); then
      log "✓"
    else
      log "✗"
      echo "$LOGIN_OUTPUT" >&2
      fail "docker login to ${REGISTRY} failed"
    fi

    # MISSING is a comma-joined string, not an array: images.sh keeps this
    # script bash-3.2 compatible, where `${#arr[@]}` on an empty array trips
    # `set -u`.
    local PUSH_FAILED=0 PUSH_SKIPPED=0 PUSH_COUNT=0 MISSING=''
    for i in $(seq 0 $((${#IMAGE_LOCAL[@]} - 1))); do
      local LOCAL_IMAGE="${IMAGE_LOCAL[$i]}"
      local REPO="${IMAGE_REMOTE[$i]}"
      local REMOTE="${REGISTRY}/${REPO}:${VERSION}${TAG_SUFFIX:-}"

      # Check local image exists. `make production` builds images tagged
      # :latest, which we then re-tag as ${REMOTE} (i.e. :${VERSION}) below.
      if ! docker image inspect "${LOCAL_IMAGE}:latest" > /dev/null 2>&1; then
        log "  ⚠ ${LOCAL_IMAGE}:latest not found locally — skipping"
        PUSH_SKIPPED=$((PUSH_SKIPPED + 1))
        MISSING="${MISSING}${MISSING:+, }${LOCAL_IMAGE}"
        continue
      fi

      logn "  ${LOCAL_IMAGE}:latest → ${REMOTE} … "

      docker image tag "${LOCAL_IMAGE}:latest" "${REMOTE}"
      if PUSH_OUTPUT=$(docker image push "${REMOTE}" 2>&1); then
        log "✓"
        PUSH_COUNT=$((PUSH_COUNT + 1))
      else
        log "✗"
        echo "$PUSH_OUTPUT" >&2
        PUSH_FAILED=$((PUSH_FAILED + 1))
      fi
    done

    if [[ $PUSH_FAILED -gt 0 ]]; then
      fail "${PUSH_FAILED} image(s) failed to push"
    fi

    # Any image missing locally is not a publish — it is a build that never
    # ran, and ci-memory is the whole image set, so a partial push yields an
    # app that cannot start. Checking only for a completely empty run would
    # still green-light the tag pipeline whenever 1..n-1 images are missing,
    # surfacing later as an opaque "manifest create failed" in
    # merge-manifests.sh (or, worse, a published version whose manifest list
    # references tags that were never pushed).
    if [[ $PUSH_SKIPPED -gt 0 ]]; then
      fail "${PUSH_SKIPPED} of ${#IMAGE_LOCAL[@]} image(s) do not exist locally (${MISSING}) — run 'make build ENV=production' first"
    fi

    log "  Pushed: ${PUSH_COUNT}, skipped: ${PUSH_SKIPPED}"
    log ""
  fi

  # ── Step 4: Publish (Phase 3) ──────────────────────────────────────
  if [[ "$PORTAL_ENABLED" == "true" ]]; then
    log "=== Step 4: Publish → published ==="

    RESULT=$(curl $CURL_OPTS -w '\n%{http_code}' -X POST \
      "${PORTAL_API}/store/publish/${SLUG}" \
      -H "x-admin-key: ${ADMIN_KEY}" 2>/dev/null) || RESULT=""

    HTTP_CODE=$(echo "$RESULT" | tail -1)
    BODY=$(echo "$RESULT" | sed '$d')
    STATUS=$(echo "$BODY" | jq -r '.status // empty' 2>/dev/null || echo "")

    if [[ "$HTTP_CODE" == "200" && "$STATUS" == "published" ]]; then
      log "  ✓ ${SLUG}@${VERSION} published!"
    else
      log "  ⚠ Portal publish failed (HTTP ${HTTP_CODE:-none}) — images are pushed but the catalog entry was not finalized."
      PORTAL_ENABLED=false
      PORTAL_SKIP_REASON='Portal publish failed'
    fi
    log ""
  else
    log "=== Step 4: Publish → published (SKIPPED — ${PORTAL_SKIP_REASON}) ==="
    log ""
  fi

  # ── Step 5: Verify / summary ───────────────────────────────────────
  # The summary must describe what actually happened, on every path:
  # SKIP_IMAGE_PUSH pushes nothing, and TAG_SUFFIX means the pushed tag is the
  # per-arch one, not bare ${VERSION} — which is an image tag, not a different
  # app version, so keep the two apart in the wording.
  local IMAGE_SUMMARY
  if is_true "${SKIP_IMAGE_PUSH:-}"; then
    IMAGE_SUMMARY="✓ ${SLUG}@${VERSION}: image push skipped (SKIP_IMAGE_PUSH is set)."
  elif [[ -n "${TAG_SUFFIX:-}" ]]; then
    IMAGE_SUMMARY="✓ Images for ${SLUG}@${VERSION} pushed to ${REGISTRY} as :${VERSION}${TAG_SUFFIX}."
  else
    IMAGE_SUMMARY="✓ Images for ${SLUG}@${VERSION} pushed to ${REGISTRY}."
  fi

  if [[ "$PORTAL_ENABLED" == "true" ]]; then
    if ! $QUIET; then
      echo "=== Step 5: Verify store listing ==="
      curl $CURL_OPTS "${PORTAL_API}/store/${SLUG}" | jq '.' 2>/dev/null \
        || echo "  (listing endpoint returned non-JSON — but publish succeeded)"
      echo ""
      # Not "published to ${REGISTRY}": with SKIP_IMAGE_PUSH set nothing was
      # pushed there, and the catalog entry went to the Portal either way.
      echo "$IMAGE_SUMMARY"
      echo "✓ ${SLUG}@${VERSION} published to the catalog at ${PORTAL_API}"
    else
      echo "  ✓ ${SLUG}@${VERSION}"
    fi
  elif [[ "$PORTAL_REQUESTED" == "true" ]]; then
    # Opted in and it did not happen. The images are already pushed, so the
    # "a broken Portal must not abort the push" rule is satisfied — but the run
    # did not do what it was asked to, so it must not report success.
    echo "$IMAGE_SUMMARY"
    echo "  ✗ PUBLISH_TO_PORTAL is set, but the catalog registration did not complete — see the warnings above." >&2
    exit 1
  else
    echo "$IMAGE_SUMMARY"
    echo "  Bump apps/ci-memory in CI-Marketplace to put this version in the catalog."
  fi
}

main "$@"
