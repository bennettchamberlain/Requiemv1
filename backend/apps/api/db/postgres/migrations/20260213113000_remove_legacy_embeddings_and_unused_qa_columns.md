# 20260213113000_remove_legacy_embeddings_and_unused_qa_columns.sql

## Purpose
Removes legacy embedding storage from `ci` tables now that semantic indexing lives in `ci_search`. Also drops a defined set of unused `ci.questions` and `ci.answers` columns.

## Components

### Legacy embedding cleanup
- **Does**: Drops `ci` embedding columns (vector/text embedding fields) while explicitly excluding `ci.users`, `ci.summaries`, and `ci.files`.
- **Interacts with**: Existing `ci` table definitions and index dependencies.

### Secondary embedding cleanup
- **Does**: Drops any `secondary_embedding` column in app schemas (`ci`, `ci_search`, `public`).
- **Interacts with**: `information_schema.columns` and dynamic `ALTER TABLE` execution.
- **Rationale**: Enforces a single canonical embedding path and removes a known deprecated field pattern.

### Questions/answers prune
- **Does**: Drops selected unused metadata columns from `ci.questions` and `ci.answers`.
- **Interacts with**: Intelligence-domain persistence tables.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Backend TypeORM entities | Dropped columns are no longer mapped | Any lingering mapping/query on removed columns fails |
| Search/indexing | Embeddings live in `ci_search` | Reading embeddings from `ci.*` no longer possible |

## Notes
Migration is intentionally irreversible (`down` is no-op) because recreating all dropped columns/indexes with original semantics is unsafe.
