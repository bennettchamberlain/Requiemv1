#!/usr/bin/env bash
set -euo pipefail

# ── HBPE GPU Detection ──────────────────────────────────────────────────
#
# Picks which HBPE Dockerfile variant (backend/apps/hbpe/Dockerfile.*)
# matches the GPU actually present on this host, so `make build`/`dev`/
# `staging`/`production` do not require the caller to already know their
# own hardware. Mirrors the probes CI-Hub's hardware-inspector.service.ts
# (detectRocmSupport / nvidia-smi detection) uses to classify a host, scoped
# down to a single vendor decision instead of a full hardware profile.
#
# Detection order (first match wins):
#   1. nvidia — `nvidia-smi` on PATH, or /dev/nvidia* device nodes present.
#   2. amd    — /dev/kfd + /dev/dri present (ROCm KFD driver passthrough),
#               or `rocminfo` on PATH.
#   3. cpu    — neither found.
#
# Prints exactly one of: cuda | rocm | cpu
#
# With --amdgpu-arch, prints this host's AMD gfx architecture instead (e.g.
# gfx1100 for an RX 7900, gfx1030 for a 6800/6900), or NOTHING when it cannot
# be determined. That is the value llama.cpp's HIP backend compiles for; see
# AMDGPU_TARGETS in backend/apps/hbpe/Dockerfile.rocm.
#
# Empty output is a deliberate answer, not a failure: the build then falls back
# to llama.cpp's own default target list. Guessing an architecture would be
# worse than not answering, because a wheel compiled for the wrong gfx loads
# fine and only fails when it looks for a device to run on.
#
# Usage:
#   scripts/detect-gpu.sh
#   GPU="$(scripts/detect-gpu.sh)"
#   AMDGPU_TARGETS="$(scripts/detect-gpu.sh --amdgpu-arch)"
#
# Consumed by the Makefile's `GPU ?= $(shell scripts/detect-gpu.sh)` default,
# which only runs this when the caller hasn't already passed GPU=cpu|cuda|rocm
# on the command line or environment.

has_nvidia_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 && return 0
  ls /dev/nvidia* >/dev/null 2>&1 && return 0
  return 1
}

has_rocm_gpu() {
  { [ -e /dev/kfd ] && [ -e /dev/dri ]; } && return 0
  command -v rocminfo >/dev/null 2>&1 && return 0
  return 1
}

# The gfx architecture of the first AMD GPU rocminfo reports, or nothing.
#
# rocminfo lists every HSA agent including the CPU, whose "Name" is a model
# string rather than a gfx target — hence matching gfx[0-9]* specifically and
# not merely the first Name: line. Discrete cards enumerate after the CPU, and
# an APU (a Ryzen with integrated graphics, gfx1036 on this class of chip) can
# enumerate alongside the discrete card, so a host with both gets whichever
# rocminfo lists first. Override AMDGPU_TARGETS explicitly on such a machine.
amdgpu_arch() {
  command -v rocminfo >/dev/null 2>&1 || return 0

  rocminfo 2>/dev/null \
    | sed -n 's/.*Name:[[:space:]]*\(gfx[0-9a-f]\{3,\}\).*/\1/p' \
    | head -1
}

if [ "${1:-}" = "--amdgpu-arch" ]; then
  amdgpu_arch
  exit 0
fi

if has_nvidia_gpu; then
  echo cuda
elif has_rocm_gpu; then
  echo rocm
else
  echo cpu
fi
