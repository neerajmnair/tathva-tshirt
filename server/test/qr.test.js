'use strict';
// Round-trip check: a QR produced by the student portal must decode with the
// same library the phone scanner uses, and the server must accept the payload.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseQrPayload } = require('../src/app');
const { isValidRollNo } = require('../src/csv');

const ROOT = path.join(__dirname, '..', '..');

function generate(payload) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'qr-portal/qrcode.min.js'), 'utf8'), sandbox);
  const qrcode = sandbox.qrcode || sandbox.window.qrcode;
  const q = qrcode(0, 'M');
  q.addData(payload);
  q.make();
  const n = q.getModuleCount(), scale = 6, quiet = 4, size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const o = ((((r + quiet) * scale + y) * size) + ((c + quiet) * scale + x)) * 4;
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

function decode(payload) {
  const jsQR = require(path.join(ROOT, 'public/vendor/jsqr.js'));
  const { data, size } = generate(payload);
  const res = jsQR(data, size, size);
  return res && res.data;
}

test('portal QR decodes with the scanner library (plain payload)', () => {
  assert.equal(decode('B220123CS'), 'B220123CS');
});

test('portal QR decodes with the scanner library (versioned payload)', () => {
  assert.equal(decode('TATHVA:B22CS001'), 'TATHVA:B22CS001');
});

test('server accepts both payload formats', () => {
  assert.equal(parseQrPayload('B22CS001'), 'B22CS001');
  assert.equal(parseQrPayload('TATHVA:b22cs001'), 'B22CS001');
  assert.equal(parseQrPayload('  tathva : b22cs001  '), 'B22CS001');
  assert.ok(isValidRollNo(parseQrPayload('TATHVA:B220123CS')));
});

test('junk QR payloads are rejected before touching the database', () => {
  for (const junk of ['https://example.com/evil', "'; DROP TABLE students;--", '', '   ', '!!']) {
    assert.equal(isValidRollNo(parseQrPayload(junk)), false, `should reject: ${junk}`);
  }
});
