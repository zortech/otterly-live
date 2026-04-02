exports.up = (knex) =>
  knex.schema.createTable('stream_sessions', (t) => {
    t.increments('id').primary();
    t.timestamp('started_at').notNullable();
    t.timestamp('ended_at');
    t.string('obs_stream_key');
    t.integer('duration_seconds');
    t.json('stats');
    t.timestamps(true, true);
  });

exports.down = (knex) => knex.schema.dropTable('stream_sessions');
