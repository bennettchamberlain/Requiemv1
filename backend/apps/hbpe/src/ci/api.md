# api.py

## Purpose
FastAPI entrypoint for the HBPE service. It owns process startup/shutdown, lazy engine creation, and the small HTTP surface used for health checks, histogram generation, and cache invalidation.

## Components

### `_default_user_id`
- **Does**: Resolves the fallback user for single-user deployments.
- **Interacts with**: `get_first_user_id` in `data_client.py`.

### `_get_or_create_engine`
- **Does**: Lazily builds and caches `InferenceEngine` instances per user.
- **Interacts with**: `InferenceEngine` in `pipeline/inference_engine.py`.

### `lifespan`
- **Does**: Preloads the default engine when available and runs the `EventIngester`.
- **Interacts with**: `EventIngester` in `pipeline/ingester.py`.

### `health`, `histogram`, `invalidate_cache`
- **Does**: Expose the service's operational and forecast endpoints.
- **Interacts with**: `build_histogram` in `pipeline/histogram_api.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| FastAPI runtime | `app` is the ASGI application | Renaming/removing `app` |
| Callers of `/histogram` | 400 on invalid horizon, 500 without internal exception text | Response schema or status changes |
| Startup path | Missing default user falls back cleanly | Raising instead of returning `None` |

## Notes
- Default-user lookup failures are logged at debug to avoid noisy request logs in environments where the database is intentionally absent.
