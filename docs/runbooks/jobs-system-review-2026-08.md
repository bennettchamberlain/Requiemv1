# Jobs system review — August 2026

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**

A review of the pg-boss jobs system and the Jobs dashboard, and the changes that
came out of it. Every claim here was verified against either the pg-boss 10.3.2
source in `.yarn/cache` or the live appliance database (`companion@localhost:5432`,
`pgboss` schema version 24), on 2026-08-17. Numbers are query results.

---

## 1. How the jobs system works

```
send()/sendMany()          route by listener            worker loop
  │                          │                            │
  ├─ EventListenerRegistry ──┤                            │
  │  (built from @OnEvent    │                            │
  │   decorator side effects)│                            │
  ▼                          ▼                            ▼
pgboss.job  ──── fetch(batchSize) ──── executeJob ──── complete()
(partitioned                │                │              │
 by queue name)             │                │              └─ failure → fail(output)
                            │                │                    │
                    per-queue + global       │              retries exhausted
                     p-limit semaphores      │                    │
                                             │                    ▼
                                    EventEmitter2 emits    pgboss.job (dead-letter queue,
                                    `${event}:${queue}`     state `created`)
                                                                  │
                                                    DeadLetterReaperListener (every 2 min)
                                                                  │ copies, never consumes
                                                                  ▼
                                                       ci.pipeline_dead_letters
```

Queues are **discovered**, not declared: `@OnEvent(event, { queue })` registers
into a static `EventListenerRegistry` at decorator-evaluation time, and
`onModuleInit` creates every discovered queue under an advisory lock, wiring each
to the shared `dead-letter` queue.

**23 queues** exist (22 listener queues + `dead-letter`), carrying **85 `@OnEvent`
registrations**. Recurring work is **~34 NestJS `@Cron` methods** — there is not
one call to `boss.schedule()` anywhere, so `pgboss.schedule` is empty.

Live distribution at review time:

| Queue | Listeners |
|---|---|
| `search-index` | 42 |
| `default` | 16 |
| `pipeline-index` | 4 |
| `pipeline-enrich`, `pipeline-embed`, `etl`, `feed-queue` | 2 each |
| 15 others | 1 each |

---

## 2. What was wrong

### 2.1 Three ways the worker loop could take down the API

`PGBossEventService.work()` had two un-awaited edges and one over-broad `try`.

| | Before | Consequence |
|---|---|---|
| `boss.fetch()` | unguarded inside `while (this.running)` | A throw escaped the loop and rejected the promise parked in `stopTasks`, which nothing awaits until shutdown → unhandled rejection. Had the process survived, **that queue would have had no worker for the rest of its life** while every other queue kept running. |
| `perQueueSemaphore(...)` | called without `await` or `.catch()` | A `boss.fail()` that itself failed became an unhandled rejection — one job error escalating into `process.exit(1)`. |
| `boss.complete()` | inside the same `try` as the listener | A job whose listener **succeeded** got marked failed and retried when the acknowledgement round trip errored — burning retries on finished work until it dead-lettered. |

All three are reached by ordinary transient database trouble. "The DB hiccupped"
must not mean "the appliance restarted".

### 2.2 `userId` never reached any job's execution context

```ts
const userId = (job as { userId?: string }).userId;   // ← always undefined
```

`pgboss.job` has no `userId` column. Its columns are `id, name, priority, data,
state, retry_limit, retry_count, retry_delay, retry_backoff, start_after,
started_on, singleton_key, singleton_on, expire_in, created_on, completed_on,
keep_until, output, dead_letter, policy`. The user id travels in the **payload**:

```sql
select count(*) from pgboss.job where data ? 'userId';   -- 36,923
```

So `ContextService.getUserId()` returned `null` inside every background job, and
the "Executing job" log line never carried a user id.

### 2.3 The dashboard counted dead-lettered jobs twice

pg-boss inserts a dead-lettered job onto the `dead-letter` queue **in state
`created`** — indistinguishable, by state alone, from work waiting to run. The
summary counted `state = 'created'` across every queue.

| Tile | Reported | Actual |
|---|---|---|
| Pending | 13,907 | **12,716** (12,710 image-description + 6 search-index) |
| Failed | 1,191 | 1,191 — *the same jobs*, counted again |

`dead-letter` was also the second-largest entry in "Active jobs by queue",
presenting jobs that had already given up as live workload.

### 2.4 Failure diagnostics were fetched and thrown away

`JobMonitorService` selects `pgboss.job.output`, the worker writes
`{ message, stack, failedAt }` into it on every failure, and the DTO carried it
all the way to the browser — where `JobsPage` never rendered it.

What was sitting in that column, unread:

