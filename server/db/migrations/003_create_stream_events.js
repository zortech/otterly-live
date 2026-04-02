exports.up = (knex) =>
  knex.schema.createTable('stream_events', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('stream_sessions').onDelete('SET NULL');
    t.integer('service_id').references('id').inTable('stream_services').onDelete('SET NULL');
    t.string('platform').notNullable();
    t.string('event_type').notNullable();
    t.string('user_id');
    t.string('username');
    t.text('message');
    t.decimal('amount', 10, 2);
    t.string('currency');
    t.json('raw');
    t.timestamp('occurred_at').notNullable();
    t.timestamps(true, true);
  });

exports.down = (knex) => knex.schema.dropTable('stream_events');
