# SmartRotationListener.test.ts

## Purpose

Pins smart-rotation routing and queue contracts without requiring Postgres or
the Python sidecars.

## Components

### Work-type routing tests

- **Does**: Verifies each rotation work type reaches its owning service with the expected payload.
- **Interacts with**: Mocked domain services and `PythonFunctionService`.

### Summary recovery tests

- **Does**: Verifies every summary tick dispatches an hourly digest and maintains the dossier independently.
- **Rationale**: Prevents the no-summary/stale-summary bootstrap trap from returning.

### Insight dispatch test

- **Does**: Verifies the scheduler always delegates novelty decisions to the sidecar and includes personalization.

### Answer-inference rotation tests

- **Does**: Pins cooldown, ordering, and live/archive attempt-history semantics.

## Contracts

| Dependent | Expects | Breaking changes |
| --- | --- | --- |
| `SmartRotationListener.ts` | Mock constructor order mirrors production injection | Reordering constructor parameters |
| Summary recovery | Hourly dispatch is unconditional | Reintroducing pre-summary gating |
| Insight recovery | No scheduler-side novelty suppression | Calling `hasNoveltySinceLastRun` before dispatch |
