exports.up = async (knex) => {
  await knex.schema.alterTable('stream_events', (t) => {
    t.text('actor_json');
    t.text('data_json');
  });
  // Indices for high-volume event queries
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_stream_events_session_id ON stream_events(session_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_stream_events_platform ON stream_events(platform)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_stream_events_event_type ON stream_events(event_type)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_stream_events_occurred_at ON stream_events(occurred_at)');
};

exports.down = async (knex) => {
  await knex.schema.alterTable('stream_events', (t) => {
    t.dropColumn('actor_json');
    t.dropColumn('data_json');
  });
};
