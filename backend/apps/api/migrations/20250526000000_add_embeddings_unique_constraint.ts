import type { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    ALTER TABLE embeddings 
    ADD CONSTRAINT embeddings_source_unique 
    UNIQUE (source_id, source_label);
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    ALTER TABLE embeddings 
    DROP CONSTRAINT IF EXISTS embeddings_source_unique;
  `);
};
