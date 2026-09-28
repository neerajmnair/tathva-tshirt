#!/usr/bin/env node
// Generates sample-data/students.csv for testing.
const fs = require('fs');
const path = require('path');

const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const weights = [1, 4, 9, 8, 5, 2];
const depts = ['CS', 'EC', 'ME', 'CE', 'EE', 'CH', 'PE', 'AR'];
const first = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Ishan', 'Meera', 'Kabir', 'Sara', 'Arjun', 'Nila', 'Vivek', 'Riya'];
const last = ['Nair', 'Menon', 'Sharma', 'Patel', 'Iyer', 'Das', 'Reddy', 'Khan', 'Pillai', 'Bose'];

function pickSize(i) {
  const total = weights.reduce((a, b) => a + b, 0);
  let n = (i * 37) % total;
  for (let k = 0; k < sizes.length; k++) { n -= weights[k]; if (n < 0) return sizes[k]; }
  return 'M';
}

const N = parseInt(process.argv[2], 10) || 500;
const rows = ['RollNo,Name,TshirtSize'];
for (let i = 1; i <= N; i++) {
  const dept = depts[i % depts.length];
  const roll = `B22${dept}${String(i).padStart(3, '0')}`;
  const name = `${first[i % first.length]} ${last[(i * 3) % last.length]}`;
  rows.push(`${roll},${name},${pickSize(i)}`);
}
const out = path.join(__dirname, '..', 'sample-data', 'students.csv');
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log(`Wrote ${N} students to ${out}`);
