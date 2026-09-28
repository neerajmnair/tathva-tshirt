'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, api, postJson, pool } = require('./helpers');

const CSV = `RollNo,Name,TshirtSize
B22CS001,Alpha One,M
b22cs002 ,Beta Two,large
B22CS003,Gamma Three,XXL
B22CS003,Gamma Dup,L
,No Roll,M
B22CS004,No Size,
B22CS005,Epsilon,2XL
`;

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); await pool.end(); });

test('health responds', async () => {
  const r = await api(srv.base, '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('CSV import reports totals, duplicates and invalid rows', async () => {
  const r = await api(srv.base, '/api/import', postJson({ csv: CSV }));
  assert.equal(r.status, 200);
  const s = r.body.summary;
  assert.equal(s.totalRows, 7);
  assert.equal(s.imported, 4);            // CS001, CS002, CS003, CS005
  assert.equal(s.updated, 0);
  assert.equal(s.duplicatesInFile, 1);    // second B22CS003
  assert.equal(s.invalid, 2);             // missing roll, missing size
});

test('import rejects a CSV with missing required columns', async () => {
  const r = await api(srv.base, '/api/import', postJson({ csv: 'Foo,Bar\n1,2\n' }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Missing required column/);
});

test('roll numbers and sizes are normalized on import', async () => {
  const r = await api(srv.base, '/api/students/B22CS002');
  assert.equal(r.status, 200);
  assert.equal(r.body.student.rollNo, 'B22CS002');
  assert.equal(r.body.student.tshirtSize, 'L');
  const r2 = await api(srv.base, '/api/students/B22CS005');
  assert.equal(r2.body.student.tshirtSize, 'XXL');
});

test('lookup: found, pending', async () => {
  const r = await api(srv.base, '/api/students/B22CS001');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'PENDING');
  assert.equal(r.body.student.name, 'Alpha One');
  assert.equal(r.body.student.tshirtSize, 'M');
  assert.equal(r.body.student.collected, false);
});

test('lookup is case-insensitive and accepts TATHVA: QR prefix', async () => {
  const bare = await api(srv.base, '/api/students/b22cs001');
  assert.equal(bare.body.student.rollNo, 'B22CS001');
  const prefixed = await api(srv.base, '/api/students/' + encodeURIComponent('TATHVA:b22cs001'));
  assert.equal(prefixed.body.student.rollNo, 'B22CS001');
});

test('lookup: unknown roll number returns NOT_FOUND', async () => {
  const r = await api(srv.base, '/api/students/B22ZZ999');
  assert.equal(r.status, 404);
  assert.equal(r.body.status, 'NOT_FOUND');
});

test('lookup: malformed QR payload returns INVALID_ROLL_NO', async () => {
  const r = await api(srv.base, '/api/students/' + encodeURIComponent('!!'));
  assert.equal(r.status, 400);
  assert.equal(r.body.status, 'INVALID_ROLL_NO');
});

test('collect marks the student and returns the size', async () => {
  const r = await api(srv.base, '/api/students/B22CS001/collect', postJson({ collectedBy: 'Phone A' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.status, 'COLLECTED');
  assert.equal(r.body.student.tshirtSize, 'M');
  assert.equal(r.body.student.collectedBy, 'Phone A');
  assert.ok(r.body.student.collectedAt);
});

test('second collect on the same student is rejected', async () => {
  const r = await api(srv.base, '/api/students/B22CS001/collect', postJson({ collectedBy: 'Phone B' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.success, false);
  assert.equal(r.body.status, 'ALREADY_COLLECTED');
  assert.equal(r.body.student.collectedBy, 'Phone A');   // first writer wins
});

test('collect on an unknown roll number returns NOT_FOUND', async () => {
  const r = await api(srv.base, '/api/students/B22ZZ999/collect', postJson({ collectedBy: 'Phone A' }));
  assert.equal(r.status, 404);
  assert.equal(r.body.status, 'NOT_FOUND');
});

test('10 simultaneous collects on one student: exactly one succeeds', async () => {
  const requests = Array.from({ length: 10 }, (_, i) =>
    api(srv.base, '/api/students/B22CS002/collect', postJson({ collectedBy: `Phone ${i}` }))
  );
  const results = await Promise.all(requests);
  const ok = results.filter((r) => r.body.success === true);
  const already = results.filter((r) => r.body.status === 'ALREADY_COLLECTED');
  assert.equal(ok.length, 1, 'exactly one collection may succeed');
  assert.equal(already.length, 9);
  const log = await pool.query('SELECT count(*)::int AS n FROM collection_log WHERE roll_no = $1', ['B22CS002']);
  assert.equal(log.rows[0].n, 1);
});

test('different phones can collect different students concurrently', async () => {
  const [a, b] = await Promise.all([
    api(srv.base, '/api/students/B22CS003/collect', postJson({ collectedBy: 'Phone A' })),
    api(srv.base, '/api/students/B22CS005/collect', postJson({ collectedBy: 'Phone B' })),
  ]);
  assert.equal(a.body.success, true);
  assert.equal(b.body.success, true);
});

test('stats reflect collections and size breakdown', async () => {
  const r = await api(srv.base, '/api/stats');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4);
  assert.equal(r.body.collected, 4);
  assert.equal(r.body.remaining, 0);
  assert.equal(r.body.progress, 100);
  const m = r.body.sizes.find((s) => s.size === 'M');
  assert.deepEqual({ total: m.total, collected: m.collected }, { total: 1, collected: 1 });
  assert.ok(r.body.recent.length >= 4);
  assert.ok(r.body.byStaff.some((s) => s.staff === 'Phone A'));
});

test('re-import does not clear collection status and updates size', async () => {
  const r = await api(srv.base, '/api/import', postJson({
    csv: 'RollNo,Name,TshirtSize\nB22CS001,Alpha One,XL\nB22CS009,New Person,S\n',
  }));
  assert.equal(r.body.summary.imported, 1);
  assert.equal(r.body.summary.updated, 1);
  const s = await api(srv.base, '/api/students/B22CS001');
  assert.equal(s.body.student.collected, true, 'collection status must survive re-import');
  assert.equal(s.body.student.collectedBy, 'Phone A');
  assert.equal(s.body.student.tshirtSize, 'XL', 'size corrections should apply');
});

test('search by roll number and by name', async () => {
  const byRoll = await api(srv.base, '/api/students?search=B22CS00');
  assert.ok(byRoll.body.count >= 4);
  const byName = await api(srv.base, '/api/students?search=alpha');
  assert.equal(byName.body.students[0].rollNo, 'B22CS001');
  const pending = await api(srv.base, '/api/students?status=pending');
  assert.equal(pending.body.students.every((s) => !s.collected), true);
});

test('CSV export contains the collection columns', async () => {
  const res = await fetch(srv.base + '/api/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const text = await res.text();
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], 'RollNo,Name,TshirtSize,Collected,CollectedAt,CollectedBy');
  assert.equal(lines.length, 6); // header + 5 students
  assert.match(text, /B22CS001,Alpha One,XL,YES,/);
});

test('data persists across a server restart', async () => {
  await srv.close();
  const app = require('../src/app').createApp();
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await api(base, '/api/students/B22CS001');
  assert.equal(r.body.student.collected, true);
  srv = { base, close: () => new Promise((r2) => server.close(r2)) };
});
