import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  await knex.schema.createTable('contact', (table) => {
    table.string('id').primary();
    table.string('avatar_url');
    table.string('connection_id');
    table.timestamp('created');
    table.string('handle');
    table.boolean('hidden');
    table.string('identifier');
    table.string('name');
    table.string('provider_id');
    table.string('provider_name');
    table.string('remote_id');
    table.string('tags'); // If tags is an array, adjust to table.specificType('tags', 'text[]')
    table.timestamp('updated');
    table.string('user_id');
  });
};

exports.down = async function (knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('contact');
};
