# GraphQL API & GraphiQL

> CI-Server exposes its personal-memory graph (entities, relationships, files, events,
> summaries, predictions) through a single **Apollo GraphQL** endpoint, alongside REST.
> This doc covers the endpoint, how to authenticate (session JWT **or** API key), the
> in-app **GraphiQL** IDE, and the code-first schema / codegen workflow.

## Endpoint & routing

| | Path (browser) | Backend route | Method |
|---|---|---|---|
| GraphQL | `/api/graphql` | `POST /graphql` | `POST` |
| GraphiQL IDE | `/api/graphiql` | `GET /graphiql` | `GET` |

The app is served **same-origin**: a reverse proxy (Caddy under `make dev`, nginx/Cloudflare
in production) terminates TLS and strips the `/api` prefix before forwarding to the NestJS
API — so the browser calls `/api/graphql` and the API sees `/graphql`. There is no CORS hop.
See the routing note in the [root README](../README.md) (`/api` and `/graphql` → api).

The Apollo driver is configured in
[`backend/apps/api/src/domains/graphql/index.ts`](../backend/apps/api/src/domains/graphql/index.ts):
`introspection` is **on** (GraphiQL needs it), while Apollo's own `playground` and `graphiql`
landing pages are **off** — CI-Server serves its own GraphiQL page instead (see below), kept
on a separate `/graphiql` route so it never collides with the Apollo handler on `/graphql`.

## Authentication

Every resolver is guarded by
[`JwtOrApiKeyAuthGuard`](../backend/apps/api/src/common/guards/JwtOrApiKeyAuthGuard.ts),
which accepts **any** of:

| Credential | Header | Who uses it |
|---|---|---|
| Session JWT | `Authorization: Bearer <accessToken>` | The web app (Apollo client attaches it — see [`ApolloProvider.tsx`](../frontend/apps/web/src/api/ApolloProvider.tsx)) |
| API key | `x-api-key: <key>` | Service callers, scripts, external apps, GraphiQL |
| Portal OIDC token | `Authorization: Bearer <token>` | Portal-brokered SSO (gated by `auth.portal.enabled`) |

Unauthenticated requests get `401`. A handful of trivial fields (e.g. `{ __typename }`)
resolve without a user, but anything touching data requires a credential.

### API keys

API keys are the mechanism for **granting other applications access to your account** —
the same keys the mobile Siri/Shortcuts intents and OpenClaw use.

- **Create/manage in the UI:** Settings → **API Keys**
  ([`ApiKeysSection.tsx`](../frontend/apps/web/src/pages/SettingsPage/sections/ApiKeysSection.tsx)).
  You can name a key, set an optional expiry, and you see the full key value **once** at
  creation — only a short prefix is stored/displayed afterward.
- **Or via REST:** `POST /api/keys` (JWT-guarded), `GET /api/keys`, `PATCH /api/keys/:id`,
  `DELETE /api/keys/:id`
  ([`ApiKeyController.ts`](../backend/apps/api/src/domains/auth/controllers/ApiKeyController.ts)).
- **Send** the key as the `x-api-key` header. It is validated by
  [`ApiKeyStrategy`](../backend/apps/api/src/domains/auth/services/ApiKeyStrategy.ts), which
  resolves it to the owning user and populates the request context.
- Keys carry optional `scopes` and `expires_at`; an expired key is rejected.

```bash
# Query the API with a key
curl -sX POST https://<host>/api/graphql \
  -H 'content-type: application/json' \
  -H "x-api-key: $CI_API_KEY" \
  -d '{"query":"{ events(first: 5) { edges { node { id title } } } }"}'
```

## GraphiQL IDE

