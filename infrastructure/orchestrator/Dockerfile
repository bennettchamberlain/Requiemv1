FROM temporalio/server:1.26.2

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENV DB=postgres12 \
    DB_PORT=5432 \
    BIND_ON_IP=0.0.0.0 \
    SKIP_DB_CREATE=true \
    SKIP_SCHEMA_SETUP=true \
    DEFAULT_DATABASE_USERNAME=temporal \
    DEFAULT_DATABASE_NAME=temporal \
    DEFAULT_DATABASE_HOST=database \
    DEFAULT_VISIBILITY_DATABASE_NAME=temporal_visibility

ENTRYPOINT ["entrypoint.sh"]
