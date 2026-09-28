#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createApp } = require('./app');
const { pool } = require('./db');
const { migrate } = require('./migrate');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || PORT + 443;
const HOST = process.env.HOST || '0.0.0.0';
const CERT_DIR = path.join(__dirname, '..', '..', 'certs');

/** All non-internal IPv4 addresses, hotspot-ish ones first. */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  // macOS internet sharing creates bridge100/bridge101; normal Wi-Fi is en0/wlan0.
  // A .0 host address belongs to an idle sharing bridge, so push those to the back.
  const score = (i) =>
    (/\.0$/.test(i.address) ? 10 : 0) +
    (/^bridge/.test(i.name) ? 0 : /^en|^wl/.test(i.name) ? 1 : 2) +
    (/^192\.168\./.test(i.address) ? 0 : /^10\./.test(i.address) ? 0.1 : 0.2);
  return out.sort((a, b) => score(a) - score(b));
}

function ensureCert(ips) {
  const key = path.join(CERT_DIR, 'server.key');
  const crt = path.join(CERT_DIR, 'server.crt');
  const sansFile = path.join(CERT_DIR, '.sans');
  const wanted = ['localhost', '127.0.0.1', ...ips].join(',');
  try {
    if (fs.existsSync(key) && fs.existsSync(crt) &&
        fs.existsSync(sansFile) && fs.readFileSync(sansFile, 'utf8') === wanted) {
      return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
    }
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((i) => `IP:${i}`)].join(',');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', key, '-out', crt,
      '-subj', '/CN=Tathva T-Shirt Distribution',
      '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' });
    fs.writeFileSync(sansFile, wanted);
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  } catch (e) {
    return null;
  }
}

async function main() {
  try {
    await migrate();
  } catch (e) {
    console.error('\n  Could not connect to PostgreSQL:', e.message);
    console.error('  Check DATABASE_URL in .env, then run:  npm run setup\n');
    process.exit(1);
  }

  const app = createApp();
  const ips = lanAddresses();
  const primary = ips[0] ? ips[0].address : null;

  const httpServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(PORT, HOST, resolve);
  });

  // Phone cameras require a secure context, so we also serve HTTPS with a
  // self-signed certificate. Staff accept the browser warning once per phone.
  let httpsUp = false;
  const creds = ensureCert(ips.map((i) => i.address));
  if (creds) {
    try {
      const httpsServer = https.createServer(creds, app);
      await new Promise((resolve, reject) => {
        httpsServer.on('error', reject);
        httpsServer.listen(HTTPS_PORT, HOST, resolve);
      });
      httpsUp = true;
    } catch (e) {
      console.error('[https] disabled:', e.message);
    }
  }

  const r = await pool.query('SELECT count(*)::int AS n FROM students');

  const line = '='.repeat(62);
  console.log(`\n${line}\n  TATHVA T-SHIRT DISTRIBUTION\n${line}`);
  console.log(`  Students in database: ${r.rows[0].n}`);
  console.log(`\n  DASHBOARD (this laptop)`);
  console.log(`    http://localhost:${PORT}/dashboard`);
  console.log(`\n  PHONE SCANNER (staff phones on the hotspot)`);
  if (httpsUp && primary) {
    console.log(`    https://${primary}:${HTTPS_PORT}/        <-- use this (camera needs HTTPS)`);
    console.log(`    Accept the "not private" warning once on each phone.`);
  }
  if (primary) console.log(`    http://${primary}:${PORT}/            (manual entry / fallback)`);
  if (ips.length > 1) {
    console.log(`\n  If phones cannot reach that address, try these instead:`);
    for (const i of ips.slice(1)) {
      console.log(`    ${i.name.padEnd(10)} http://${i.address}:${PORT}${httpsUp ? `  |  https://${i.address}:${HTTPS_PORT}` : ''}`);
    }
  }
  if (!primary) {
    console.log(`\n  No LAN interface detected. Turn on the laptop hotspot / Wi-Fi and restart.`);
  }
  if (process.env.DEV_TOOLS === '1') {
    console.log(`\n  DEV TOOLS (DEV_TOOLS=1)`);
    console.log(`    http://localhost:${PORT}/dev/           QR generator + test scanner`);
    if (httpsUp && primary) console.log(`    https://${primary}:${HTTPS_PORT}/dev/     (phone, camera works here)`);
  }

  console.log(`\n  Press Ctrl+C to stop.\n${line}\n`);

  const shutdown = () => {
    console.log('\nShutting down...');
    httpServer.close();
    pool.end().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();
module.exports = { lanAddresses };
