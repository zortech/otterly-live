const knex = require('knex');
const path = require('path');
const fs = require('fs');

let _db;

function getDb() {
  if (_db) return _db;

  let dbPath;
  try {
    const { app } = require('electron');
    dbPath = path.join(app.getPath('userData'), 'ottery-live.db');
  } catch {
    // Running outside Electron (npm run server, tests)
    const devDataDir = path.join(process.cwd(), 'dev-data');
    if (!fs.existsSync(devDataDir)) fs.mkdirSync(devDataDir, { recursive: true });
    dbPath = path.join(devDataDir, 'ottery-live.db');
  }

  _db = knex({
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'migrations'),
    },
  });

  _db.raw('PRAGMA journal_mode=WAL').then(() => {});
  _db.raw('PRAGMA foreign_keys=ON').then(() => {});

  return _db;
}

module.exports = getDb();
