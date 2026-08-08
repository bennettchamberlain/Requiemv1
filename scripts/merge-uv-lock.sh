#!/bin/sh
# Git merge driver for uv.lock, plus its own registration.
#
# uv.lock is generated from the manifests, so the correct merge is never a
# textual one: take either side whole, then run `uv lock` to reconcile it
# with the merged manifests. This driver automates the first half. It keeps
# the current side's lockfile and lets the merge complete without conflict
# markers, printing a reminder to relock.
#
# It deliberately does NOT run `uv lock` here: a merge driver fires while
# the working tree is still being assembled, so the manifests on disk can
# predate the merge and the regenerated lock would be plausible but wrong.
# A forgotten relock is caught by the `uv lock --check` gates in
# `make lint`, `make build`, and CI.
#
# Git config is per-clone and not versioned, so the driver registers itself:
# the yarn `prepare` script runs `--register` on every install, which is
# what makes the `merge=uv-lock` attribute in .gitattributes take effect.

set -eu

if [ "${1:-}" = "--register" ]; then
    # Registration is skipped outside a git work tree (e.g. the production
    # image build runs yarn install without a repository).
    git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
    git config merge.uv-lock.name "keep current side, then run uv lock"
    git config merge.uv-lock.driver "sh scripts/merge-uv-lock.sh %O %A %B"
    exit 0
fi

# Driver mode. Git passes %O (ancestor), %A (current side), %B (other side)
# and expects the result in %A; exit 0 accepts it as merged. Leaving %A
# untouched keeps the current side.
printf '%s\n' \
    "uv.lock: conflict auto-resolved by keeping this branch's lockfile." \
    "Run 'uv lock' to reconcile it with the merged manifests." >&2
exit 0
