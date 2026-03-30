# l1_staleness.py

## Purpose
Marks stale L1 clusters inactive during the nightly maintenance flow. It exists so cluster churn is handled centrally and historical tokens can remain intact while routing ignores long-dead labels.

## Components

### `L1Staleness.run`
- **Does**: Exposes the nightly sweep as a small class-based entrypoint.
- **Interacts with**: `_deactivate_stale_clusters` in this file.

### `_deactivate_stale_clusters`
- **Does**: Executes the update query and logs how many clusters were deactivated.
- **Interacts with**: `get_conn` in `database.py`, `settings.cluster_staleness_days` in `config.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `pipeline/nightly_runner.py` | `L1Staleness().run(user_id)` returns an integer count | Changing return type |
| Routing code | Inactive clusters remain in the DB, only flagged off | Hard-deleting stale rows |

## Notes
- The only code change here was removing an unused `psycopg2.extras` import.
