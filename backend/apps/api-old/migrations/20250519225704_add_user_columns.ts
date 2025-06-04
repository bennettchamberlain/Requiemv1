import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    ALTER TABLE users
    ADD COLUMN email TEXT UNIQUE,
    ADD COLUMN password TEXT;
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    ALTER TABLE users
    DROP COLUMN email,
    DROP COLUMN password;
  `);
};
