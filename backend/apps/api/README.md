# Companion Intelligence — API

This service serves as the Digital Memory backend.
Users will interact with this API using either the SPA webpage or various client apps.

## Getting started

See the parent README.md for instructions on how to get all the prerequisites installed.
You'll want to be sure you have the following infrastructure containers running:

* PostgreSQL
* OpenSearch (currently not used)
* ... more to come

```
docker compose --profile infra up -d
```

Once you've done this, all you'll need to do in this directory is make sure your migrations are consistent with your checked out hash.

```
yarn migrate
```

You can then boot the server.

```
yarn dev
```

If you want to prettify the logs you can pipe them through the included command line formatter `pino-pretty` that works in concert with the logging library of choice `pino`.

```
yarn dev | yarn pino-pretty
```
