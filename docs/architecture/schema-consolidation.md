# Schema consolidation (LifeScope audit)

**Status:** Waves A–E landed on `chore/schema-consolidation`  
**Source audit:** [lifescope-vs-ci-server-schema.html](./lifescope-vs-ci-server-schema.html)

## Hypertable exceptions (already landed, do not reopen)

| Table | Decision |
|-------|----------|
| `ci.position` | Keep **time-only** hypertable (space partition removed) |
| `ci.user_snapshots` | Keep **time-only** hypertable |
| `ci.communications` | **Plain table** (de-hypertabled; dedup companion dropped) |

See [hypertable-audit.md](./hypertable-audit.md) and ADR-0002.

## Waves

| Wave | Status | Intent |
|------|--------|--------|
| A | **done** | Drop dead `agents` / `agent_messages`; user-scoped events arbiter; delete dead/dupe entities; rename graph `FileEntity` |
| B | **done** | Restore `ci.content.event_id` FK + `Event.contents`; analytics side table `ci.event_analytics` |
| C | **done** | One entity-type vocab + tenancy ADR-0003; Person typed columns; location snap dedup |
| D | **done** | Fold `browser_activity` → events+content (backfill + dual-write); `/v1` prefers timeline |
| E | **done** | `COMMENT` on write-only commerce tables; refresh Database.md |

Do not break smart-rotation tables (`questions`, `answers`, `feed_queue`, `summaries`, `actions`, `tasks`).

## Follow-ups

- **Done (post-merge):** Import finish that scopes search backfill to `browser-activity` also indexes dual-written `event` + `content` via `expandBackfillEntityTypes` in `SearchIndexBackfillService`
- **Done (post-merge):** Removed dead analytics fields from event create/update DTOs (`prediction_model`, `productivity_impact`, `last_synced_at`, `related_event_ids`, `supersedes_event_id`) — those live on `ci.event_analytics` when written
- Drop `ci.browser_activity` after dual-read consumers move to events/content
- Rename remaining `owner_user_id` columns only if a dedicated blast-radius wave is scheduled (see ADR-0003)
