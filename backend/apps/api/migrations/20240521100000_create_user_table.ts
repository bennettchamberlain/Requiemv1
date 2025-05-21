import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  await knex.schema.createTable('person', (table) => {
    table.string('id').primary();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.timestamp('created').notNullable();
  });
};

exports.down = async function (knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('person');
};
