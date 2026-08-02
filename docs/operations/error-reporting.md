# Error reporting (Sentry)

CI-Server can report crashes to [Sentry](https://sentry.io). It is **opt-in and
off by default**: with no DSN configured, no Sentry code initialises and no
component makes an outbound connection.

This is the reference implementation for the rest of the first-party fleet —
CI-Planning and CI-Import-Tools follow the same env contract.

## Privacy posture

The appliance holds the user's entire digital life, so reporting is deliberately
narrower than a Sentry default install:

| Setting | Value | Why |
|---|---|---|
| `sendDefaultPii` | `false` | No IPs, cookies, or request bodies. |
| `tracesSampleRate` | `0` | Errors only. Traces would ship request shapes we have no consent to collect. |
| Session replay | not installed | Would record the user's own memories on screen. |
| `beforeSend` | scrubber | Redacts credentials and home paths, drops cookies/body/query string. |

Two kill switches disable reporting even when a DSN is baked into an image, so
an operator can turn it off without a rebuild:

| Variable | Effect |
|---|---|
| `CI_TELEMETRY=off` | Explicit opt-out (also `false`, `0`, `no`, `disabled`). |
| `CI_LOCAL_ONLY=true` | Local-only mode means zero phone-home. See [local-only-mode](https://github.com/companionintelligence/CI-Engineering/blob/main/proposals/local-only-mode.md). |

`CI_LOCAL_ONLY` takes precedence over `CI_TELEMETRY`, which takes precedence
over the DSN.

## What gets scrubbed

`backend/apps/api/src/common/telemetry/scrubEvent.ts` and its Python twins
(`backend/apps/hbpe/src/ci/telemetry.py`,
`backend/apps/summary/src/telemetry.py`) implement the same rules:

- Bearer tokens, `api_key=` / `password:` / `token:` style pairs, Tailscale
  `tskey-…`, and credentials in connection URLs → `[Filtered]`
- Home directories (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`) → `~`,
  since they leak the account name
- Object keys matching `password|secret|token|authorization|cookie|jwt|apikey|dsn|pepper|private_key` → `[Filtered]`
- Request cookies and bodies dropped; query strings filtered
- Strings over 8 KB truncated, so a stray blob can't smuggle memory contents out
  inside an exception message

The browser bundle (`frontend/apps/web/src/lib/telemetry.ts`) additionally strips
the query string and hash from every reported URL and navigation breadcrumb —
on this app those carry the user's search terms — and drops chunk-load and
`ResizeObserver` noise.

## Sentry projects

One project per component, matching the CI-Hub convention:

CI-Server reports into the **`ci-memory`** project in the `companion-intelligence`
org (named for the marketplace app id, matching `ci-import-tools`; CI-Hub's
`hub-backend` / `hub-frontend` / `hub-desktop` predate the convention).

Each component still gets its own DSN variable, and every event carries a
`component` tag, so one project or four both work:

| Component | `component` tag | DSN variable |
|---|---|---|
| `backend/apps/api` | `ci-server-api` | `SENTRY_DSN_API` |
| `frontend/apps/web` | `ci-server-web` | `VITE_SENTRY_DSN` (build time) |
| `backend/apps/hbpe` | `ci-server-hbpe` | `SENTRY_DSN_HBPE` |
| `backend/apps/summary` | `ci-server-summary` | `SENTRY_DSN_SUMMARY` |

Point all four at the same `ci-memory` DSN and filter by `component:` in Sentry,
or split them into per-component projects later without touching any code — the
env contract is the same either way. Compose maps each variable onto the
container's `SENTRY_DSN`, so a service only ever sees the one meant for it.

```
sentry issue list companion-intelligence/ci-memory --query "component:ci-server-hbpe"
```

## Enabling it

```bash
# .env — one DSN per component, all optional
SENTRY_DSN_API=https://<key>@o<org>.ingest.us.sentry.io/<id>
SENTRY_DSN_HBPE=https://<key>@o<org>.ingest.us.sentry.io/<id>
SENTRY_DSN_SUMMARY=https://<key>@o<org>.ingest.us.sentry.io/<id>
SENTRY_ENV=production
CI_SERVER_VERSION=2026.8.1
```

The web DSN is a **build-time** value — it must be present when
`yarn workspace @ci/fe-web build` runs (`make build ENV=production`), not at
container start.

Turning it off again:

```bash
CI_TELEMETRY=off docker compose --profile production up -d
```

## Verifying

```bash
sentry issue list companion-intelligence/ci-memory --query "is:unresolved"
sentry issue view CI-MEMORY-1
```

To confirm reporting is genuinely inert without a DSN, start the API with no
`SENTRY_DSN*` set and check that no request reaches `ingest.sentry.io`.

## Where it hooks in

| Path | Role |
|---|---|
| `backend/apps/api/src/instrument.ts` | `Sentry.init`; must stay the first import in `main.ts` |
| `backend/apps/api/src/common/telemetry/settings.ts` | Resolves the opt-in gate from env |
| `backend/apps/api/src/common/filters/GlobalExceptionsFilter.ts` | Captures unexpected request failures (not 4xx) |
| `backend/apps/api/src/application.ts` | Crash handlers capture + flush before `process.exit` |
| `frontend/apps/web/src/main.tsx` | Calls `initTelemetry()` before render |
| `backend/apps/{hbpe,summary}` | `init_telemetry()` in the FastAPI app and Temporal worker entry points |

## Not wired up yet

- **Release + source map upload in CI.** `publish.yml` does not yet pass
  `VITE_SENTRY_DSN` / `SENTRY_RELEASE` or run `sentry sourcemaps upload`, so
  browser stack traces are minified. CI-Hub's `desktop-release.yml` has the
  pattern to copy.
- **Consent UI.** Reporting is currently an operator-level switch, not a
  user-facing one — the same gap tracked for CI-Hub in
  [security-trust-and-ops](https://github.com/companionintelligence/CI-Engineering/blob/main/architecture/subsystems/security-trust-and-ops.md) (P2).
