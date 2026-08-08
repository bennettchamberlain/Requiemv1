#!/bin/sh
# Guard for the PEP 420 `ci` namespace.
#
# `ci` is a namespace package that no single member owns: every member ships
# src/ci/<name>/ and NO src/ci/__init__.py. A regular __init__.py there makes
# that member claim the whole `ci` package, so every other ci.* member stops
# importing, and the failure surfaces as an unrelated-looking ImportError in
# whichever service loads second. See the root pyproject.toml.
#
# Called two ways, matching the check-migration-versions.js pattern:
# lint-staged passes the staged offending files as arguments, and make lint
# calls it with no arguments so it scans the tree itself.

set -eu

if [ "$#" -gt 0 ]; then
    offenders="$*"
else
    offenders=$(find backend -name node_modules -prune -o -type f -path '*/src/ci/__init__.py' -print)
fi

[ -z "$offenders" ] && exit 0

{
    printf 'The ci namespace must not contain an __init__.py:\n'
    printf '    %s\n' $offenders
    printf 'ci is a PEP 420 namespace shared by every workspace member; a regular\n'
    printf '__init__.py there breaks every other ci.* import. Delete the file and\n'
    printf 'keep modules inside src/ci/<member>/.\n'
} >&2
exit 1
