const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL || 'postgresql://localhost:5432/tathva_tshirt';

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, connectionString };
