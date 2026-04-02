exports.up = (knex) =>
  knex.schema.createTable('settings', (t) => {
    t.string('key').primary();
    t.text('value');
    t.timestamps(true, true);
  });

exports.down = (knex) => knex.schema.dropTable('settings');
