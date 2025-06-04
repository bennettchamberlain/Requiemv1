import { Knex } from 'knex';

// This is a test migration to kick the Knex tires a little bit.

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT
    );
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    DROP TABLE users;
  `);
};
