#!/usr/bin/env bash
# Build a flash-attn wheel matching Dockerfile.cuda, and export it to ./dist.
#
# WHY THIS EXISTS
# Dockerfile.cuda pins torch 2.13.0 on CUDA 12.9, and Dao-AILab publishes no
# flash-attn wheel for that combination — checked 2026-08-10: v2.8.3.post1 is
# the newest FA2 release and its 50 wheels span torch 2.4-2.9 only, the lone
# cu13/torch2.9 build is cp312 while this image is cp311, and everything newer
# on the releases page is an fa4-v4.0.0 beta shipping no arch wheels at all.
# So the image compiles flash-attn from source on every build (~71 min at 6
# jobs, measured). Build the wheel once with this script, host it, and pass it
# back as --build-arg FLASH_ATTN_WHEEL=<url> to skip the compile entirely.
#
# HOW IT AVOIDS DRIFT
# A wheel is married to four things — python, torch version, CUDA major, and
# torch's C++11 ABI flag — and gets them wrong silently: a mismatch installs
# cleanly and only fails at `import flash_attn_2_cuda`. So this does not
# reproduce Dockerfile.cuda's setup; it SPLICES the real file, taking everything
# above the compile-job-budget banner (base image, python, uv sync, torch) and
# appending only a wheel-build step. Edit Dockerfile.cuda and this follows.
#
# Usage:
#   ./build-flash-attn-wheel.sh
#   FLASH_ATTN_LOCAL_VERSION=cu12torch2.13cxx11abiTRUE ./build-flash-attn-wheel.sh
#
# FLASH_ATTN_LOCAL_VERSION stamps the +cu12torch... tag into both the filename
# and the METADATA. Without it a forced source build emits a plain
# flash_attn-<ver>-cp311-cp311-linux_x86_64.whl, because setup.py applies that
# tag only on its download path. Renaming the file afterwards does NOT work —
# pip compares the filename version against METADATA and rejects the mismatch.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

dockerfile="backend/apps/hbpe/Dockerfile.cuda"
marker="# ── Shared compile-job budget ─"
out_dir="${OUT_DIR:-backend/apps/hbpe/dist}"
gen="$(mktemp -t Dockerfile.wheel.XXXXXX)"
trap 'rm -f "$gen"' EXIT

uv_version="$(sed -n 's/^required-version = "==\(.*\)"$/\1/p' pyproject.toml)"
flash_attn_version="$(sed -n 's/^FLASH_ATTN_VERSION := *//p' Makefile)"
: "${uv_version:?could not read required-version from pyproject.toml}"
: "${flash_attn_version:?could not read FLASH_ATTN_VERSION from Makefile}"

# Everything above the marker, with the main stage named so later stages can
# reference it. Fails loudly rather than silently producing a truncated file if
# the banner is ever reworded.
grep -qF "$marker" "$dockerfile" || {
  echo "ERROR: marker not found in $dockerfile: $marker" >&2
  echo "       The file was restructured; update \$marker in this script." >&2
  exit 1
}
awk -v m="$marker" 'index($0, m) {exit} {print}' "$dockerfile" \
  | sed 's|^FROM nvidia/cuda:\(.*\)$|FROM nvidia/cuda:\1 AS builder|' > "$gen"

grep -q "AS builder" "$gen" || { echo "ERROR: failed to name the builder stage" >&2; exit 1; }

cat >> "$gen" <<'DOCKERFILE'

# ── flash-attn wheel build ────────────────────────────────────────────────────
# The llama-cpp step is deliberately absent: it binds none of the four
# dimensions above and would cost a compile of its own.
ARG MAX_JOBS
ARG BUILD_RESERVE_GIB=16
ARG GIB_PER_JOB
ARG FLASH_ATTN_VERSION
ARG FLASH_ATTN_LOCAL_VERSION=""
ARG NVCC_THREADS=1
ARG TORCH_CUDA_ARCH_LIST="8.6;8.9;12.0"
COPY --chmod=755 backend/apps/hbpe/derive-build-jobs.sh /usr/local/bin/derive-build-jobs

