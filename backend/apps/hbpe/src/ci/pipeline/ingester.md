# ingester.py

## Purpose
Runs the async LISTEN/NOTIFY bridge that keeps cached forecasts aligned with new data. It debounces notifications per user, invalidates affected forecast days, and reserializes the current day when needed.

## Components

### `EventIngester.start` / `stop`
- **Does**: Manage the lifecycle of the background listener task.
- **Interacts with**: FastAPI lifespan in `api.py`.

### `_listen_loop`, `_asyncpg_loop`, `_polling_loop`
- **Does**: Prefer asyncpg LISTEN/NOTIFY and fall back to polling when asyncpg is unavailable.
- **Interacts with**: `settings.database_url` in `config.py`, `get_conn` in `database.py`.

### `_dispatch`, `_flush_after_debounce`, `_reserialise`
- **Does**: Batch invalidations per user and refresh serialized token rows for the current day.
- **Interacts with**: `InferenceEngine` in `inference_engine.py`, `TokenSerializer` in `tokenizer/serializer.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `api.py` | `EventIngester(_engines)` works with a `user_id -> engine` registry | Constructor or lifecycle changes |
| Runtime ops | Missing `asyncpg` downgrades to polling instead of crashing | Removing fallback behaviour |

## Notes
- Unexpected polling/reserialization failures now log stack traces, because those paths previously dropped the context needed to debug production issues.
