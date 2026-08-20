# Schema consolidation (LifeScope audit)

**Status:** Waves A–E landed on `chore/schema-consolidation`. **Wave D was subsequently
reverted** — see the Waves table. Re-verified against `main` 2026-08-19.  
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
| D | **REVERTED** | Fold `browser_activity` → events+content (backfill + dual-write); `/v1` prefers timeline. Landed as `20260808070615` (squashed into `20260808150100`), then undone by `20260812144811_revert_browser_activity_event_fold.sql`: page views are not timeline events — the fold flooded the schedule calendar and silently changed the HBPE training corpus, which reads `ci.events` with no `event_type` or `source_type` filter. `ci.browser_activity` is again the sole home, and `BrowserActivityService` no longer dual-writes. |
| E | **done** | `COMMENT` on write-only commerce tables; refresh Database.md |

Do not break smart-rotation tables (`questions`, `answers`, `feed_queue`, `summaries`, `actions`, `tasks`).

## Follow-ups

- **Done (post-merge):** Import finish that scopes search backfill to `browser-activity` also indexes dual-written `event` + `content` via `expandBackfillEntityTypes` in `SearchIndexBackfillService`. **Now vestigial:** its whole reason was Wave D's dual-write, which is reverted, so the expansion widens a scoped backfill for rows that are no longer written. It still exists (`SearchIndexBackfillService.ts:97-111`, with a doc comment that still describes the fold in the present tense) and is harmless — worth removing with the rest of the Wave D residue.
- **Done (post-merge):** Removed dead analytics fields from event create/update DTOs (`prediction_model`, `productivity_impact`, `last_synced_at`, `related_event_ids`, `supersedes_event_id`) — those live on `ci.event_analytics` when written. Verified still absent from the event types 2026-08-19.
- ~~Drop `ci.browser_activity` after dual-read consumers move to events/content~~ — **withdrawn.** Wave D was reverted; `ci.browser_activity` is the sole home for page views and stays.
- Rename remaining `owner_user_id` columns only if a dedicated blast-radius wave is scheduled (see ADR-0003)
