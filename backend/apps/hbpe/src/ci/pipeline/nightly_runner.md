# nightly_runner.py

## Purpose
Defines the Temporal activities and workflow that run HBPE's nightly maintenance pipeline. Each step is isolated so one failure is reported without aborting the rest of the workflow.

## Components

### `label_unlabeled`, `label_summary_tokens`, `l1_stale_sweep`, `l2_stale_sweep`, `lora_fine_tune`
- **Does**: Wrap synchronous HBPE maintenance steps in executor-backed Temporal activities.
- **Interacts with**: tokenizer/model modules under `src/ci/`.

### `drift_detection`, `cache_invalidation`
- **Does**: Placeholder activities for later phases.
- **Interacts with**: workflow orchestration only.

### `NightlyHBPEWorkflow.run`
- **Does**: Executes each activity with fail-continue semantics and returns a per-step result map.
- **Interacts with**: `_safe_execute` in this file.

### `_safe_execute`
- **Does**: Normalizes activity failures into structured error payloads.
- **Interacts with**: Temporal activity futures returned by `workflow.execute_activity`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Temporal schedules | Workflow name stays `NightlyHBPEWorkflow` | Renaming workflow/activity defs |
| Schedule setup | Activity names remain stable | Changing `@activity.defn(name=...)` values |

## Notes
- Error logs for labeling failures and step failures now keep stack traces via `log.exception`, which is more useful than formatting only the exception string.
