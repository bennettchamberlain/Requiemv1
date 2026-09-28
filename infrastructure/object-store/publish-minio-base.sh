#!/usr/bin/env bash
# Publish the MinIO base image this Dockerfile builds FROM to a registry we
# control, for both architectures publish.yml builds (amd64, arm64).
#
# WHY THIS EXISTS
# MinIO stopped distributing its community edition as an image. docker.io/
# minio/minio was archived and denies every pull; quay.io/minio/minio, which
# this Dockerfile moved to in September 2026, was deleted by MinIO shortly after
# (every tag "no such manifest" on 2026-09-28); ghcr.io/minio/minio never
# existed; dl.min.io answers 410 Gone; the GitHub repo says "NO LONGER
# MAINTAINED" and "distributed as source code only". There is no upstream
# location to point FROM at any more.
#
# WHERE THE BYTES COME FROM
# Our own already-published companion/object-store image. It is exactly the
# upstream MinIO image plus the two COPY layers this Dockerfile adds, with
# ENTRYPOINT/CMD overridden on top (verified 2026-09-28 by `docker history` on
# both arch variants of :2026.9.10). So this script pulls each arch variant,
# drops those two layers and the four history rows they came with (COPY, COPY,
# ENTRYPOINT, CMD), restores MinIO's own ENTRYPOINT/CMD, and pushes the result.
# The root filesystem diff_ids are the upstream ones untouched; only the
# compressed-blob digests differ, because `docker push` re-gzips.
#
# The version it publishes is read from the Dockerfile's MINIO_VERSION ARG,
# and each source variant's `release` label must equal it — a mismatched
# source image fails loudly rather than tagging the wrong release.
#
# Usage:
#   infrastructure/object-store/publish-minio-base.sh
#
#   SOURCE_IMAGE  companion/object-store image to extract from
#                 [ghcr.io/companionintelligence/companion/object-store:2026.9.10]
#   TARGET_REPO   where to push [ghcr.io/companionintelligence/companion/minio]
#   DRY_RUN=1     do everything except push (the loaded per-arch images and
#                 OCI tars stay local for inspection)
#
# Needs `docker login ghcr.io` beforehand. A package pushed from a workstation
# is PRIVATE by default: make it public in the GitHub package settings, as the
# HBPE wheel images were, or every `make build` on a fresh machine and the
# publish workflow's build legs need registry auth just to pull the base.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

dockerfile="infrastructure/object-store/Dockerfile"
source_image="${SOURCE_IMAGE:-ghcr.io/companionintelligence/companion/object-store:2026.9.10}"
target_repo="${TARGET_REPO:-ghcr.io/companionintelligence/companion/minio}"
dry_run="${DRY_RUN:-}"

minio_version="$(sed -n 's/^ARG MINIO_VERSION=//p' "$dockerfile")"
: "${minio_version:?could not read ARG MINIO_VERSION from $dockerfile}"

work="$(mktemp -d -t minio-base.XXXXXX)"
trap 'rm -rf "$work"' EXIT

for tool in docker python3 jq; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool is required" >&2; exit 1; }
done

# Rewrite one `docker save` tar into an OCI-layout tar of the base image.
# Python only for its tarfile/json/hashlib; no third-party modules.
cat >"$work/strip.py" <<'PY'
import hashlib, io, json, sys, tarfile

src, dst, arch, want_release = sys.argv[1:5]
STRIP_LAYERS, STRIP_HISTORY = 2, 4

