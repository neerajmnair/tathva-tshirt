'use strict';

/** Minimal RFC4180-ish CSV parser: handles quotes, embedded commas/newlines, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip UTF-8 BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully empty lines.
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function toCsv(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

const headerKey = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

const ROLL_HEADERS = ['rollno', 'rollnumber', 'roll', 'rollnum', 'admissionno', 'admno', 'regno', 'registrationnumber', 'studentid'];
const NAME_HEADERS = ['name', 'studentname', 'fullname'];
const SIZE_HEADERS = ['tshirtsize', 'size', 'shirtsize', 'tsize', 'tshirt'];

/** Normalize a roll number: trim, collapse whitespace, uppercase. */
function normalizeRollNo(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim().replace(/\s+/g, '').toUpperCase();
}

const ROLL_RE = /^[A-Z0-9][A-Z0-9._\-/]{1,31}$/;
function isValidRollNo(roll) {
  return ROLL_RE.test(roll);
}

const SIZE_ALIASES = {
  XS: 'XS', EXTRASMALL: 'XS',
  S: 'S', SMALL: 'S',
  M: 'M', MEDIUM: 'M', MED: 'M',
  L: 'L', LARGE: 'L',
  XL: 'XL', EXTRALARGE: 'XL', XLARGE: 'XL', '1XL': 'XL',
  XXL: 'XXL', '2XL': 'XXL', DOUBLEXL: 'XXL',
  XXXL: 'XXXL', '3XL': 'XXXL', TRIPLEXL: 'XXXL',
};

/** Normalize a size label; unknown labels are kept (uppercased) rather than rejected. */
function normalizeSize(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim().toUpperCase();
  if (!s) return '';
  const key = s.replace(/[^A-Z0-9]/g, '');
  return SIZE_ALIASES[key] || s;
}

/**
 * Parse CSV text into {rows, invalid, duplicates, headers}.
 * Never touches the database — pure function, easy to test.
 */
function parseStudentCsv(text) {
  const table = parseCsv(String(text || ''));
  if (table.length === 0) {
    return { error: 'CSV is empty' };
  }
  const header = table[0].map(headerKey);
  const rollIdx = header.findIndex((h) => ROLL_HEADERS.includes(h));
  const sizeIdx = header.findIndex((h) => SIZE_HEADERS.includes(h));
  const nameIdx = header.findIndex((h) => NAME_HEADERS.includes(h));

  const missing = [];
  if (rollIdx === -1) missing.push('RollNo');
  if (sizeIdx === -1) missing.push('TshirtSize');
  if (missing.length) {
    return {
      error: `Missing required column(s): ${missing.join(', ')}. Found headers: ${table[0].join(', ')}`,
    };
  }

  const rows = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Map();

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const raw = table[r];
    const rollNo = normalizeRollNo(raw[rollIdx]);
    const tshirtSize = normalizeSize(raw[sizeIdx]);
    const name = nameIdx === -1 ? null : String(raw[nameIdx] ?? '').trim() || null;

    if (!rollNo) { invalid.push({ line, rollNo: raw[rollIdx] ?? '', reason: 'Missing roll number' }); continue; }
    if (!isValidRollNo(rollNo)) { invalid.push({ line, rollNo, reason: 'Invalid roll number format' }); continue; }
    if (!tshirtSize) { invalid.push({ line, rollNo, reason: 'Missing t-shirt size' }); continue; }

    if (seen.has(rollNo)) {
      duplicates.push({ line, rollNo, firstSeenLine: seen.get(rollNo) });
      continue;
    }
    seen.set(rollNo, line);
    rows.push({ rollNo, name, tshirtSize });
  }

  return { rows, invalid, duplicates, totalRows: table.length - 1 };
}

module.exports = {
  parseCsv, toCsv, parseStudentCsv, normalizeRollNo, isValidRollNo, normalizeSize,
};