| Failures | Cause |
|---|---|
| 628 × `file-preview-generation` | `Cannot find ffmpeg` |
| 941 × `file.uploaded` (dead-lettered) | — |
| 141 × `python.function.run` (dead-lettered) | — |
| 40 × `smart.rotation.work` | `column fq.metadata does not exist` |

The page could say "Failed: 1,191" and nothing about why, while the answer was
one property away in memory.

### 2.5 The Schedules column could never show anything

It rendered `pgboss.schedule`, which has **0 rows** and always will — nothing
calls `boss.schedule()`. Meanwhile ~34 real `@Cron` schedules ran invisibly.
`summary.scheduled` was permanently 0.

### 2.6 The summary was six sequential scans on a 15-second poll

`pgboss.job` is partitioned by queue name, so every count over it is an `Append`
of a `Seq Scan` per partition. `pgboss.archive` is created as
`CREATE TABLE archive (LIKE job)` (`plans.js:355`) — it inherits **no indexes**,
and the only one added is `archive_i1 ON archive(archived_on)` (`plans.js:363`).
There is no index on `state`, so archive counts are always a full scan.

Measured (`EXPLAIN ANALYZE`, 41.5k job rows / 88.7k archive rows / 39 MB):

| | Before | After |
|---|---|---|
| job side | 4 counts, 6.9 + 13.9 + 30.2 + 10.7 = **61.7 ms** | 1 grouped scan, **14.7 ms** |
| archive side | 2 counts, **~43 ms** | 1 grouped scan, **22.7 ms** |
| total | **~105 ms** | **~37 ms** |

...while returning *more* states than before.

### 2.7 `retentionDays: 30` on the dead-letter queue was silently discarded

The live queue row carries `retention_minutes = NULL`. Traced through pg-boss
10.3.2:

- `attorney.js:238-249` folds `retentionDays` into a `keepUntil` interval string and never sets `retentionMinutes`;
- `manager.js:538-562` destructures only `retentionMinutes` from those options;
- `plans.js:226-256` (`create_queue`) reads only `options->>'retentionMinutes'`.

The requested 30 days never reached the database.

### 2.8 Smaller correctness bugs in the page

- **Active Jobs** filtered on `state !== 'completed'`, so `failed` and `cancelled` jobs appeared under "Jobs waiting to run or currently executing".
- **A failing refresh after the first success was swallowed entirely.** The page kept auto-refreshing and kept showing frozen numbers, so a dead API looked exactly like a quiet queue.
- The `retry` and `cancelled` states had no tile, so a queue entirely in retry read as idle.
- Every empty column said "No data available", which reads as a fetch problem rather than an idle queue.
- Polling continued in hidden tabs.

---

## 3. What changed

### Backend

| File | Change |
|---|---|
| `domains/events/services/PGBossEventService.ts` | `boss.fetch()` guarded — logs, backs off, keeps polling. Per-job work moved into `runJob()`, launched as `void …catch(…)` so nothing can escape as an unhandled rejection. `boss.complete()` split out of the listener's `try`: a completion failure is logged and the job left `active` for pg-boss's expiration, never re-failed. New `failJobQuietly()` so a failing `fail()` cannot crash the worker. `userId` now read from `job.data`. DLQ retention expressed in `retentionMinutes`, plus an `updateQueue` so existing appliances get it. |
| `domains/events/constants.ts` | `DEAD_LETTER_QUEUE` exported, so the monitor's exclusions and the queue's creation cannot drift apart. |
| `domains/events/services/JobMonitorService.ts` | `getSummary()` rewritten as two grouped scans. Dead letters excluded from `pending` and reported as `deadLettered`; `retry` and `cancelled` added. Dead-letter queue excluded from both live-work distributions. New `getCronSchedules()` reads Nest's live `SchedulerRegistry`. |
| `common/schedule/decorators/Cron.ts` | Catches and logs with the class, method and traceId. **Not** a crash fix — `@nestjs/schedule` v6 already contains rejecting ticks (`SchedulerRegistry.wrapFunctionInTryCatchBlocks`); it just logs them with no indication of which schedule failed. |

### Frontend

| File | Change |
|---|---|
| `pages/JobsPage/JobsPage.tsx` | New `JobFailureDetail` renders the message, stack and time from `output`, collapsed in a `<details>`. New **Failures** column (failed jobs + dead letters). Active Jobs restricted to `created`/`active`/`retry` and excludes the dead-letter queue. Schedules column now renders real crons. Six summary tiles. Per-column empty messages. `StaleBanner`; `role="alert"`/`role="status"` on both banners. |
| `pages/JobsPage/useJobsDashboard.ts` | Tracks `staleSince` and `updatedAt`; a failing refresh after first load now surfaces instead of being swallowed. Skips polling in hidden tabs. Types extended for `crons` and the new summary states. |

