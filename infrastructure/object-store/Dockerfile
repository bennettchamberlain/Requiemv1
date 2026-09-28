# Pinned like every other base image in this repo (postgres:18.4-bookworm,
# nginx:1.28.0-bookworm, node:22.15.1-slim). Untagged, this resolved to
# whatever :latest happened to be on the build host, so an appliance rebuild
# could silently swap the object store under live data — and MinIO has shipped
# behaviour-changing releases (the admin console was removed mid-2025) that
# would land without anyone choosing them.
#
# MinIO's only version scheme is the RELEASE.<timestamp> tag; there is no
# semver tag to use instead. Override MINIO_VERSION to move the pin
# deliberately, and re-verify the object store still boots after doing so.
#
# Pulled from OUR registry, not MinIO's. MinIO no longer distributes the
# community edition as an image anywhere: docker.io/minio/minio is archived
# and denies every pull, quay.io/minio/minio (which this file moved to in
# September 2026) was deleted by MinIO weeks later — every tag, this pin and
# :latest included, answers "no such manifest" as of 2026-09-28 — ghcr.io/
# minio/minio never existed, dl.min.io answers 410 Gone, and the GitHub repo
# now reads "NO LONGER MAINTAINED ... distributed as source code only".
#
# companion/minio is the upstream image for this RELEASE, both amd64 and
# arm64, extracted from the base layers of our already-published
# companion/object-store image by publish-minio-base.sh (next to this file).
# Its rootfs diff_ids are the upstream ones untouched. To move the pin you
# would need upstream bytes for the new release, and there are none to pull:
# RELEASE.2025-10-15T17-29-55Z was the last community release and everything
# after it is the paid product. Moving forward means building from source or
# switching base (cgr.dev/chainguard/minio is built from source but publishes
# only :latest on its free tier), and either way re-verifying the object
# store still boots.
#
# Any registry override must carry the same RELEASE tags; the version pin
# stays the single ARG the publish script reads back out.
ARG MINIO_VERSION=RELEASE.2025-04-22T22-12-26Z
ARG MINIO_IMAGE=ghcr.io/companionintelligence/companion/minio
FROM ${MINIO_IMAGE}:${MINIO_VERSION}

COPY LICENSE.md /LICENSE.md
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# ──────────────────────────────────────────────────
# Environment Variables
#
# Secrets are loaded from a shared secrets file or
# from environment variables set by Docker Compose.
#
# Required (no default — will not start without these):
#   PASSWORD                   MinIO root secret key
#   USERNAME                   MinIO root access key
#
# Optional:
#   SECRETS_FILE               Path to secrets file [/run/secrets/.env.secrets]
# ──────────────────────────────────────────────────

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

CMD ["server", "/data/objects", "--console-address", ":9001"]
