// Knex migration for job_history table
exports.up = function(knex) {
  return knex.schema.createTable('job_history', function(table) {
    table.string('id').primary();
    table.string('queue').notNullable();
    table.string('type').notNullable();
    table.jsonb('data');
    table.string('status').notNullable();
    table.integer('attempts').defaultTo(0);
    table.jsonb('result');
    table.text('error');
    table.timestamp('createdAt').defaultTo(knex.fn.now());
    table.timestamp('updatedAt').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('job_history');
};
