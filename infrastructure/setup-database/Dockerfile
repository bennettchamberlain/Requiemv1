FROM postgres:16-alpine

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENV DEFAULT_ADMIN_USERNAME=postgres \
    DEFAULT_HOST=database \
    DEFAULT_COMPANION_USERNAME=companion \
    DEFAULT_COMPANION_DATABASE=companion \
    DEFAULT_ORCHESTRATOR_USERNAME=temporal \
    DEFAULT_ORCHESTRATOR_DATABASE=temporal

ENTRYPOINT ["entrypoint.sh"]
