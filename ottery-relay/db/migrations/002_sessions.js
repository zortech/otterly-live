'use strict';

exports.up = (knex) =>
  knex.schema.createTable('sessions', (t) => {
    t.increments('id').primary();
    t.string('session_id').notNullable().unique();    // UUID v4 — returned to client
    t.string('ingest_token').notNullable().unique();  // UUID v4 — used as RTMPS stream key
    t.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('state').notNullable().defaultTo('pending'); // pending | active | ended
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('ended_at').nullable();
    // NOTE: stream keys (platforms[].streamKey) are NEVER stored here.
    // They live in the in-memory activeSessions Map only for the session lifetime.
  });

exports.down = (knex) => knex.schema.dropTable('sessions');
