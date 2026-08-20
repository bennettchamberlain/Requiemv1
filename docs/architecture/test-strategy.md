# CI-Server Test Strategy

> Status: **active — seed.** Foundation for ratcheting coverage toward the `planning.md` → CI-Server target of **>70% line coverage**.
> Owner: CI-Server.

## 1. Today (re-surveyed 2026-08-19)

| Layer | Tooling | What exists |
|---|---|---|
| Unit / controller | Jest + `@nestjs/testing` + `supertest` (`backend/apps/api/jest.config.mjs`, swc transform) | **597 spec/test files** colocated with source — 203 `*.spec.ts` plus 394 `*.test.ts` (392 of them under `__tests__/`) — auth, memory bulk-ingest services, maintenance backfills, saved-search sharing, persistence helpers, graphql resolvers, the pipeline stages, the import domain, and more. `yarn workspace @ci/be-api test`. |
| Integration | Jest (same runner), Docker-backed Postgres + Minio via `make dev`. | Used by the `Routes.e2e.test.ts` patterns in `auth/` and `files/`, and by DB-gated suites that skip loudly without a connection string (`AccountPurgeService.integration.spec.ts` needs `DATABASE_ADMIN_PASSWORD`; `TaskService.tenancy.integration.test.ts` needs `PLANNING_TEST_DATABASE_URL`). |
| Browser / E2E | Playwright — `tests/BetaOneLoginFlow.spec.ts` plus 13 specs in `tests/e2e/` (auth, chat, import, mcp-api-key, memory views / search+filter+detail / map-bbox / people, mobile, onboarding, settings-persistence, stats, things). | The frontend additionally has its own vitest + Playwright harness under `frontend/apps/web/src/test/` — 247 `*.test.ts(x)` files under `frontend/apps/web/src`. |
| Coverage gate | Jest `coverageThreshold` | **Set, but scoped — not global.** `jest.config.mjs` carries one entry, `./src/domains/planning/` at 88 statements / 76 branches / 76 functions / 90 lines. §4 explains why it is scoped. |

> Known flake: `SessionController` logout (204→404) under parallel jest
> (`domains/auth/__tests__/SessionController.test.ts`) — re-run or `--runInBand`;
> it is not your change.

> **CI is manual.** All seven workflows under `.github/workflows/` are
> `workflow_dispatch`-only as of 2026-08-17 — nothing runs on push, pull request,
> tag or schedule. An absent or green check means **nobody dispatched it**, not
> that the suite passed. Run one deliberately with
> `gh workflow run <file> --ref <branch>`. That makes §5's enforcement question
> more urgent, not less.

## 2. Where to invest, in order

This is the priority queue. Each item should land its own ratcheted coverage floor in `jest.config.mjs` when complete.

### Tier 1 — must have before G1 ships

1. **`HealthController`** — done (seed).
2. **`AuthService` + Csrf** — auth is the gate to everything else; bugs are silent breakage.
3. **The `/v1` capture ingest controller** — shipped. It is now
   `domains/ingest/controllers/BulkIngestController.ts` with
   `controllers/__tests__/BulkIngestController.test.ts` and
   `domains/ingest/__tests__/Routes.e2e.test.ts`; the standalone
   `EventsIngestController` no longer exists. Keep ratcheting toward **>90% line
   coverage on this controller and its zod schemas** per
   [`event-ingest-spec.md`](event-ingest-spec.md) §7 — noting it now carries ten
   lanes, not one.
4. **`browser-activity` write path** — first capture source migrated through G1; parity tests vs. legacy POST.

### Tier 2 — within one release of G1

5. **`files` upload / presigned URL flow** — only one E2E test today; needs unit coverage for media validation, mime sniffing, sha256 verification.
6. **`devices` + `keys` lifecycle** — registration, rotation, revocation. These are the foundation of multi-device trust.
7. **`llm` OpenAI-compatible endpoints** — `/v1/chat/completions` SSE behavior, `/v1/audio/transcriptions` multipart, error mapping. Used by every wearable + voice client.
8. **`graph` read API** — relational integrity tests so memory entity changes don't silently rot queries.

### Tier 3 — broad coverage push

9. **`position`, `threads`, `questions`, `answers`** — controller-level tests + zod input validation.
10. **`memory/entities/*` services** — repository-layer tests with a Postgres test container.
11. **`onboarding`** — first-run flow, especially around CI-Hub bootstrap.

