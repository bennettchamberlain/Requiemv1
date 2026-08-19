# ADR-0003: Canonical Tenancy Column (`user_id`)

| Field         | Value                    |
|---------------|--------------------------|
| **Status**    | Accepted                 |
| **Date**      | 2026-08-08               |
| **Author(s)** | Schema consolidation     |
| **Reviewers** | TBD                      |

## Context

CI-Server tables scope rows to a user with two spellings:

- `user_id` — timeline and capture tables (`events`, `content`, `communications`,
  `browser_activity`, `capture_events`, `position`, …)
- `owner_user_id` — knowledge-graph and inventory/commerce tables (`entities`,
  `relationships`, `inventory`, `product_models`, `receipts`,
  `object_observations`, …)

Both mean the same tenancy boundary. Dual names accumulate in join SQL and make
it unclear which spelling new tables should use.

## Decision

**`user_id` is the canonical tenancy column** for new tables and for
documentation of the product data model.

**`owner_user_id` is retained** where inventory/commerce and the graph already
use it (`ci.entities`, `ci.relationships`, `ci.inventory`, and the commerce
tables that share that provenance pattern). Renaming those columns is out of
scope for this consolidation wave — the blast radius (indexes, TypeORM entities,
raw SQL, importer contracts) is large for no runtime win.

Application code should treat `user_id` and `owner_user_id` as synonyms for the
same owner when joining across domains.

## Consequences

- New tables default to `user_id`.
- Graph/inventory/commerce keep `owner_user_id` until a dedicated rename wave.
- Docs and ADRs prefer the phrase "user-scoped" over debating column names.
