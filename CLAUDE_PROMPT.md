# Claude Code Prompt --- Tathva T-Shirt Distribution System

You are implementing a small event operations system called **Tathva
T-Shirt Distribution**.

Read `PLAN.md` completely before writing code. Treat it as the
implementation specification.

## Goal

Build this in **one day maximum**. Prioritize reliability and speed over
UI quality.

The real-world setup is:

-   One laptop runs the local server and PostgreSQL database.
-   The laptop creates a Wi-Fi hotspot.
-   Several Android/iOS phones connect to that hotspot.
-   Staff use phones to scan students' Tathva QR codes.
-   The server looks up the student's RollNo.
-   The server returns their t-shirt size and collection status.
-   Staff give the shirt and tap `MARK AS GIVEN`.
-   The server atomically records the collection.
-   Multiple phones must be able to operate simultaneously.
-   The laptop has a dashboard showing collection progress.
-   There is no need for cloud deployment for the distribution system.
-   Do not use Vercel, a VM, or other paid infrastructure for the LAN
    system.

There will also be a **separate student QR workflow** where a student
authenticates with Google and sees a QR containing their RollNo. Keep
this isolated from the local distribution system.

## First step

Before coding:

1.  Inspect the repository.
2.  Read `PLAN.md`.
3.  Determine whether any existing code/data can be reused.
4.  Do not replace useful existing work unnecessarily.
5.  Create a concise implementation checklist.
6.  Then implement the MVP end-to-end.

Do not spend time explaining architecture to me unless there is a
blocking ambiguity. Make sensible engineering decisions yourself.

------------------------------------------------------------------------

# Required system

## A. Local distribution backend

Use:

-   Node.js
-   Express
-   PostgreSQL
-   A lightweight ORM/query layer if useful

The server must listen on:

``` text
0.0.0.0
```

so phones connected to the laptop hotspot can access it.

Use a configurable port, defaulting to something simple such as:

``` text
3000
```

On startup print:

``` text
Tathva T-Shirt Distribution

Local: http://localhost:3000
LAN:   http://<LAN-IP>:3000
```

Make the LAN IP reasonably easy to determine.

------------------------------------------------------------------------

# B. Database

Create a PostgreSQL Student table with at least:

``` text
id
rollNo UNIQUE
name
tshirtSize
collected
collectedAt
collectedBy
```

Use sensible PostgreSQL types.

Collection must be persistent across server restarts. PostgreSQL is the persistent source of truth.

Do NOT store collection state only in memory.

------------------------------------------------------------------------

# C. CSV import

Support importing the initial spreadsheet as CSV.

Minimum expected columns:

``` csv
RollNo,Name,TshirtSize
B22CS001,Student Name,M
B22CS002,Student Name,L
```

Requirements:

-   validate required columns
-   normalize RollNo
-   detect duplicates
-   report invalid rows
-   do not silently destroy existing collection status on re-import
-   show an import summary
-   allow exporting the current database back to CSV

If the repository already contains sample data or a known spreadsheet
format, inspect it and adapt the importer.

------------------------------------------------------------------------


## PostgreSQL local setup

Assume PostgreSQL is installed locally on the event laptop.

Use environment variables such as:

```env
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/tathva_tshirt
PORT=3000
HOST=0.0.0.0
```

Do not hard-code credentials.

Provide a simple setup command/instructions to create:

```text
Database: tathva_tshirt
```

If using Prisma, configure the PostgreSQL datasource and migrations.

If using `pg`, create a small database initialization/migration script.

PostgreSQL should listen on localhost for the database connection if possible. Phones should NEVER connect directly to PostgreSQL; they connect only to the Express API over the laptop hotspot.

For event-day backup, document a simple PostgreSQL backup command using `pg_dump`.

---

# D. API

Implement approximately:

``` text
GET  /api/health
GET  /api/students/:rollNo
POST /api/students/:rollNo/collect
GET  /api/stats
GET  /api/students?search=
POST /api/import
GET  /api/export
```