with tarfile.open(src) as t:
    index = json.load(t.extractfile("index.json"))
    assert len(index["manifests"]) == 1, "expected exactly one image in the save tar"
    def blob(d): return t.extractfile("blobs/sha256/" + d.split(":", 1)[1]).read()
    manifest = json.loads(blob(index["manifests"][0]["digest"]))
    if manifest.get("mediaType", "").endswith("index.v1+json"):   # nested index
        assert len(manifest["manifests"]) == 1
        manifest = json.loads(blob(manifest["manifests"][0]["digest"]))
    config = json.loads(blob(manifest["config"]["digest"]))

    assert config["architecture"] == arch, config["architecture"]
    release = config["config"].get("Labels", {}).get("release")
    assert release == want_release, f"source image is {release}, Dockerfile pins {want_release}"

    hist = config["history"]
    tail = [h.get("created_by", "") for h in hist[-STRIP_HISTORY - 2:]]
    expect = ['ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]', 'CMD ["minio"]',
              "COPY LICENSE.md /LICENSE.md", "COPY --chmod=755 entrypoint.sh", "ENTRYPOINT", "CMD"]
    for got, exp in zip(tail, expect):
        assert got.startswith(exp), f"history does not match the Dockerfile: {got!r} vs {exp!r}"

    layers = manifest["layers"][:-STRIP_LAYERS]
    config["rootfs"]["diff_ids"] = config["rootfs"]["diff_ids"][:-STRIP_LAYERS]
    config["history"] = hist[:-STRIP_HISTORY]
    config["config"]["Entrypoint"] = ["/usr/bin/docker-entrypoint.sh"]
    config["config"]["Cmd"] = ["minio"]
    assert len(layers) == len(config["rootfs"]["diff_ids"])

    cfg = json.dumps(config, separators=(",", ":")).encode()
    cfg_dig = "sha256:" + hashlib.sha256(cfg).hexdigest()
    man = json.dumps({
        "schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": cfg_dig, "size": len(cfg)},
        "layers": layers}, separators=(",", ":")).encode()
    man_dig = "sha256:" + hashlib.sha256(man).hexdigest()
    idx = json.dumps({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
                      "manifests": [{"mediaType": "application/vnd.oci.image.manifest.v1+json",
                                     "digest": man_dig, "size": len(man),
                                     "platform": {"architecture": arch, "os": "linux"}}]}).encode()

    # `docker load` on the classic (graphdriver) image store ignores the OCI
    # index and refuses a tar without this legacy manifest.json, exactly as
    # `docker save` itself writes it: blob paths, plus LayerSources for the
    # containerd store. RepoTags stays null; the caller tags by image ID.
    legacy = json.dumps([{"Config": "blobs/sha256/" + cfg_dig[7:], "RepoTags": None,
                          "Layers": ["blobs/sha256/" + l["digest"][7:] for l in layers],
                          "LayerSources": {l["digest"]: l for l in layers}}]).encode()

    def add(out, name, data):
        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = 0o644
        out.addfile(ti, io.BytesIO(data))
    with tarfile.open(dst, "w") as out:
        add(out, "oci-layout", b'{"imageLayoutVersion":"1.0.0"}')
        add(out, "index.json", idx)
        add(out, "manifest.json", legacy)
        add(out, "blobs/sha256/" + cfg_dig[7:], cfg)
        add(out, "blobs/sha256/" + man_dig[7:], man)
        for l in layers:
            m = t.getmember("blobs/sha256/" + l["digest"][7:])
            out.addfile(m, t.extractfile(m))
# The loaded image's ID is the config digest; print it for the caller.
print(cfg_dig)
PY

echo "Source:  $source_image"
echo "Target:  $target_repo:$minio_version"
echo

mapfile -t variants < <(docker manifest inspect "$source_image" \
  | jq -r '.manifests[] | select(.platform.os == "linux" and .platform.architecture != "unknown")
           | "\(.platform.architecture) \(.digest)"')
[ "${#variants[@]}" -gt 0 ] || { echo "ERROR: $source_image is not a multi-arch manifest list" >&2; exit 1; }

source_repo="${source_image%%:*}"
source_repo="${source_repo%%@*}"
pushed=()
for v in "${variants[@]}"; do
  arch="${v%% *}"; digest="${v##* }"
  echo "── $arch ($digest)"
  docker pull -q "$source_repo@$digest" >/dev/null
  image_id="$(docker inspect --format '{{.Id}}' "$source_repo@$digest")"
  docker save "$image_id" -o "$work/source-$arch.tar"
  base_id="$(python3 "$work/strip.py" "$work/source-$arch.tar" "$work/minio-$arch.tar" "$arch" "$minio_version")"
  docker load -q -i "$work/minio-$arch.tar" >/dev/null
  arch_ref="$target_repo:$minio_version-linux-$arch"
  docker tag "$base_id" "$arch_ref"
  docker inspect --format '   layers: {{len .RootFS.Layers}}  entrypoint: {{json .Config.Entrypoint}}  release: {{index .Config.Labels "release"}}' "$arch_ref"
  if [ -n "$dry_run" ]; then
    echo "   DRY_RUN: not pushing $arch_ref (tar kept at $work/minio-$arch.tar)"
    continue
  fi
  docker push -q "$arch_ref" >/dev/null
  pushed_digest="$(docker manifest inspect -v "$arch_ref" | jq -r '.Descriptor.digest')"
  echo "   pushed $arch_ref@$pushed_digest"
  pushed+=("$target_repo@$pushed_digest")
done

if [ -n "$dry_run" ]; then
  trap - EXIT
  echo; echo "DRY_RUN: per-arch images are loaded locally; work dir kept at $work"
  exit 0
fi

echo; echo "── manifest list"
docker buildx imagetools create -t "$target_repo:$minio_version" "${pushed[@]}"
docker manifest inspect "$target_repo:$minio_version" \
  | jq -r '.manifests[] | "   \(.platform.os)/\(.platform.architecture)  \(.digest)"'
index_digest="$(docker manifest inspect -v "$target_repo:$minio_version" | jq -r 'if type=="array" then .[0].Descriptor.digest else .Descriptor.digest end' 2>/dev/null || true)"
echo
echo "Published $target_repo:$minio_version"
[ -n "$index_digest" ] && echo "Index digest (for a by-digest pin): $index_digest"
echo "Now make the package public: https://github.com/orgs/companionintelligence/packages/container/companion%2Fminio/settings"
