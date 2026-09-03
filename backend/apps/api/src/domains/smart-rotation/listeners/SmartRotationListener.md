# SmartRotationListener.ts

## Purpose

Executes one per-user unit selected by the smart-rotation scheduler. It routes
each work type to its owning domain while keeping expensive work on pg-boss.

## Components

### `SmartRotationListener.handleWork`

- **Does**: Receives `smart.rotation.work` jobs and dispatches the selected work.
- **Interacts with**: Question inference, schedule sync, Python sidecars, graph maintenance, and personalization services.
- **Rationale**: The listener is the single execution boundary behind the staggered rotation crons.

### Summary work

- **Does**: Dispatches `hourly_summary` and `dossier_refresh` independently.
- **Contract**: Hourly summary generation must never depend on a pre-existing summary or dossier.
- **Rationale**: A dossier consumes summaries; selecting dossier *instead of* an hourly summary creates an unrecoverable empty-user loop.

### Insight work

- **Does**: Attaches trust-mode personalization and dispatches `insights_generation`.
- **Contract**: Novelty is checked only by the summary sidecar against the last successfully stored insight.
- **Rationale**: Scheduler completion is not evidence that insight generation succeeded.

### `findNextUnansweredQuestionId`

- **Does**: Selects the least-recently-attempted eligible question outside the retry cooldown.
- **Interacts with**: Live and archived pg-boss attempt rows.

## Contracts

| Dependent | Expects | Breaking changes |
| --- | --- | --- |
| `SmartRotationService` | Every declared work type is handled | Removing a switch branch |
| `PythonFunctionService` | Sidecar function names and singleton keys are valid | Renaming functions or key shapes |
| Summary sidecar | Hourly and dossier jobs are independent | Restoring an either/or dispatch |
| Insight sidecar | It is the authoritative novelty gate | Adding a scheduler-side novelty gate |

## Notes

- Summary and dossier jobs may overlap. A first dossier run can legitimately skip before the first hourly row lands; a later tick repairs it.
- Generated insights never feed HBPE directly.
