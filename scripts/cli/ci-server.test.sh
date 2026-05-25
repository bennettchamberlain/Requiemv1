#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_SCRIPT="${SCRIPT_DIR}/ci-server.sh"
readonly GREEN=$'\033[0;32m'

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
  assert_contains "${out}" "${GREEN}" "wizard should start banner in green"
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

test_wizard_major_sections_dispatch() {
  local out_setup_hub out_register out_setup_mcp out_status out_shutdown out_help

  out_setup_hub="$(new_tmp_file)"
  printf '1\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out_setup_hub}" 2>&1
  assert_contains "${out_setup_hub}" "== Setup Hub ==" "wizard should label setup hub section"
  assert_contains "${out_setup_hub}" "DRY-RUN: make -C" "wizard setup hub should run through dry-run command path"
  assert_contains "${out_setup_hub}" " init" "wizard setup hub should include init action"
  assert_contains "${out_setup_hub}" " local" "wizard setup hub should include local action"
  assert_contains "${out_setup_hub}" " seed" "wizard setup hub should include seed action"

  out_register="$(new_tmp_file)"
  printf '2\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out_register}" 2>&1
  assert_contains "${out_register}" "== Register with Cloud Portal ==" "wizard should label register section"
  assert_contains "${out_register}" " publish" "wizard register should include publish action"

  out_setup_mcp="$(new_tmp_file)"
  printf '3\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out_setup_mcp}" 2>&1
  assert_contains "${out_setup_mcp}" "== Setup MCP ==" "wizard should label setup mcp section"
  assert_contains "${out_setup_mcp}" " tooling" "wizard setup mcp should include tooling action"
  assert_contains "${out_setup_mcp}" "MCP tooling services started." "wizard setup mcp should print completion message"

  out_status="$(new_tmp_file)"
  printf '4\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out_status}" 2>&1
  assert_contains "${out_status}" "== App Lifecycle (status) ==" "wizard should label app status section"
  assert_contains "${out_status}" " docker compose " "wizard app status should use docker compose command"
  assert_contains "${out_status}" " ps" "wizard app status should call ps action"

  out_shutdown="$(new_tmp_file)"
  printf '5\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out_shutdown}" 2>&1
  assert_contains "${out_shutdown}" "== Shutdown Services ==" "wizard should label shutdown section"
  assert_contains "${out_shutdown}" " stop" "wizard shutdown should include stop action"

  out_help="$(new_tmp_file)"
  printf '7\n8\n' | "${CLI_SCRIPT}" --dry-run wizard >"${out_help}" 2>&1
  assert_contains "${out_help}" "== Show Help ==" "wizard should label help section"
  assert_contains "${out_help}" "CI-Server CLI" "wizard help section should display CLI help"
}

main() {
  TMP_TEST_FILES=()
  trap '
    if ((${#TMP_TEST_FILES[@]} > 0)); then
      rm -f "${TMP_TEST_FILES[@]}"
    fi
  ' EXIT

  test_wizard_shows_green_company_name
  test_wizard_invalid_selection_feedback
  test_wizard_allows_multiple_actions
  test_wizard_shows_dry_run_mode
  test_wizard_major_sections_dispatch
  echo "All CLI wizard tests passed."
}

main
