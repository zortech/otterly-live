exports.up = async (knex) => {
  await knex.schema.alterTable('song_queue', (t) => {
    t.string('session_id').nullable().defaultTo(null);
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_song_queue_session ON song_queue(session_id)');
};

exports.down = async (knex) => {
  await knex.schema.alterTable('song_queue', (t) => {
    t.dropColumn('session_id');
  });
};
