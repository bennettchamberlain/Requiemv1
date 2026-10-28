# Requiem

Scoria, named for the fact that the day ends.

You have twenty-four hours. This machine holds memory so you can spend them
on what is still alive: people, work, places, the next honest hour.
Memento mori.

The stack is still Scoria (Gel, Dart API, Flutter, jobs). Requiem is the
product name. There is no nested `One_Hackathon/scoria/` — this directory
is the repo.

```
requiem/
  schema/   server/   app/   packages/   # Scoria
  connect/  etl/      swarm/             # One, workers, weaver
```

## Run the API

```sh
set -a && source .env && set +a
export HACKATHON_ROOT="$PWD"
export SCORIA_PYTHON="$PWD/.venv/bin/python"
export SCORIA_QUERIES_DIR="$PWD/schema/queries"
export SCORIA_PORT=8090
cd server/scoria_api && dart run bin/main.dart
```

Forward **8090**. Flutter: `http://localhost:8090`. Handle `admin`, password `scoria-admin`.

## Sign-in

The first screen is the onboarding: *Memento mori. Twenty-four hours. That is the whole day.*
