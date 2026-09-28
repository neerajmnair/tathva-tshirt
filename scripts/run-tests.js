#!/usr/bin/env node
// Runs the test suite against TEST_DATABASE_URL (never the event database).
require('dotenv').config();
const { spawnSync } = require('child_process');

const testUrl =
  process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/tathva_tshirt_test';
if (/tathva_tshirt$/.test(testUrl)) {
  console.error('Refusing to run tests against the live database. Set TEST_DATABASE_URL.');
  process.exit(1);
}

const r = spawnSync('node', ['--test', 'server/test/*.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' },
});
process.exit(r.status === null ? 1 : r.status);