Keep the API simple.

The collection endpoint is the most important endpoint.

It MUST prevent double collection even if two phones send the request
simultaneously.

Use an atomic conditional database update or transaction:

``` sql
UPDATE students
SET collected = 1,
    collected_at = CURRENT_TIMESTAMP,
    collected_by = ?
WHERE roll_no = ?
  AND collected = 0;
```

Then inspect the affected row count.

Possible states:

``` text
COLLECTED
ALREADY_COLLECTED
NOT_FOUND
```

Never return success for a second collection.

------------------------------------------------------------------------

# E. Phone scanning workflow

This is the most important UI.

The workflow should be:

``` text
OPEN
  ↓
SCAN QR
  ↓
FETCH STUDENT
  ↓
SHOW:
  RollNo
  Name
  T-shirt Size
  Collection status
  ↓
MARK AS GIVEN
  ↓
SUCCESS
  ↓
SCAN NEXT
```

Optimize for a staff member processing hundreds/thousands of students.

Avoid unnecessary navigation.

After a successful collection, make `SCAN NEXT` extremely obvious.

If already collected, show:

``` text
ALREADY COLLECTED
```

with the collection time if available.

If not found:

``` text
STUDENT NOT FOUND
```

Do not accidentally mark anything as collected when the server request
failed.

------------------------------------------------------------------------

# F. QR scanning

Prefer the simplest reliable implementation.

First determine whether a mobile browser/PWA camera scanner is reliable
enough for the target environment.

If yes, use it.

If browser camera constraints make that unreliable, use a small
Expo/React Native scanner app instead.

Do not build a complicated native app if a web scanner is sufficient.

The QR payload should contain only the RollNo or a simple versioned
value such as:

``` text
TATHVA:B22CS001
```

The distribution server must parse and validate it.

Do NOT put:

-   t-shirt size
-   collection status
-   database information

inside the QR.

The PostgreSQL-backed server is always the source of truth.

------------------------------------------------------------------------

# G. Laptop dashboard

Do not waste time on visual design.

Create a functional dashboard with:

``` text
Total Students
Collected
Remaining
Progress
```

Also show a size breakdown:

``` text
S
M
L
XL
XXL
...
```

with collected/total counts.

Add:

-   search by RollNo/name
-   recent collections
-   CSV import
-   CSV export
-   database backup if practical

The dashboard should update after collections without requiring a full
manual database refresh.

------------------------------------------------------------------------

# H. LAN reliability

The system is intended to operate on a local hotspot.

Implement:

-   clear server connection errors
-   request timeouts where appropriate
-   retry option
-   health indicator if simple
-   no optimistic collection state

A phone should only display `SUCCESS` after the server confirms the
database update.

Do not build complicated offline synchronization unless testing proves
it is necessary.

------------------------------------------------------------------------

# I. Multiple phones

Test at least:

``` text
Phone A → Student 1
Phone B → Student 2
Phone C → Student 3
```

and especially:

``` text
Phone A → Student 1
Phone B → Student 1
```

simultaneously.

Only one request may successfully collect Student 1.

------------------------------------------------------------------------

# J. Separate student QR portal

Build this as a separate application/module from the local distribution
server.

Requirements:

1.  Student signs in with Google.
2.  The application determines their RollNo.
3.  Show:
    -   logged-in account
    -   RollNo
    -   QR code
4.  QR encodes only the RollNo.

Example:

``` text
student@nitc.ac.in

Roll No: B22CS001

[ QR CODE ]
```

Keep this workflow isolated from the local PostgreSQL distribution database.

It must not depend on the event laptop being online.

Google OAuth requires internet access, so the QR portal can be
separately hosted. The local distribution system must remain completely
independent of it.

Do not use Vercel/VM infrastructure for the distribution server.

