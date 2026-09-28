#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, connectionString } = require('./db');

async function migrate(client) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await (client || pool).query(sql);
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log(`Schema applied to ${connectionString.replace(/:[^:@/]*@/, ':****@')}`);
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { migrate };
