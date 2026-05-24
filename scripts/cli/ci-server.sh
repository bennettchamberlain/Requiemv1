#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null)"; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi
MAN_FILE="${REPO_ROOT}/docs/cli/ci-server-cli.md"
ENV_FILE="${REPO_ROOT}/.env"
ENV_KEY_REGEX='^[A-Za-z_][A-Za-z0-9_]*$'

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

print_company_banner() {
  printf '\033[0;32m'
  cat <<'EOF'
COMPANION INTELLIGENCE

 __   __         __               __
/  ` /  \  |\/| |__)  /\  |\ | | /  \ |\ |
\__, \__/  |  | |    /~~\ | \| | \__/ | \|

       ___  ___              __   ___       __   ___
| |\ |  |  |__  |    |    | / _` |__  |\ | /  ` |__
| | \|  |  |___ |___ |___ | \__> |___ | \| \__, |___
EOF
  printf '\033[0m\n'
}

usage() {
  cat <<'EOF'
CI-Server CLI

Usage:
  ci-server.sh [--dry-run] <command> [subcommand] [args]

Commands:
  help                                Show this help output
  man                                 Show the CLI manual
  wizard                              Launch the interactive wizard
  setup hub                           Initialize and start the local Hub
  setup mcp                           Start MCP-related tooling services
  register portal [--quiet]           Publish/register CI-Server to CI-Portal
  app start [service]                 Start all app services or one service
  app stop [service]                  Stop all app services or one service
  app restart [service]               Restart all app services or one service
  app status                          Show app container status
  app add <service>                   Start one service (add to running stack)
  app edit <service>                  Open compose file for editing service config
  app delete <service>                Remove and stop one service container
  shutdown                            Stop all running CI-Server services
  config show                         Show key CLI/portal configuration from .env
  config set <KEY> <VALUE>            Set or update a key in .env
EOF
}

run_cmd() {
  if $DRY_RUN; then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

compose_local() {
  run_cmd docker compose -f "${REPO_ROOT}/docker-compose.yml" -f "${REPO_ROOT}/docker-compose.local.yml" --profile local "$@"
}

cmd_setup_hub() {
  run_cmd make -C "${REPO_ROOT}" init
  run_cmd make -C "${REPO_ROOT}" local
  run_cmd make -C "${REPO_ROOT}" seed
}

cmd_setup_mcp() {
  run_cmd make -C "${REPO_ROOT}" tooling
  echo "MCP tooling services started."
}

cmd_register_portal() {
  if [[ "${1:-}" == "--quiet" ]]; then
    run_cmd make -C "${REPO_ROOT}" publish-quiet
    return
  fi

  run_cmd make -C "${REPO_ROOT}" publish
}

cmd_app() {
  local action="${1:-}"
  local service="${2:-}"

  case "${action}" in
    start)
      if [[ -n "${service}" ]]; then
        compose_local up -d "${service}"
      else
        run_cmd make -C "${REPO_ROOT}" local
      fi
      ;;
    stop)
      if [[ -n "${service}" ]]; then
        compose_local stop "${service}"
      else
        run_cmd make -C "${REPO_ROOT}" stop
      fi
      ;;
    restart)
      if [[ -n "${service}" ]]; then
        compose_local restart "${service}"
      else
        run_cmd make -C "${REPO_ROOT}" stop
        run_cmd make -C "${REPO_ROOT}" local
      fi
      ;;
    status)
      compose_local ps
      ;;
    add)
      if [[ -z "${service}" ]]; then
        echo "Missing required argument: <service>"
        exit 1
      fi
      compose_local up -d "${service}"
      ;;
    edit)
      if [[ -z "${service}" ]]; then
        echo "Missing required argument: <service>"
        exit 1
      fi
      echo "Edit service '${service}' in docker-compose.local.yml"
      if [[ -n "${EDITOR:-}" ]]; then
        run_cmd "${EDITOR}" "${REPO_ROOT}/docker-compose.local.yml"
      else
        echo "EDITOR is not set. Open: ${REPO_ROOT}/docker-compose.local.yml"
      fi
      ;;
    delete)
      if [[ -z "${service}" ]]; then
        echo "Missing required argument: <service>"
        exit 1
      fi
      compose_local rm -s -f "${service}"
      ;;
    *)
      echo "Unknown app action: ${action:-<none>}"
      usage
      exit 1
      ;;
  esac
}

cmd_shutdown() {
  run_cmd make -C "${REPO_ROOT}" stop
}

cmd_config_show() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "No .env file found at ${ENV_FILE}"
    return 0
  fi

  while IFS='=' read -r key value; do
    if [[ "${key}" == "STORE_ADMIN_API_KEY" ]]; then
      if [[ -n "${value}" ]]; then
        if [[ ${#value} -lt 8 ]]; then
          echo "${key}=****"
        else
          local prefix="${value:0:4}"
          local suffix="${value: -4}"
          echo "${key}=${prefix}...${suffix}"
        fi
      else
        echo "${key}="
      fi
    elif [[ "${key}" == "PORTAL_API" || "${key}" == "REGISTRY" || "${key}" =~ ^(MCP|HUB)_ ]]; then
      echo "${key}=${value}"
    fi
  done < "${ENV_FILE}"
}

cmd_config_set() {
  local key="${1:-}"
  local value="${2-}"

  if [[ -z "${key}" || $# -lt 2 ]]; then
    echo "Usage: config set <KEY> <VALUE>"
    exit 1
  fi

  local tmp
  if [[ ! "${key}" =~ ${ENV_KEY_REGEX} ]]; then
    echo "Invalid key '${key}'. Use letters, numbers, and underscores only."
    exit 1
  fi

  tmp="$(mktemp)"
  trap 'rm -f "${tmp:-}"' EXIT

  if [[ -f "${ENV_FILE}" ]]; then
    if grep -q "^${key}=" "${ENV_FILE}"; then
      while IFS= read -r line || [[ -n "${line}" ]]; do
        if [[ "${line}" == "${key}="* ]]; then
          printf "%s=%s\n" "${key}" "${value}" >> "${tmp}"
        else
          printf "%s\n" "${line}" >> "${tmp}"
        fi
      done < "${ENV_FILE}"
    else
      cat "${ENV_FILE}" > "${tmp}"
      printf "%s=%s\n" "${key}" "${value}" >> "${tmp}"
    fi
  else
    printf "%s=%s\n" "${key}" "${value}" > "${tmp}"
  fi

  if $DRY_RUN; then
    local display_value="${value}"
    if [[ "${key}" == *KEY* || "${key}" == *TOKEN* || "${key}" == *PASSWORD* ]]; then
      display_value="****"
    fi
    echo "DRY-RUN: would write ${key}=${display_value} to ${ENV_FILE}"
    trap - EXIT
    return 0
  fi

  mv "${tmp}" "${ENV_FILE}"
  trap - EXIT
  echo "Updated ${key} in ${ENV_FILE}"
}

cmd_wizard() {
  local original_ps3="${PS3-}"
  local options=(
    "Setup Hub"
    "Register with Cloud Portal"
    "Setup MCP"
    "App Lifecycle (status)"
    "Shutdown Services"
    "Show Config"
    "Show Help"
    "Exit"
  )
  local option_count="${#options[@]}"
  PS3="wizard> "

  echo
  print_company_banner
  echo "CI-Server Wizard"
  if $DRY_RUN; then
    echo "Mode: dry-run (no changes will be applied)"
  fi
  echo "Select an action:"
  select selection in "${options[@]}"; do
    case "${selection}" in
      "Setup Hub")
        cmd_setup_hub
        ;;
      "Register with Cloud Portal")
        cmd_register_portal
        ;;
      "Setup MCP")
        cmd_setup_mcp
        ;;
      "App Lifecycle (status)")
        cmd_app status
        ;;
      "Shutdown Services")
        cmd_shutdown
        ;;
      "Show Config")
        cmd_config_show
        ;;
      "Show Help")
        usage
        ;;
      "Exit")
        echo "Exiting wizard."
        break
        ;;
      *)
        echo "Invalid selection '${REPLY}'. Enter a number between 1 and ${option_count}."
        continue
        ;;
    esac

    echo
    echo "Select another action or choose Exit."
  done

  PS3="${original_ps3}"
}

main() {
  local command="${1:-help}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "${command}" in
    help|-h|--help) usage ;;
    man) cat "${MAN_FILE}" ;;
    wizard) cmd_wizard ;;
    setup)
      case "${1:-}" in
        hub) shift; cmd_setup_hub "$@" ;;
        mcp) shift; cmd_setup_mcp "$@" ;;
        *)
          echo "Unknown setup action: ${1:-<none>}"
          usage
          exit 1
          ;;
      esac
      ;;
    register)
      case "${1:-}" in
        portal) shift; cmd_register_portal "$@" ;;
        *)
          echo "Unknown register action: ${1:-<none>}"
          usage
          exit 1
          ;;
      esac
      ;;
    app) cmd_app "$@" ;;
    shutdown) cmd_shutdown ;;
    config)
      case "${1:-}" in
        show) shift; cmd_config_show "$@" ;;
        set) shift; cmd_config_set "$@" ;;
        *)
          echo "Unknown config action: ${1:-<none>}"
          usage
          exit 1
          ;;
      esac
      ;;
    *)
      echo "Unknown command: ${command}"
      usage
      exit 1
      ;;
  esac
}

main "$@"