### Tier 4 — performance + load

12. `/v1/events` batch ingest under load — k6 or vegeta, 1000-event batches sustained.
13. `/v1/timeline` query under realistic graph sizes (10⁶ events, 10⁴ entities).
14. SSE streams (`/v1/chat/completions`, `/v1/responses`) under 100 concurrent clients.

## 3. Conventions

- **Test location**: colocated `__tests__/` next to source (matches existing pattern in `domains/auth/`).
- **Module mocks**: provide via NestJS `Test.createTestingModule({...})` with `{ provide: Service, useValue: mockService }`. See `SessionController.test.ts` for the canonical pattern.
- **HTTP**: `supertest` against `app.getHttpServer()`. Don't spin up actual ports in unit/integration tests.
- **DB-touching tests**: use a per-test Postgres schema; never share a schema across `describe` blocks. Truncate on `afterEach`.
- **Network calls**: forbidden in unit tests. Use `nock` for HTTP mocking when needed.
- **Time**: `jest.useFakeTimers()` for any controller that touches `Date.now()` or schedules.
- **Coverage exclusions**: `index.ts`, `main.ts`, `bootstrap.ts`, type-only files, and `__tests__/` are excluded in `jest.config.mjs`.

## 4. Coverage ratchet

`jest.config.mjs` now carries a `coverageThreshold`, and it is **scoped rather than
global** — deliberately, and the config says so: the global number is still low, so a
global floor set to it would be a fence around nothing, while a per-domain floor lets a
new domain land with a real one from day one. Today there is exactly one entry:

```js
coverageThreshold: {
  './src/domains/planning/': {
    statements: 88,
    branches: 76,
    functions: 76,
    lines: 90,
  },
}
```

Note the planning floor is set just under what that suite achieves **without** a database,
because `TaskService.tenancy.integration.test.ts` skips unless `PLANNING_TEST_DATABASE_URL`
is set. A floor that assumed the DB-backed run would fail every laptop.

The ratchet rule is unchanged; apply it per path. Every PR that adds tests should:

1. Land the test.
2. Read the resulting coverage number for that path from `yarn test --coverage` output.
3. Update that path's `coverageThreshold` entry to **the floor of that number** (never
   higher than achieved, never lower than current).

This avoids wishful thresholds. The floor only ever moves up. A global entry is still worth
adding once the global number is high enough to fence — that is the open item here, not the
existence of a threshold.

## 5. CI integration

Where things stand: `.github/workflows/ci.yml` has a **Run backend tests** job
(`yarn workspace @ci/be-api test`, no `--coverage`) and a **Run frontend tests** job
(`yarn workspace @ci/fe-web test --coverage`, uploading an `fe-coverage` artifact),
alongside type-check, lint and a Python job (`ruff`, `mypy`, `uv sync --locked`).

Two gaps remain, and they compound:

1. The backend job does not pass `--coverage`, so the ratchet in §4 is never evaluated in CI.
2. The workflow is `workflow_dispatch`-only, so nothing evaluates it on a pull request either.

`CI-Local-CICD` (or a restored `pull_request` trigger) should run the backend suite with
`--coverage --ci` and fail the build on coverage regression. This is the only enforcement
that makes the ratchet stick; until then the thresholds bind only for whoever runs the
suite locally.

The Marketplace install E2E (planning.md G3) lives separately — Playwright + Docker, run against a Hub + Marketplace + fixture-app stack. That is **not** in this Jest config; it lives in `tests/` at the repo root.

## 6. Test data

`make seed` produces the John Smith demo dataset. Avoid relying on it in unit tests — they should each provision their own minimal fixtures so they survive seed schema changes. Reach for the seed only in E2E flows that legitimately need a realistic graph.

## 7. Open questions

- **Test containers vs. shared Postgres?** Today integration tests reuse the dev Postgres. As volume grows, per-test containers (via `testcontainers-node`) will scale better. Decide before coverage passes 40%.
- **Snapshot tests for GraphQL schemas?** The `graph` controller's SDL is autogenerated; a snapshot test would catch unintended schema changes. Recommend yes once `graph` has unit coverage.
- **Mutation testing?** Stryker would tell us whether our coverage numbers reflect real behavioral coverage. Worth piloting once we cross 50% global.
