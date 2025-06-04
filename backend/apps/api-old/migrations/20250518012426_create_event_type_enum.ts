import { Knex } from 'knex';

// This is a test migration to kick the Knex tires a little bit.

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_type_enum') THEN
    CREATE TYPE event_type_enum AS ENUM (
      'Call',
      'Comment',
      'Create',
      'Eat',
      'Edit',
      'Exercise',
      'Message',
      'Play',
      'Sleep',
      'Transactions',
      'Travel',
      'View',
      'Visit'
    );
  END IF;
END
$$;
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_type_enum') THEN
    DROP TYPE event_type_enum;
  END IF;
END
$$;
  `);
};
