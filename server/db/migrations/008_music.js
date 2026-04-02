exports.up = async (knex) => {
  await knex.schema.createTable('song_queue', (t) => {
    t.increments('id').primary();
    t.string('spotify_track_id').notNullable();
    t.string('track_name').notNullable();
    t.string('artist_name').notNullable();
    t.string('album_name').nullable();
    t.string('album_art_url').nullable();
    t.integer('duration_ms').nullable();
    t.string('requester_platform').nullable();
    t.string('requester_platform_user_id').nullable();
    t.string('requester_username').nullable();
    t.string('requester_display_name').nullable();
    t.string('source').notNullable().defaultTo('request'); // 'request' | 'playlist' | 'streamer'
    t.integer('position').notNullable().defaultTo(0);
    t.string('status').notNullable().defaultTo('queued'); // 'queued' | 'playing' | 'played' | 'removed'
    t.string('twitch_redemption_id').nullable();
    t.string('twitch_reward_id').nullable();
    t.integer('credits_spent').notNullable().defaultTo(0);
    t.string('created_at').notNullable();
    t.string('updated_at').notNullable();
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_song_queue_status ON song_queue(status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_song_queue_position ON song_queue(position)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_song_queue_requester ON song_queue(requester_platform, requester_platform_user_id)');

  await knex.schema.createTable('spotify_admins', (t) => {
    t.increments('id').primary();
    t.string('platform').notNullable();
    t.string('platform_user_id').notNullable();
    t.string('username').notNullable();
    t.string('granted_by').nullable();
    t.string('created_at').notNullable();
    t.unique(['platform', 'platform_user_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('song_queue');
  await knex.schema.dropTable('spotify_admins');
};
