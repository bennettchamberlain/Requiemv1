# Scoria

Scoria is the slim, local-only successor to CI-Server: a Dart server appliance
in front of **Napalm v2** (a Gel/EdgeDB fork) plus a Flutter client. Napalm owns
schema, access policies, vectors and files; the Dart side owns what a database
should not — sign-in, ingest, embeddings, and the PGBoss job runner. No Portal,
no GraphQL, no Prisma. The old CI-Server tree (`backend/`, `app/` web, …) stays
in this repo until each slice is rewritten; new code lives in the paths below.

```
schema/                 Napalm SDL, migrations, seeds, named queries (the API contract)
  dbschema/default.gel  Person, Relationship/Tier, ConsentGrant, Owned, Position,
                        Presence, Encounter, MemoryItem, JobRecord, Ask
  queries/*.edgeql      me, memory_feed/get/search/upsert, position_insert_many,
                        presence_overlap, jobs_list  (deployable as /query/{name})
packages/
  scoria_models         Plain Dart models shared by client and server
  scoria_api_client     HTTP client used by Flutter (and tests)
  scoria_jobs           PGBoss 10 schema + queue + runner in Dart (raw Postgres)
server/scoria_api       shelf server: /auth/signin, /me, /memory, /positions,
                        /presence/overlap/:id, /jobs, /admin/people
server/scoria_voice     Python: PersonaPlex full-duplex voice (toggle on/off) + whisper
                        STT + Ollama "brain" with memory/web/time/persona tools;
                        /console, /api/chat (WS), /api/events (SSE). See its README.
app/                    Flutter (very_good, bloc): sign_in, memory, jobs features
napalmv2/               git submodule — the database
```

## Run locally

```sh
# 1. database (either Gel 7 from docker for now, or Napalm from source)
docker run -d --name scoria-gel -p 127.0.0.1:5656:5656 \
  -e GEL_SERVER_SECURITY=insecure_dev_mode geldata/gel:7
docker run -d --name scoria-pg -p 127.0.0.1:5433:5432 \
  -e POSTGRES_USER=scoria -e POSTGRES_PASSWORD=scoria -e POSTGRES_DB=scoria postgres:17

# 2. schema
cd schema && GEL_DSN=gel://admin@127.0.0.1:5656/main GEL_CLIENT_TLS_SECURITY=insecure \
  gel migrate && for f in seed/*.edgeql; do gel query -f $f; done

# 3. server
cd server/scoria_api && SCORIA_SESSION_SECRET=$(openssl rand -hex 32) \
  SCORIA_PG_URL=postgres://scoria:scoria@127.0.0.1:5433/scoria \
  SCORIA_QUERIES_DIR=../../schema/queries dart run bin/main.dart   # :8080

# 4. app
cd app && flutter run -d linux --dart-define=SCORIA_API_URL=http://localhost:8080

# 5. voice (optional; needs the HF token + Ollama) — see server/scoria_voice/README.md
cd server/scoria_voice && HF_TOKEN_FILE=~/devel/mynamehf.txt SCORIA_HANDLE=admin \
  SCORIA_PASSWORD=… VOICE_SSL_DIR=/tmp/voice-ssl .venv/bin/scoria-voice   # https://localhost:8998/console
```

Napalm from source (owns Postgres via `--backend-dsn`):

```sh
cd napalmv2 && .venv/bin/edb server --devmode -P 5657 \
  --backend-dsn postgres://scoria:scoria@127.0.0.1:5433/napalm \
  --tls-cert-mode generate_self_signed --security insecure_dev_mode
```

## Sharing model (two layers)

* **Row gate — Napalm policies.** Owner sees everything. Others see a row only
  if `Relationship.tier` meets `TierAccess` for that `data_class`, or an auto
  `ConsentGrant` exists, and no block (`ConsentGrant.mode = block`) applies.
  `sensitive` rows (raw `Position`) never pass a tier default.
* **Answer shape — scoria-api.** Cross-person questions run over derived
  classes (`Presence`, `Encounter`), and the disclosure ceiling stamped at
  consent decides what shape the answer takes (boolean, count, summary, …).

Policies apply to every role including superadmin; `is_superadmin` is a flag
on `Person` that unlocks admin *actions* (create people), not data.
