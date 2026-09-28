# Tathva T-Shirt Distribution

LAN-only t-shirt distribution for the event. One laptop runs the server and
PostgreSQL, phones on the laptop's hotspot scan student QR codes, staff hand
over the shirt and tap **MARK AS GIVEN**. No cloud, no VM, no Vercel.

```
   Phones (scanner web app)          Laptop
   ┌───────────────┐                 ┌──────────────────────────┐
   │ scan QR       │  HTTP/HTTPS     │ Node + Express  :3000    │
   │ show size     │ ──────────────▶ │ PostgreSQL (localhost)   │
   │ MARK AS GIVEN │   over hotspot  │ Dashboard /dashboard     │
   └───────────────┘                 └──────────────────────────┘
```

The student QR portal (Google sign-in) is a **separate static app** in
`qr-portal/`. It shares no database with the laptop and the laptop never needs
it to be online.

---

## 1. Install

```bash
npm install
```

Requires Node 18+ and PostgreSQL 14+ installed locally.

```bash
# macOS (Homebrew)
brew install postgresql@16 && brew services start postgresql@16
# Ubuntu
sudo apt install postgresql && sudo systemctl start postgresql
```

## 2. Database setup

```bash
npm run setup
```

This creates `.env` (from `.env.example`), creates the `tathva_tshirt` and
`tathva_tshirt_test` databases, and applies the schema. Edit `.env` if your
PostgreSQL needs a user/password:

```env
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/tathva_tshirt
PORT=3000
HTTPS_PORT=3443
HOST=0.0.0.0
```

PostgreSQL stays bound to localhost — phones only ever talk to the Express API.

## 3. Import the student list

Either from the dashboard (**Import CSV** button) or the command line:

```bash
npm run import -- sample-data/students.csv
```

Expected columns (header names are matched loosely — `Roll No`, `RollNumber`,
`Size`, `T-Shirt Size` etc. all work):

```csv
RollNo,Name,TshirtSize
B22CS001,Student Name,M
B22CS002,Student Name,L
```

The importer normalizes roll numbers (uppercase, no spaces) and sizes
(`large` → `L`, `2XL` → `XXL`), reports duplicates and invalid rows, and
**never clears collection status on re-import** — re-importing a corrected
sheet mid-event is safe.

## 4. Start the server

```bash
npm start
```

It prints exactly what to open:

```
  DASHBOARD (this laptop)
    http://localhost:3000/dashboard

  PHONE SCANNER (staff phones on the hotspot)
    https://192.168.2.1:3443/        <-- use this (camera needs HTTPS)
    http://192.168.2.1:3000/            (manual entry / fallback)
```

## 5. Connect the phones

1. Turn on the laptop's hotspot (macOS: Settings → General → Sharing → Internet
   Sharing; Windows: Settings → Network → Mobile hotspot).
2. Connect each phone to that hotspot.
3. Open the **https://** address on the phone.
4. Safari/Chrome will warn about the certificate — tap *Advanced → Proceed*.
   (Phone cameras only work on a secure origin, hence the self-signed
   certificate the server generates on first start.)
5. Type a phone/staff name (`Phone A`) — it is stored with every collection.
6. Tap **START SCANNING**. Add to home screen for a full-screen app.

If the camera still refuses, the app falls back to typing roll numbers, which
works over plain `http://`.

---

## Event-day workflow

1. Student shows their QR (from the portal) → point the phone at it.
2. The size fills the screen: `L`.
3. Hand over that shirt.
4. Tap **MARK AS GIVEN** → green `GIVEN - L`.
5. Tap **SCAN NEXT**.

Anything unusual is loud and obvious:

| Screen | Meaning | What staff does |
|---|---|---|
| `ALREADY COLLECTED` (orange) + time + which phone | Someone already took this shirt | Do not give another shirt |
| `STUDENT NOT FOUND` (red) | Roll number is not in the list | Send to the help desk |
| `INVALID QR CODE` (red) | Not a Tathva QR | Scan again / type the roll number |
| `SERVER UNREACHABLE` (red) | Phone lost the hotspot | Nothing was marked. Reconnect, tap retry |

A phone **never** shows success unless the server confirmed the database write.
If two phones scan the same student at the same moment, exactly one gets
`COLLECTED` and the other gets `ALREADY COLLECTED` — enforced by a single
conditional `UPDATE ... WHERE collected = FALSE` in PostgreSQL.

## Dashboard

`http://localhost:3000/dashboard` — refreshes every 3 seconds.

* Total / collected / remaining / progress
* Size breakdown with collected-vs-total per size
* Recent collections and per-staff totals
* Search by roll number or name, filter by collected/pending
* Import CSV, Export CSV, backup instructions

