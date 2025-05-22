import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  // Drop tables if they exist to ensure a clean slate
  await knex.schema.dropTableIfExists('contact');
  await knex.schema.dropTableIfExists('person');

  // Create person table to match js1-user.csv and js1-people.csv
  await knex.schema.createTable('person', (table) => {
    table.string('id').primary();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.string('email').notNullable();
    table.timestamp('created').notNullable();
    table.string('middle_name');
    table.string('gender');
    table.string('address');
    table.string('street_address');
    table.string('street_address_2');
    table.string('city');
    table.string('region');
    table.string('country');
    table.string('postal_code');
    table.string('avatar_url');
    table.specificType('contact_ids', 'text[]');
    table.string('type');
    table.string('external_avatar_url');
    table.boolean('hidden');
    table.specificType('tags', 'text[]');
  });

  // Create contact table to match js1-contact.csv
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
    table.specificType('tags', 'text[]');
    table.timestamp('updated');
    table.string('user_id');
  });
};

exports.down = async function (knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('contact');
  await knex.schema.dropTableIfExists('person');
};
