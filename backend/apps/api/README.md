# Companion Intelligence — Backend API

This backend application serves as the API for the Compan Intelligence server.

## Getting started

See the [parent README](../../../README.md) for instructions on how to get all the prerequisites installed.

You can boot the backend development server with:

```bash
yarn dev
```

## GraphQL API & GraphiQL

The API exposes an Apollo GraphQL endpoint at `POST /graphql` (reached from the browser as
`/api/graphql`, same-origin behind the proxy). It's **code-first** — the schema is assembled
from resolver decorators and emitted to `src/domains/graphql/__generated__/schema.graphql`.
Regenerate the schema and the frontend's typed documents with:

```bash
make graphql                     # from the repo root: backend schema + frontend types
# or just the backend half:
yarn graphql:generate            # → src/domains/graphql/__generated__/schema.graphql
```

Resolvers are guarded by `JwtOrApiKeyAuthGuard`, so requests authenticate with either a
session `Authorization: Bearer <jwt>` or an `x-api-key` header. Explore the schema
interactively with the built-in **GraphiQL** IDE at `/api/graphiql` — reachable from the web
app under **Settings → GraphiQL**, and authenticated by pasting an API key (create one under
**Settings → API Keys**).

**Full reference:** [`docs/graphql-api.md`](../../../docs/graphql-api.md) — endpoint & routing,
authentication, the GraphiQL IDE + API-key flow, codegen workflow, DataLoaders, the query
complexity limit, and Relay pagination conventions.

## Migrations

You can create a new database migration with:

```bash
yarn migrate:make <name>
```

This migration can be applied with:

```bash
yarn migrate

# OR

yarn migrate:up
```

You can rollback a migration with:

```bash
yarn migrate:down
```

## Dependency violations

We use dependency cruiser to validate various imports. If the import check build step fails you should
generally fix these violations. Accepting the new violations you're introducing constitutes an increase
in technical debt. You should comment on this in any PR and decide with your PR reviewer if the trade-off
is worth it.

To accept new violations:

```
yarn depcheck:accept
```
