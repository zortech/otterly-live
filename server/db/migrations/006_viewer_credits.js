exports.up = async (knex) => {
  await knex.schema.createTable('viewer_credits', (t) => {
    t.increments('id').primary();
    t.string('platform').notNullable();
    t.string('platform_user_id').notNullable();
    t.string('username').notNullable();
    t.string('display_name').notNullable();
    t.string('avatar_url').nullable();
    t.integer('credits').notNullable().defaultTo(0);
    t.string('last_seen_at').notNullable();
    t.string('created_at').notNullable();
    t.string('updated_at').notNullable();
    t.unique(['platform', 'platform_user_id']);
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_viewer_credits_lookup ON viewer_credits(platform, platform_user_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_viewer_credits_credits ON viewer_credits(credits DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_viewer_credits_last_seen ON viewer_credits(last_seen_at DESC)');
};

exports.down = async (knex) => {
  await knex.schema.dropTable('viewer_credits');
};
