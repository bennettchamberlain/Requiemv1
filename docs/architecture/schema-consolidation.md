# Schema consolidation (LifeScope audit)

**Status:** in progress on `chore/schema-consolidation`  
**Source audit:** [lifescope-vs-ci-server-schema.html](./lifescope-vs-ci-server-schema.html)

## Hypertable exceptions (already landed, do not reopen)

| Table | Decision |
|-------|----------|
| `ci.position` | Keep **time-only** hypertable (space partition removed) |
| `ci.user_snapshots` | Keep **time-only** hypertable |
| `ci.communications` | **Plain table** (de-hypertabled; dedup companion dropped) |

See [hypertable-audit.md](./hypertable-audit.md) and ADR-0002.

## Waves

| Wave | Commits | Intent |
|------|---------|--------|
| A | Drop dead `agents` / `agent_messages`; user-scoped events arbiter; delete dead/dupe entities; rename graph `FileEntity` | Near-zero blast |
| B | Restore `ci.content.event_id` FK + `Event.contents`; analytics side table | Integrity |
| C | One entity-type vocab + tenancy ADR; Person columns; location dedup | Coherence |
| D | Fold `browser_activity`; `/v1` default → `ci.events` | Timeline |
| E | `COMMENT` on write-only commerce tables; refresh Database.md | Honesty |

Do not break smart-rotation tables (`questions`, `answers`, `feed_queue`, `summaries`, `actions`, `tasks`).
