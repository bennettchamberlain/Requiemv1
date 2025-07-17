# Companion Intelligence — Backend API

This backend application serves as the API for the Compan Intelligence server.

## Getting started

See the [parent README](../../../README.md) for instructions on how to get all the prerequisites installed.

You can boot the backend development server with:

```bash
yarn dev
```

If you prefer, you can enable prettified logs with:

```bash
yarn dev:pretty
```

## Migrations

You can create a new database migration with:

```bash
yarn migrate:make
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
