FROM temporalio/admin-tools:1.26.2

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENV DEFAULT_DATABASE_USERNAME=temporal \
    DEFAULT_DATABASE_NAME=temporal \
    DEFAULT_DATABASE_HOST=database

ENTRYPOINT ["entrypoint.sh"]
