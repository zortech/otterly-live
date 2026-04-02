exports.up = async (knex) => {
  await knex.schema.createTable('credit_transactions', (t) => {
    t.increments('id').primary();
    t.integer('viewer_id').notNullable().references('id').inTable('viewer_credits').onDelete('CASCADE');
    t.integer('delta').notNullable();
    // 'chat' | 'gift' | 'manual' | 'admin_set' | 'spend'
    t.string('reason').notNullable();
    t.string('reference_event_id').nullable(); // links to stream_events.id
    t.text('note').nullable();
    t.string('created_at').notNullable();
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_credit_tx_viewer ON credit_transactions(viewer_id, created_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_credit_tx_created ON credit_transactions(created_at)');
};

exports.down = async (knex) => {
  await knex.schema.dropTable('credit_transactions');
};