## Backup

```bash
npm run backup     # writes backups/tathva_tshirt_<timestamp>.sql + .csv
```

Run it before the event, at the halfway point, and at the end. Restore with:

```bash
bash scripts/restore.sh backups/tathva_tshirt_<timestamp>.sql
```

The dashboard's **Export CSV** button downloads the current state instantly and
is the fastest safety net if something looks wrong.

## Student QR portal (separate app)

`qr-portal/` is a static page: Google sign-in → roll number → QR code
containing **only** the roll number. It has no database and no connection to
the event laptop.

```bash
# local preview
npm run qr-portal        # http://localhost:4000
```

To use it for real, edit `qr-portal/config.js`:

* `googleClientId` — an OAuth **Client ID** from Google Cloud Console
  (Web application). A client ID is public; never put a client *secret* here.
* `allowedEmailDomain` — e.g. `nitc.ac.in`.
* `rollNoPatterns` — how to extract the roll number from the signed-in email
  (default handles `name_b220123cs@nitc.ac.in`).
* `rollno-map.json` — optional exact `email → roll number` overrides.

Host the folder on any static host (GitHub Pages, college server). Google
sign-in needs HTTPS and internet — that is why it is deliberately separate from
the LAN system.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | liveness + student count |
| GET | `/api/students/:rollNo` | accepts `B22CS001` or `TATHVA:B22CS001` |
| POST | `/api/students/:rollNo/collect` | body `{"collectedBy":"Phone A"}` |
| GET | `/api/stats` | totals, size breakdown, recent, per-staff |
| GET | `/api/students?search=&status=&limit=` | search |
| POST | `/api/import` | JSON `{"csv":"..."}` or raw `text/csv` |
| GET | `/api/export` | CSV download |
| GET | `/api/network` | LAN addresses for the dashboard banner |

Statuses: `COLLECTED` (200), `ALREADY_COLLECTED` (409), `NOT_FOUND` (404),
`INVALID_ROLL_NO` (400).

## Tests

```bash
npm test
```

22 tests against a throwaway `tathva_tshirt_test` database: lookup, not found,
invalid QR, collection, duplicate collection, 10 simultaneous collects on one
student, concurrent collects on different students, CSV import/duplicates/
invalid rows, re-import safety, stats, search, export, restart persistence, and
a QR generate→decode round trip.

## Dev tools (development only)

A QR generator and a test scanner, for trying the flow without printing real
passes. They are **not** mounted unless `DEV_TOOLS=1`, so `npm start` on the
event laptop never exposes them.

```bash
npm run dev:tools          # DEV_TOOLS=1 + node --watch
```

| Page | What it does |
|---|---|
| `/dev/qr-gen.html` | Type a roll number, get a QR whose payload is exactly that text. Decodes the QR it just drew and shows the result, so you can see there is no prefix or wrapper. Optional read-only "check in database". |
| `/dev/scan.html` | Scans a QR and calls the real API, with a log of every request and response (method, URL, status, timing, body). Manual entry and an API base override for pointing a phone at another host. |

Open `/dev/` on the laptop for the generator; open the `https://` address on a
phone for the scanner, since the camera needs a secure context.

Collections made from the test scanner are real writes to `students`. Set
`collectedBy` in the scanner's Settings so they stand out, and re-import the
CSV (or restore a backup) before the event.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Could not connect to PostgreSQL` on start | `brew services start postgresql@16`, then `npm run setup` |
| Phone cannot open the address | Phone must be on the laptop hotspot, not campus Wi-Fi. Try the other addresses the server printed. Disable the laptop firewall for Node. |
| Camera does not open | Use the `https://` address and accept the warning. Otherwise use manual roll-number entry. |
| Certificate warning will not clear, or the laptop changed networks | `rm -rf certs/` and restart. The server regenerates a cert covering the current LAN addresses on the next boot; phones accept it once more. |
| "Server offline" on a phone | Hotspot dropped. Nothing was lost — reconnect and rescan. |
| Wrong size on a student | Fix the CSV and re-import; collection status is preserved. |
| Laptop must reboot | `npm start` again — all data is in PostgreSQL. |
| Everything is on fire | `npm run backup`, keep handing out shirts on paper, re-import later. |

## Project layout

```
server/src/     Express app, routes, CSV parsing, schema, migration
server/test/    node:test suites
public/         phone scanner (index.html) + dashboard (dashboard.html)
dev/            development-only QR generator + test scanner (DEV_TOOLS=1)
qr-portal/      separate Google-auth QR page (static)
scripts/        db setup, backup, restore, CSV import, sample data
sample-data/    students.csv
```
