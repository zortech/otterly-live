exports.up = (knex) =>
  knex.schema.createTable('stream_services', (t) => {
    t.increments('id').primary();
    t.string('platform').notNullable();
    t.string('display_name').notNullable();
    t.string('rtmp_url').notNullable();
    t.string('username');
    t.boolean('restream_enabled').defaultTo(true);
    t.boolean('event_capture_enabled').defaultTo(true);
    t.boolean('auto_start').defaultTo(true);
    t.boolean('active').defaultTo(true);
    t.string('api_token_expires_at');
    t.boolean('needs_reauth').defaultTo(false);
    t.json('metadata');
    t.timestamps(true, true);
  });

exports.down = (knex) => knex.schema.dropTable('stream_services');
