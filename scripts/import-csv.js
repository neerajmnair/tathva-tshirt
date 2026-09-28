#!/usr/bin/env node
// CLI import:  npm run import -- sample-data/students.csv
require('dotenv').config();
const fs = require('fs');
const { pool } = require('../server/src/db');
const { migrate } = require('../server/src/migrate');
const { parseStudentCsv } = require('../server/src/csv');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run import -- <file.csv>');
    process.exit(1);
  }
  await migrate();
  const parsed = parseStudentCsv(fs.readFileSync(file, 'utf8'));
  if (parsed.error) {
    console.error('Import failed:', parsed.error);
    process.exit(1);
  }
  let inserted = 0;
  let updated = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of parsed.rows) {
      const r = await client.query(
        `INSERT INTO students (roll_no, name, tshirt_size) VALUES ($1,$2,$3)
         ON CONFLICT (roll_no) DO UPDATE SET name = COALESCE(EXCLUDED.name, students.name),
              tshirt_size = EXCLUDED.tshirt_size, updated_at = now()
         RETURNING (xmax = 0) AS was_inserted`,
        [row.rollNo, row.name, row.tshirtSize]
      );
      if (r.rows[0].was_inserted) inserted++; else updated++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`Rows in file:      ${parsed.totalRows}`);
  console.log(`New students:      ${inserted}`);
  console.log(`Existing updated:  ${updated}  (collection status untouched)`);
  console.log(`Duplicates in CSV: ${parsed.duplicates.length}`);
  console.log(`Invalid rows:      ${parsed.invalid.length}`);
  for (const i of parsed.invalid.slice(0, 20)) console.log(`  line ${i.line}: ${i.rollNo} - ${i.reason}`);
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
