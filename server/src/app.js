'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const { parseStudentCsv, toCsv, normalizeRollNo, isValidRollNo } = require('./csv');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const DEV_DIR = path.join(__dirname, '..', '..', 'dev');

/** Dev-only QR generator + test scanner. Off unless DEV_TOOLS=1 is set. */
const DEV_TOOLS = process.env.DEV_TOOLS === '1';

/** QR payloads may be bare ("B22CS001") or versioned ("TATHVA:B22CS001"). */
function parseQrPayload(raw) {
  let s = String(raw || '').trim();
  const m = /^(?:TATHVA|TSHIRT)\s*[:|]\s*(.+)$/i.exec(s);
  if (m) s = m[1];
  return normalizeRollNo(s);
}

function rowToStudent(r) {
  if (!r) return null;
  return {
    rollNo: r.roll_no,
    name: r.name,
    tshirtSize: r.tshirt_size,
    collected: r.collected,
    collectedAt: r.collected_at ? new Date(r.collected_at).toISOString() : null,
    collectedBy: r.collected_by,
  };
}

function createApp(options = {}) {
  const query = options.query || db.query;
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '25mb' }));

  // LAN tool: allow the dashboard/phone pages from any local origin, read+write only
  // through these endpoints. No credentials/cookies are used anywhere.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------------------------------------------------------------- health
  app.get('/api/health', asyncRoute(async (req, res) => {
    const r = await query('SELECT count(*)::int AS n FROM students');
    res.json({ ok: true, status: 'OK', students: r.rows[0].n, time: new Date().toISOString() });
  }));

  // Lets the dashboard print the exact URL staff should open on their phones.
  app.get('/api/network', (req, res) => {
    const os = require('os');
    const ips = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) ips.push({ name, address: a.address });
      }
    }
    res.json({
      interfaces: ips,
      httpPort: parseInt(process.env.PORT, 10) || 3000,
      httpsPort: parseInt(process.env.HTTPS_PORT, 10) || (parseInt(process.env.PORT, 10) || 3000) + 443,
    });
  });

  // ---------------------------------------------------------------- lookup
  app.get('/api/students', asyncRoute(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const status = String(req.query.status || 'all');

    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(lower(roll_no) LIKE $${params.length} OR lower(coalesce(name,'')) LIKE $${params.length})`);
    }
    if (status === 'collected') where.push('collected = TRUE');
    if (status === 'pending') where.push('collected = FALSE');

    params.push(limit);
    const sql =
      `SELECT * FROM students ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ` +
      `ORDER BY roll_no LIMIT $${params.length}`;
    const r = await query(sql, params);
    res.json({ count: r.rowCount, students: r.rows.map(rowToStudent) });
  }));

  app.get('/api/students/:rollNo', asyncRoute(async (req, res) => {
    const rollNo = parseQrPayload(req.params.rollNo);
    if (!isValidRollNo(rollNo)) {
      return res.status(400).json({ success: false, status: 'INVALID_ROLL_NO', rollNo });
    }
    const r = await query('SELECT * FROM students WHERE roll_no = $1', [rollNo]);
    if (r.rowCount === 0) {
      return res.status(404).json({ success: false, status: 'NOT_FOUND', rollNo });
    }
    const student = rowToStudent(r.rows[0]);
    res.json({
      success: true,
      status: student.collected ? 'ALREADY_COLLECTED' : 'PENDING',
      student,
    });
  }));

  // ------------------------------------------------------------- collect
  // The critical endpoint. A single conditional UPDATE makes this atomic:
  // concurrent requests for the same roll number can only match the row once.
  app.post('/api/students/:rollNo/collect', asyncRoute(async (req, res) => {
    const rollNo = parseQrPayload(req.params.rollNo);
    if (!isValidRollNo(rollNo)) {
      return res.status(400).json({ success: false, status: 'INVALID_ROLL_NO', rollNo });
    }
    const collectedBy = String((req.body && req.body.collectedBy) || 'unknown').trim().slice(0, 64) || 'unknown';

    const upd = await query(
      `UPDATE students
          SET collected = TRUE,
              collected_at = now(),
              collected_by = $2,
              updated_at = now()
        WHERE roll_no = $1
          AND collected = FALSE
      RETURNING *`,
      [rollNo, collectedBy]
    );

    if (upd.rowCount === 1) {
      const student = rowToStudent(upd.rows[0]);
      // Best-effort audit trail; never fail the collection because of it.
      query(
        'INSERT INTO collection_log (roll_no, tshirt_size, collected_by, collected_at) VALUES ($1,$2,$3,$4)',
        [student.rollNo, student.tshirtSize, student.collectedBy, student.collectedAt]
      ).catch((e) => console.error('[collect] audit log failed:', e.message));
      return res.json({ success: true, status: 'COLLECTED', student });
    }

    const existing = await query('SELECT * FROM students WHERE roll_no = $1', [rollNo]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, status: 'NOT_FOUND', rollNo });
    }
    return res.status(409).json({
      success: false,
      status: 'ALREADY_COLLECTED',
      student: rowToStudent(existing.rows[0]),
    });
  }));

  // ---------------------------------------------------------------- stats
  app.get('/api/stats', asyncRoute(async (req, res) => {
    const totals = await query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE collected)::int AS collected
         FROM students`
    );
    const sizes = await query(
      `SELECT tshirt_size AS size,
              count(*)::int AS total,
              count(*) FILTER (WHERE collected)::int AS collected
         FROM students GROUP BY tshirt_size ORDER BY tshirt_size`
    );
    const recent = await query(
      `SELECT * FROM students WHERE collected = TRUE ORDER BY collected_at DESC LIMIT 20`
    );
    const byStaff = await query(
      `SELECT coalesce(collected_by,'unknown') AS staff, count(*)::int AS count
         FROM students WHERE collected = TRUE GROUP BY 1 ORDER BY count DESC LIMIT 20`
    );
    const total = totals.rows[0].total;
    const collected = totals.rows[0].collected;

    const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    const sizeRows = sizes.rows
      .map((s) => ({ size: s.size, total: s.total, collected: s.collected, remaining: s.total - s.collected }))
      .sort((a, b) => {
        const ia = SIZE_ORDER.indexOf(a.size);
        const ib = SIZE_ORDER.indexOf(b.size);
        if (ia === -1 && ib === -1) return a.size.localeCompare(b.size);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

    res.json({
      total,
      collected,
      remaining: total - collected,
      progress: total === 0 ? 0 : Math.round((collected / total) * 1000) / 10,
      sizes: sizeRows,
      recent: recent.rows.map(rowToStudent),
      byStaff: byStaff.rows,
      time: new Date().toISOString(),
    });
  }));

  // --------------------------------------------------------------- import
  app.post('/api/import', asyncRoute(async (req, res) => {
    const text =
      typeof req.body === 'string' ? req.body : (req.body && req.body.csv) || '';
    if (!String(text).trim()) {
      return res.status(400).json({ success: false, error: 'No CSV content received' });
    }

    const parsed = parseStudentCsv(text);
    if (parsed.error) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    let inserted = 0;
    let updated = 0;
    const failed = [];

    // Re-import NEVER touches collection state: the ON CONFLICT clause updates
    // only name/size.
    const pool = options.pool || db.pool;
    const client = options.client || (await pool.connect());
    try {
      await client.query('BEGIN');
      for (const row of parsed.rows) {
        try {
          const r = await client.query(
            `INSERT INTO students (roll_no, name, tshirt_size)
                  VALUES ($1, $2, $3)
             ON CONFLICT (roll_no) DO UPDATE
                    SET name = COALESCE(EXCLUDED.name, students.name),
                        tshirt_size = EXCLUDED.tshirt_size,
                        updated_at = now()
               RETURNING (xmax = 0) AS was_inserted`,
            [row.rollNo, row.name, row.tshirtSize]
          );
          if (r.rows[0].was_inserted) inserted++;
          else updated++;
        } catch (e) {
          failed.push({ rollNo: row.rollNo, reason: e.message });
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      if (!options.client) client.release();
    }

    res.json({
      success: true,
      summary: {
        totalRows: parsed.totalRows,
        imported: inserted,
        updated,
        duplicatesInFile: parsed.duplicates.length,
        invalid: parsed.invalid.length,
        failed: failed.length,
      },
      duplicates: parsed.duplicates.slice(0, 100),
      invalidRows: parsed.invalid.slice(0, 100),
      failedRows: failed.slice(0, 100),
    });
  }));

  // --------------------------------------------------------------- export
  app.get('/api/export', asyncRoute(async (req, res) => {
    const r = await query('SELECT * FROM students ORDER BY roll_no');
    const rows = [['RollNo', 'Name', 'TshirtSize', 'Collected', 'CollectedAt', 'CollectedBy']];
    for (const s of r.rows) {
      rows.push([
        s.roll_no,
        s.name || '',
        s.tshirt_size,
        s.collected ? 'YES' : 'NO',
        s.collected_at ? new Date(s.collected_at).toISOString() : '',
        s.collected_by || '',
      ]);
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tathva-tshirt-${stamp}.csv"`);
    res.send(toCsv(rows));
  }));

  // ----------------------------------------------------- static frontends
  // Development fixtures, never mounted during a normal `npm start`.
  if (DEV_TOOLS) {
    app.use('/dev', express.static(DEV_DIR, { extensions: ['html'], maxAge: 0 }));
  }

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: 0 }));

  app.use('/api', (req, res) => res.status(404).json({ success: false, status: 'NOT_FOUND', error: 'Unknown endpoint' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    const dbDown = /ECONNREFUSED|database .* does not exist|terminating connection/i.test(err.message);
    res.status(dbDown ? 503 : 500).json({
      success: false,
      status: dbDown ? 'DATABASE_UNAVAILABLE' : 'SERVER_ERROR',
      error: err.message,
    });
  });

  return app;
}

module.exports = { createApp, parseQrPayload, rowToStudent };