If an existing student identity source or project exists in the
repository, inspect it and reuse it where appropriate rather than
creating duplicate identity logic.

Do not expose OAuth secrets to the frontend.

------------------------------------------------------------------------

# K. Security

This is a LAN event tool, so keep security proportional to the project.

Still:

-   parameterize database queries
-   validate inputs
-   never execute arbitrary SQL from requests
-   never expose the PostgreSQL file through HTTP
-   never put OAuth secrets in frontend code
-   validate RollNo format
-   don't trust QR payloads blindly
-   don't mark collection based only on client-side state

Do not overengineer authentication for staff unless the existing
requirements demand it.

A simple staff/device identifier is enough for `collectedBy`.

------------------------------------------------------------------------

# L. Project structure

Prefer something close to:

``` text
tathva-tshirt/
├── server/
├── dashboard/
├── mobile/
├── qr-portal/
├── scripts/
├── sample-data/
├── README.md
└── PLAN.md
```

However, simplify this if a monorepo structure becomes unnecessary.

Do not create four separate complicated projects just for architectural
purity.

A single Node server serving the dashboard and mobile web app may be
preferable if it makes the one-day deployment easier.

------------------------------------------------------------------------

# M. Developer experience

The final project should have simple commands such as:

``` bash
npm install
npm run dev
```

and preferably:

``` bash
npm run start
```

for the event.

If there are multiple packages, make the commands obvious.

Add a root README containing:

1.  installation
2.  database setup
3.  CSV import
4.  starting the server
5.  finding the LAN URL
6.  connecting phones
7.  event-day workflow
8.  backup instructions
9.  troubleshooting

------------------------------------------------------------------------

# N. Testing

Write useful tests for the critical backend behavior.

At minimum test:

-   student lookup
-   not found
-   collection
-   duplicate collection
-   simultaneous/double collection protection
-   CSV import
-   stats

Also manually test:

-   laptop hotspot
-   at least two phones
-   QR scan
-   collection
-   server restart
-   database persistence

Do not spend excessive time chasing 100% test coverage.

------------------------------------------------------------------------

# O. Priority order

If time becomes limited, implement in this order:

1.  PostgreSQL schema
2.  CSV import
3.  student lookup API
4.  atomic collection API
5.  phone QR scanning workflow
6.  laptop dashboard
7.  export/backup
8.  separate QR portal
9.  polish

The core distribution workflow is more important than the QR portal UI.

------------------------------------------------------------------------

# P. Don't overengineer

This is an event operations tool.

Do NOT introduce:

-   microservices
-   Kubernetes
-   Redis
-   message queues
-   cloud databases
-   complicated authentication
-   elaborate state management
-   elaborate design systems
-   unnecessary abstractions
-   complex offline sync

Use boring, reliable technology.

------------------------------------------------------------------------

# Q. Final acceptance test

Before declaring the project complete, verify:

-   [ ] server starts with one simple command
-   [ ] PostgreSQL persists data
-   [ ] CSV imports
-   [ ] phones can connect over laptop hotspot
-   [ ] QR scan returns correct RollNo
-   [ ] correct shirt size is displayed
-   [ ] staff can mark given with one tap
-   [ ] duplicate collection is prevented
-   [ ] multiple phones work simultaneously
-   [ ] dashboard reflects collections
-   [ ] size statistics work
-   [ ] CSV export works
-   [ ] invalid QR is handled
-   [ ] unknown RollNo is handled
-   [ ] server restart preserves state
-   [ ] backup works
-   [ ] separate Google-auth QR portal works
-   [ ] QR portal does not depend on the LAN server
-   [ ] distribution system does not depend on Vercel/VM/cloud services

When done, provide:

1.  What you built.
2.  Exact commands to run it.
3.  LAN setup instructions.
4.  Test results.
5.  Any remaining limitations.
6.  A short event-day operator guide.

Do not stop after scaffolding. Implement and test the actual working
MVP.
