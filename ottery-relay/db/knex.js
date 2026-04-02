'use strict';

const path = require('path');
const fs   = require('fs');
const knex = require('knex');

const dbPath = path.resolve(process.env.RELAY_DB_PATH ?? './data/relay.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: dbPath },
  useNullAsDefault: true,
  migrations: { directory: path.join(__dirname, 'migrations') },
  pool: {
    afterCreate(conn, done) {
      conn.pragma('journal_mode = WAL');
      conn.pragma('foreign_keys = ON');
      done(null, conn);
    },
  },
});

module.exports = db;
