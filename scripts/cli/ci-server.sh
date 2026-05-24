#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MAN_FILE="${REPO_ROOT}/docs/cli/ci-server-cli.md"
ENV_FILE="${REPO_ROOT}/.env"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

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

  grep -E '^(PORTAL_API|REGISTRY|STORE_ADMIN_API_KEY|MCP_|HUB_)=' "${ENV_FILE}" || true
}

cmd_config_set() {
  local key="${1:-}"
  local value="${2:-}"

  if [[ -z "${key}" || -z "${value}" ]]; then
    echo "Usage: config set <KEY> <VALUE>"
    exit 1
  fi

  local tmp
  tmp="$(mktemp /tmp/ci-server-cli-env.XXXXXX)"

  if [[ -f "${ENV_FILE}" ]]; then
    if grep -q "^${key}=" "${ENV_FILE}"; then
      awk -v k="${key}" -v v="${value}" 'BEGIN{done=0} $0 ~ "^" k "=" {print k "=" v; done=1; next} {print} END{if(!done) print k "=" v}' "${ENV_FILE}" > "${tmp}"
    else
      cat "${ENV_FILE}" > "${tmp}"
      printf "%s=%s\n" "${key}" "${value}" >> "${tmp}"
    fi
  else
    printf "%s=%s\n" "${key}" "${value}" > "${tmp}"
  fi

  if $DRY_RUN; then
    echo "DRY-RUN: would write ${key}=*** to ${ENV_FILE}"
    rm -f "${tmp}"
    return 0
  fi

  mv "${tmp}" "${ENV_FILE}"
  echo "Updated ${key} in ${ENV_FILE}"
}

cmd_wizard() {
  echo "CI-Server Wizard"
  echo "Select an action:"
  select selection in \
    "Setup Hub" \
    "Register with Cloud Portal" \
    "Setup MCP" \
    "App Lifecycle (status)" \
    "Shutdown Services" \
    "Show Config" \
    "Show Help" \
    "Exit"; do
    case "${selection}" in
      "Setup Hub") cmd_setup_hub; break ;;
      "Register with Cloud Portal") cmd_register_portal; break ;;
      "Setup MCP") cmd_setup_mcp; break ;;
      "App Lifecycle (status)") cmd_app status; break ;;
      "Shutdown Services") cmd_shutdown; break ;;
      "Show Config") cmd_config_show; break ;;
      "Show Help") usage; break ;;
      "Exit") break ;;
      *) echo "Invalid selection";;
    esac
  done
}

main() {
  local command="${1:-help}"
  shift || true

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
