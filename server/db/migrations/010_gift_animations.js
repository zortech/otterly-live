exports.up = async (knex) => {
  await knex.schema.createTable('gift_animations', (t) => {
    t.increments('id').primary();
    t.string('label').notNullable();
    t.string('platform').notNullable();         // 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'facebook' | 'bilibili' | 'joystick' | 'rumble' | 'x'
    t.string('event_type').notNullable();       // 'subscribe' | 'subscribe.gift' | 'cheer' | 'tip' | 'redeem'
    t.string('trigger_key').nullable();         // tiktok giftId / twitch rewardId / sub tier — null = matches all events of this type
    t.integer('min_amount').nullable();         // for cheer (bits) / tip (currency) — match when amount >= min_amount
    t.string('animation_path').notNullable();   // relative path under userData/overlay-assets/, or 'builtin:name'
    t.integer('duration_ms').notNullable().defaultTo(4000);
    t.string('sound_path').nullable();
    t.string('position').notNullable().defaultTo('center'); // 'center' | 'top' | 'bottom' | 'left' | 'right'
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('priority').notNullable().defaultTo(0); // higher = checked first when multiple match
    t.string('created_at').notNullable();
    t.string('updated_at').notNullable();
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_gift_animations_lookup ON gift_animations(platform, event_type, enabled)');
};

exports.down = async (knex) => {
  await knex.schema.dropTable('gift_animations');
};
