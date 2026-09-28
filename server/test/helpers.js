'use strict';
const { createApp } = require('../src/app');
const { pool } = require('../src/db');
const { migrate } = require('../src/migrate');

async function startServer() {
  await migrate();
  await pool.query('TRUNCATE students RESTART IDENTITY; TRUNCATE collection_log RESTART IDENTITY;');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

async function api(base, path, options = {}) {
  const res = await fetch(base + path, options);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const postJson = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

module.exports = { startServer, api, postJson, pool };
