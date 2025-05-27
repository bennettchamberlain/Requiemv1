
import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`

    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE questions (
      id UUID PRIMARY KEY,
      created TIMESTAMP,
      updated TIMESTAMP,
      tag UUID[], -- assuming tag IDs are UUIDs
      category TEXT,
      user_id uuid REFERENCES person(id), -- assuming a 'person' table with UUID as id
      question_string TEXT,
      question_string_vector VECTOR(768),
      example_answer_1 TEXT,
      example_answer_1_vector VECTOR(768),
      example_answer_2 TEXT,
      example_answer_3 TEXT
    );
    CREATE TABLE answers (
      id UUID PRIMARY KEY,
      created TIMESTAMP,
      updated TIMESTAMP,
      user_id uuid REFERENCES person(id),
      question_id uuid REFERENCES questions(id),
      rag_answer_1 TEXT,
      rag_answer_2 TEXT,
      rag_answer_3 TEXT,
      give_answer_current TEXT,
      give_answer_2 TEXT,
      give_answer_3 TEXT,
      give_answer_4 TEXT,
      give_answer_5 TEXT
    );
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    DROP TABLE questions;
    DROP TABLE answers;
  `);
};


