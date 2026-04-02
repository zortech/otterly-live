#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path   = require('path');

// Resolve the DB path the same way the server does
process.env.RELAY_DB_PATH = process.env.RELAY_DB_PATH ?? './data/relay.db';
const db = require('./db/knex');

// ---- Exported command functions (also called by tests) -----------------

async function addUser(username) {
  await db.migrate.latest();
  const existing = await db('users').where({ username }).first();
  if (existing) {
    console.error(`Error: user '${username}' already exists`);
    return null;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const hash  = await bcrypt.hash(token, 12);
  await db('users').insert({ username, api_token_hash: hash, active: true });

  const bar = '='.repeat(64);
  console.log([
    bar,
    `  User created: ${username}`,
    `  Token       : ${token}`,
    '',
    '  Copy this token — it is shown ONCE and cannot be recovered.',
    '  Share it with the user out of band (e.g. Signal/Discord DM).',
    bar,
  ].join('\n'));

  return token;
}

async function listUsers() {
  await db.migrate.latest();
  const users = await db('users').select('id', 'username', 'active', 'created_at').orderBy('id');
  if (users.length === 0) {
    console.log('No users.');
    return users;
  }
  console.log('\n  ID  Username             Active  Created');
  console.log('  ' + '-'.repeat(52));
  for (const u of users) {
    const id       = String(u.id).padEnd(4);
    const name     = u.username.padEnd(20);
    const active   = u.active ? 'yes   ' : 'no    ';
    const created  = u.created_at ?? '—';
    console.log(`  ${id}${name}${active}${created}`);
  }
  console.log('');
  return users;
}

async function removeUser(username) {
  await db.migrate.latest();
  const user = await db('users').where({ username }).first();
  if (!user) {
    console.error(`Error: user '${username}' not found`);
    return false;
  }
  await db('users').where({ username }).update({ active: false });
  console.log(`User '${username}' deactivated. Existing sessions will be rejected on next auth check.`);
  return true;
}

async function rotateToken(username) {
  await db.migrate.latest();
  const user = await db('users').where({ username }).first();
  if (!user) {
    console.error(`Error: user '${username}' not found`);
    return null;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const hash  = await bcrypt.hash(token, 12);
  await db('users').where({ username }).update({ api_token_hash: hash });

  const bar = '='.repeat(64);
  console.log([
    bar,
    `  New token for: ${username}`,
    `  Token        : ${token}`,
    '',
    '  Copy this token — it is shown ONCE. The old token is invalid.',
    bar,
  ].join('\n'));

  return token;
}

// ---- CLI entry point ---------------------------------------------------

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  try {
    switch (cmd) {
      case 'add-user':
        if (!arg) { console.error('Usage: node cli.js add-user <username>'); process.exit(1); }
        await addUser(arg);
        break;

      case 'list-users':
        await listUsers();
        break;

      case 'remove-user':
        if (!arg) { console.error('Usage: node cli.js remove-user <username>'); process.exit(1); }
        if (!await removeUser(arg)) process.exit(1);
        break;

      case 'rotate-token':
        if (!arg) { console.error('Usage: node cli.js rotate-token <username>'); process.exit(1); }
        if (!await rotateToken(arg)) process.exit(1);
        break;

      default:
        console.log([
          'Usage:',
          '  node cli.js add-user <username>',
          '  node cli.js list-users',
          '  node cli.js remove-user <username>',
          '  node cli.js rotate-token <username>',
        ].join('\n'));
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// Only run main() when invoked directly, not when required by tests
if (require.main === module) main();

module.exports = { addUser, listUsers, removeUser, rotateToken };
