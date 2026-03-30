# schedule.py

## Purpose
Creates and deletes per-user Temporal schedules for the nightly HBPE workflow. The module keeps schedule registration idempotent so worker startup can safely call it on every boot.

## Components

### `_fetch_user_ids`
- **Does**: Loads the set of users that should receive nightly schedules.
- **Interacts with**: `get_all_user_ids` in `data_client.py`.

### `setup_hbpe_schedules`
- **Does**: Creates one nightly Temporal schedule per user and logs created/skipped/failed counts.
- **Interacts with**: `NightlyHBPEWorkflow` in `nightly_runner.py`.

### `delete_hbpe_schedules`
- **Does**: Removes all known HBPE nightly schedules.
- **Interacts with**: Temporal schedule handles from `temporalio.client`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Worker startup | Safe to call repeatedly without duplicating schedules | Removing idempotent handling |
| Ops tooling | Schedule IDs stay `hbpe-nightly-<prefix>` | Changing ID format |

## Notes
- This hygiene pass only removed an unused standard-library `logging` import.