# FLASH_ATTENTION_FORCE_BUILD, because setup.py overrides bdist_wheel with
# CachedWheelsCommand, which urlretrieves a prebuilt wheel first and only falls
# back to source on HTTPError. That guess 404s for torch 2.13 today, so the
# fallback would fire anyway — but the point of this build is to produce the
# wheel that does not exist, and quietly repackaging someone else's binary if
# the matrix ever fills in is the wrong outcome to get by accident.
#
# Keep the job budget identical to Dockerfile.cuda's flash-attn step (4 GiB per
# job, aggregate). See the measurement notes there before changing it.
RUN set -eu; \
    jobs="$(derive-build-jobs flash-attn 4)"; \
    : "${NVCC_THREADS:?refusing to build empty — setup.py reads this as \`getenv(...) or \"4\"\`}"; \
    supported="$(nvcc --list-gpu-arch | sed 's/compute_\(.*\)\(.\)$/\1.\2/')"; \
    kept=""; \
    for arch in $(echo "$TORCH_CUDA_ARCH_LIST" | tr ';' ' '); do \
      if echo "$supported" | grep -qx "$arch"; then kept="${kept:+$kept;}$arch"; \
      else echo "WARNING: dropping CUDA arch $arch — unsupported by this nvcc"; fi; \
    done; \
    [ -n "$kept" ] || { echo "ERROR: no requested CUDA arch supported"; exit 1; }; \
    echo "flash-attn wheel: arch=$kept MAX_JOBS=$jobs NVCC_THREADS=${NVCC_THREADS}" \
         "LOCAL_VERSION=${FLASH_ATTN_LOCAL_VERSION:-<none>}"; \
    export MAX_JOBS="$jobs" NVCC_THREADS="${NVCC_THREADS}" TORCH_CUDA_ARCH_LIST="$kept" \
           FLASH_ATTENTION_FORCE_BUILD=TRUE; \
    if [ -n "${FLASH_ATTN_LOCAL_VERSION:-}" ]; then \
      export FLASH_ATTN_LOCAL_VERSION; \
    fi; \
    uv pip install --no-cache psutil ninja pip setuptools wheel; \
    mkdir -p /tmp/wheels; \
    python -m pip wheel --no-cache-dir --no-build-isolation --no-deps \
      "flash-attn==${FLASH_ATTN_VERSION:?set by build-flash-attn-wheel.sh}" -w /tmp/wheels; \
    ls -la /tmp/wheels

# Install the wheel into the very environment it must match and import the
# COMPILED extension. flash_attn alone is not enough — the undefined-symbol
# failure lives in flash_attn_2_cuda, which is what a mismatch breaks.
FROM builder AS verify
RUN set -eu; \
    uv pip install --no-cache /tmp/wheels/*.whl; \
    python - <<'PY'
import sys, torch, flash_attn, flash_attn_2_cuda
print("VERIFY_OK")
print("  flash_attn", flash_attn.__version__)
print("  torch     ", torch.__version__)
print("  cuda      ", torch.version.cuda)
print("  cxx11abi  ", str(torch._C._GLIBCXX_USE_CXX11_ABI).upper())
print("  python     %d.%d" % sys.version_info[:2])
PY

FROM scratch AS wheelout
COPY --from=builder /tmp/wheels/ /
DOCKERFILE

common=(
  -f "$gen"
  --build-arg "UV_VERSION=$uv_version"
  --build-arg "FLASH_ATTN_VERSION=$flash_attn_version"
  --build-arg "FLASH_ATTN_LOCAL_VERSION=${FLASH_ATTN_LOCAL_VERSION:-}"
  --progress=plain
)

echo "==> flash-attn $flash_attn_version, uv $uv_version, local version '${FLASH_ATTN_LOCAL_VERSION:-<none>}'"
echo "==> verifying the wheel imports before exporting it"
docker buildx build "${common[@]}" --target verify .

mkdir -p "$out_dir"
echo "==> exporting to $out_dir"
docker buildx build "${common[@]}" --target wheelout --output "type=local,dest=$out_dir" .

ls -la "$out_dir"
