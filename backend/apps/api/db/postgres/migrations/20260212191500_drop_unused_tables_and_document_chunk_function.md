# 20260212191500_drop_unused_tables_and_document_chunk_function.sql

## Purpose
Removes unused CI domain tables (`documents`, `document_chunks`, `facts`, `habits`, `habit_completions`, `goals`, `measurements`, `activities`, `voice_recordings`, and `tags`) and cleans up obsolete full-text trigger helper functions.

## Components

### `migrate:up`
- **Does**: Drops the requested `ci` tables with `CASCADE`.
- **Interacts with**: PostgreSQL dependency graph to remove associated indexes, foreign keys, and table-owned triggers.
- **Rationale**: Ensures dependent schema cruft is removed in one deterministic pass.

### `migrate:up` function cleanup
- **Does**: Drops `ci.document_chunks_search_vector_update()` and `ci.facts_search_vector_update()`.
- **Interacts with**: Removed `ci.document_chunks` and `ci.facts` trigger lifecycles.
- **Rationale**: Prevents orphaned trigger helper functions after table removal.

### `migrate:down`
- **Does**: Explicitly marks the migration as irreversible.
- **Rationale**: Recreating these tables exactly would require reintroducing large historical schema and data assumptions.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Migration runner (`dbmate up`) | Migration applies safely even if some targets are already absent | Removed tables and function will no longer exist |

## Notes
- Uses schema-qualified object names (`ci.*`) to avoid `search_path` ambiguity.
- `CASCADE` is intentional to remove associated indexes/triggers/constraints requested in cleanup scope.
