#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_SCRIPT="${SCRIPT_DIR}/ci-server.sh"
readonly GREEN_COLOR=$'\033[0;32m'

new_tmp_file() {
  local out
  out="$(mktemp)"
  TMP_TEST_FILES+=("${out}")
  echo "${out}"
}

assert_contains() {
  local haystack_file="$1"
  local needle="$2"
  local message="$3"

  if ! grep -Fq -- "${needle}" "${haystack_file}"; then
    echo "FAIL: ${message}"
    echo "Expected to find: ${needle}"
    echo "Output:"
    cat "${haystack_file}"
    exit 1
  fi
}

test_wizard_shows_green_company_name() {
  local out
  out="$(new_tmp_file)"
  printf '8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out}" 2>&1

  assert_contains "${out}" "COMPANION INTELLIGENCE" "wizard should show company name"
  assert_contains "${out}" "${GREEN_COLOR}" "wizard should start banner in green"
  assert_contains "${out}" "Exiting wizard." "wizard should exit cleanly"
}

test_wizard_invalid_selection_feedback() {
  local out
  out="$(new_tmp_file)"
  printf '99\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out}" 2>&1

  assert_contains "${out}" "Invalid selection '99'. Enter a number between 1 and 8." "wizard should provide clear invalid-selection message"
  assert_contains "${out}" "wizard> " "wizard should use improved prompt"
}

test_wizard_allows_multiple_actions() {
  local out
  out="$(new_tmp_file)"
  printf '7\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out}" 2>&1

  assert_contains "${out}" "CI-Server CLI" "wizard help action should print CLI usage"
  assert_contains "${out}" "Select another action or choose Exit." "wizard should keep user in menu after action"
}

test_wizard_shows_dry_run_mode() {
  local out
  out="$(new_tmp_file)"
  printf '8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out}" 2>&1

  assert_contains "${out}" "Mode: dry-run (no changes will be applied)" "wizard should show dry-run mode indicator"
}

main() {
  TMP_TEST_FILES=()
  trap 'rm -f "${TMP_TEST_FILES[@]:-}"' EXIT

  test_wizard_shows_green_company_name
  test_wizard_invalid_selection_feedback
  test_wizard_allows_multiple_actions
  test_wizard_shows_dry_run_mode
  echo "All CLI wizard tests passed."
}

main
