# ForgetKnowledgeTool.ts

## Purpose
Tool for forgetting graph knowledge by deactivating or deleting targeted entities/relationships.

## Components

### Input schema (`ForgetKnowledgeInputSchema`)
- **Does**: Validates IDs and mode.
- **Interacts with**: Tool invocation payloads.

### `executeInternal`
- **Does**: Collects snapshots, resolves target relationships, then soft/hard deactivates graph data.
- **Interacts with**: `GraphUtilityService`.
- **Rationale**: Centralized forgetting flow with consistent ownership checks.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Tool runtime | Deterministic output shape | Renaming output fields |
| Clients using `mode` | `archive` = soft deactivate, `archive_and_delete` = hard delete | Changing mode semantics |

## Notes
- Fact archival output fields were removed when facts storage was retired.
