FROM postgres:16

RUN apt-get update && \
    apt-get install -y postgresql-server-dev-16 git build-essential && \
    git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git && \
    cd pgvector && \
    make && make install && \
    cd .. && rm -rf pgvector && \
    apt-get remove -y git build-essential && \
    apt-get autoremove -y && \
    apt-get clean