CI-Server ships the official [GraphiQL](https://github.com/graphql/graphiql) IDE for
exploring the schema and running queries interactively.

**Open it:** Settings → **GraphiQL** (opens `/api/graphiql` in a new tab). It's a full-page
IDE served by the API — [`GraphQLController`](../backend/apps/api/src/domains/graphql/controllers/GraphQLController.ts)
returns the page from
[`graphiql.html.ts`](../backend/apps/api/src/domains/graphql/controllers/graphiql.html.ts)
(the markup is inlined as a string, not a static asset, so it ships in the `tsc`-built
`dist` without an asset-copy step).

**Authenticate with an API key:**

1. Create a key under Settings → API Keys (above).
2. In GraphiQL's top bar, paste it into the **API key** field and click **Save**. It is
   persisted in `localStorage` (`ci-graphiql-api-key`) and attached as `x-api-key` on every
   request; the status pill turns green (`key active`). **Clear** removes it.
3. Run queries. The fetcher POSTs to `/api/graphql`; if a session `accessToken` happens to
   be in `localStorage` it is also sent as a `Bearer` token, so an existing web session
   keeps working without a key.

> Because GraphiQL authenticates per-request from the pasted key (not a cookie/session), it
> works in a standalone tab or bookmark. Access it through the app origin (`/api/graphiql`)
> so the proxy resolves `/api/graphql`; hitting the raw backend port directly won't have the
> `/api` prefix.

**Theming:** the page is themed to the CI palette (mint `#58ebbf` → teal `#409b9b` → aqua
`#00a9a7` on the ink `#041620` ground). GraphiQL 2.x reads its colors from HSL-component
custom properties (`--color-base` / `--color-neutral` / `--color-primary|secondary|tertiary`)
and toggles `body.graphiql-dark` / `body.graphiql-light`; `graphiql.html.ts` overrides those
by mirroring GraphiQL's own theme selectors (so the declarations tie on specificity and win
on source order), and defaults the IDE to CI's dark theme. To re-skin it, edit those variable
blocks. Bumping `GRAPHIQL_VERSION` may change the internal theme selectors — re-check them if
you upgrade.

> **User-facing version:** the "API Playground (GraphiQL)" walkthrough for end users lives on
> the **Companion Memory** page in CI-Docs
> (`src/content/docs/first-party-apps/digital-memory-server.mdx` → *API Access*).

## Schema & code generation

The schema is **code-first**: it's assembled from NestJS resolver decorators, not
hand-written SDL. `autoSchemaFile` emits the SDL to
[`backend/apps/api/src/domains/graphql/__generated__/schema.graphql`](../backend/apps/api/src/domains/graphql/__generated__/schema.graphql)
— a **generated, do-not-edit** artifact that the frontend codegen consumes.

Regenerate after changing resolvers/types:

```bash
make graphql          # schema (backend) + typed hooks/fragments (frontend)

# …equivalently, run the two halves yourself:
yarn workspace @ci/be-api graphql:generate   # resolvers → __generated__/schema.graphql (no DB needed)
yarn workspace @ci/fe-web graphql:generate   # schema.graphql → frontend/apps/web/src/graphql/
```

The frontend step reads the emitted schema to produce typed documents under
`frontend/apps/web/src/graphql/` (see the web app's `graphql-codegen` setup). If you see
merge conflicts in the generated `gql.ts`/`graphql.ts`, **regenerate** rather than
hand-merging.

## Architecture

Everything lives under `backend/apps/api/src/domains/graphql/`:

| Piece | What it does |
|---|---|
| `resolvers/` (29) | One resolver per domain type (Event, Person, Place, Content, Note, Connection, Summary, Search, …). Field/query/mutation resolvers, each `@UseGuards(JwtOrApiKeyAuthGuard)`. |
| `loaders/` (16) | Per-request **DataLoaders** that batch child lookups (e.g. `EventLoader`, `PersonLoader`, `TagLoader`) to avoid N+1 queries. |
| `plugins/ComplexityPlugin.ts` | Rejects overly expensive queries. Estimated complexity is capped at `graphql.maxQueryComplexity` (**default 150**, see [`config/default.json`](../backend/apps/api/config/default.json)); over the cap returns a `Query is too complex` error before execution. |
| `types/` | GraphQL object/input/connection types. |
| `__generated__/schema.graphql` | Emitted SDL (generated). |

### Query conventions

The schema follows **Relay** conventions:

- **Global object identity** — a `Node` interface and a top-level `node(id: ID!): Node`
  field; most types are addressable by opaque `ID`.
- **Cursor pagination** — list fields return `*Connection` types with
  `edges { node, cursor }` + `pageInfo`, and accept `first`/`after` (forward) or
  `last`/`before` (backward). Prefer these over unbounded lists.

```graphql
query RecentEvents {
  events(first: 20) {
    edges { node { id title startTime } cursor }
    pageInfo { hasNextPage endCursor }
  }
}
```

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `401 Unauthorized` from GraphiQL | No/expired key. Create one in Settings → API Keys and Save it in the GraphiQL bar. |
| `Error fetching schema` in GraphiQL when hitting the backend port directly | The fetcher targets `/api/graphql`; open GraphiQL via the app origin (`/api/graphiql`) so the proxy maps `/api/graphql` → `/graphql`. |
| `Query is too complex: N` | Exceeds `graphql.maxQueryComplexity`. Request fewer fields / smaller `first`, or raise the limit in config. |
| Frontend types out of date after a resolver change | Run `make graphql` (or the two `graphql:generate` steps). |
