import type { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE embeddings (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      original_id uuid references some kind of id,
      original_row TEXT,
      original_tablename TEXT,
      model TEXT,
      raw_input TEXT,
      source_id UUID,
      source_label TEXT,
      source_unique UNIQUE(source_id, source_label),
      embedding_vector VECTOR(768),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    DROP TABLE embeddings;
  `);
};

import type { Knex } from 'knex';