---

## 4. Tests

| Suite | Before | After |
|---|---|---|
| `domains/events` (backend) | 46 | 55 |
| `common/schedule` | 2 | 5 |
| `JobMonitorService` | **0** | 6 |
| `JobsPage` (frontend) | **0** | 12 |

Every new test was run against the **unfixed** code first to confirm it fails
there: 4 of 4 backend worker/completion tests failed pre-fix, and 7 of 9 original
frontend tests failed pre-fix.

```bash
cd backend/apps/api && yarn test src/domains/events src/common/schedule
```

```bash
cd frontend/apps/web && yarn vitest run src/pages/JobsPage
```

Both suites, plus `yarn typecheck` and `yarn lint` in each workspace, are clean.

**Not verified in a browser.** The dashboard needs an authenticated session, and
standing up a second API against the live database would have started a worker on
a 12,710-job backlog. Rendering is covered by the 12 DOM tests instead.

---

## 5. On the pg-boss dashboard and proxy

**Do not upgrade pg-boss to adopt the official dashboard.**

| Package | Installed | Latest |
|---|---|---|
| `pg-boss` | 10.3.2 | 12.27.0 (v10 line ends at 10.4.2) |
| `@pg-boss/dashboard` | — | 1.6.5, **requires pg-boss ≥ 12.21** |
| `@pg-boss/proxy` | — | 1.5.3 |

Two blockers, both confirmed against the source: there is no migration path from
schema 24 to v12, and **`pgboss.archive` does not exist in v11 or v12** while two
production code paths read it directly. On an appliance that ships to end users,
an in-place schema migration at boot is not a risk worth taking for a monitoring
UI.

**None of it is necessary.** pg-boss 10.3.2 already declares everything the
dashboard is missing:

```
cancel(name, id|ids)      resume(name, id|ids)       retry(name, id|ids)
deleteJob(name, id|ids)   getJobById(name, id, { includeArchive })
purgeQueue(name)          deleteQueue(name)
getQueues()               getQueue(name)             getQueueSize(name, { before })
schedule(name, cron, data, options)   unschedule(name)   getSchedules()
```

Job detail, retry, cancel, delete and purge can ship today against the installed
version. `@pg-boss/proxy` solves a problem this codebase does not have — HTTP
access to pg-boss from non-Node runtimes — and would add an unauthenticated
surface over the job tables.

---

## 6. Still open

Ranked, not yet done:

1. **`getDashboard` returns raw job payloads to any authenticated principal.** `job.data` carries user content; the guard checks only that *a* user context exists. Should be admin-scoped or redacted.
2. **No pagination.** 25 recent jobs with full `jsonb` payloads inline, rebuilt every poll.
3. **No job actions.** `retry` / `cancel` / `deleteJob` / `purgeQueue` exist in the installed pg-boss and are unwired; the dashboard is read-only for no technical reason.
4. **No filtering or search** by state, queue, or date.
5. **`monitorStateIntervalSeconds` is off** (`version.monitored_on` is NULL). Enabling it makes pg-boss emit per-queue state counts from one `GROUP BY rollup`, replacing the polled counts entirely.
6. **21 declared events have no listener on any queue** — `send()` on them enqueues nothing. `position.created` is emitted once per GPS fix.
7. **The `default` queue mixes multi-minute LLM inference with graph writes and new-user seeding** on one 6-slot semaphore at equal priority.
8. **`ci.pipeline_dead_letters` only grows.** The reaper inserts; nothing purges.
9. **No queue metrics over time** — depth, latency, failure rate, DLQ depth.
10. **20 of 22 work queues declare no `queueOptions`**, inheriting one 12-hour expiry and 3-retry policy for very different workloads.

---

## 7. Corrections to earlier claims

Two findings from the review did **not** survive verification and are recorded
here so they are not repeated:

- **"Nothing consumes the dead-letter queue; it grows unbounded."** False.
  `DeadLetterReaperListener` polls it every two minutes and copies each entry
  into `ci.pipeline_dead_letters` — all 1,191 are harvested there. It
  deliberately does not complete or delete, so pg-boss's copy stays inspectable
  for its retention. The rows *do* stay in `pgboss.job` state `created`, which is
  why the Pending fix above is still needed.
- **"~28 `@Cron` methods have no try/catch, so any DB blip exits the process."**
  False for `@nestjs/schedule` v6: `SchedulerRegistry.addCronJob` wraps
  `fireOnTick` in a try/catch that awaits and logs. The real gap was that the log
  line does not say which schedule failed.
