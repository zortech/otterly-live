'use strict';

exports.up = (knex) =>
  knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username').notNullable().unique();
    t.string('api_token_hash').notNullable();   // bcrypt(cost=12) of 64-char hex token
    t.boolean('active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTable('users');
