# Tathva T-Shirt Distribution System --- Implementation Plan

## 1. Goal

Build a simple, reliable, LAN-only t-shirt distribution system for an
event.

The setup:

-   One laptop acts as the local server and database host.
-   The laptop creates a Wi-Fi hotspot.
-   Multiple phones connect to that hotspot.
-   Staff use phones to scan student QR codes.
-   The server looks up the student's t-shirt size and collection
    status.
-   Staff hand over the shirt and mark the student as collected.
-   The laptop has a simple dashboard showing totals, search, and live
    collection status.
-   No VM, Vercel, or paid cloud backend is required for the
    distribution system.

The system must be simple enough to build, test, and deploy in one day.

------------------------------------------------------------------------

## 2. Recommended Architecture

### Local Distribution System

Use:

-   **Backend:** Node.js + Express
-   **Database:** PostgreSQL
-   **Database access:** Prisma or better-suited lightweight PostgreSQL
    layer
-   **Laptop dashboard:** React + Vite, or plain HTML/JS if faster
-   **Phone workflow:** Mobile-friendly web app/PWA
-   **QR scanning:** Browser camera QR scanner library if it works
    reliably on the target phones; otherwise use a very small
    native/Expo scanner app.
-   **Transport:** HTTP over the laptop's LAN IP
-   **Deployment:** Run entirely on the laptop

Example:

``` text
                 Laptop Hotspot
                       |
        +--------------+--------------+
        |              |              |
      Phone 1        Phone 2        Phone 3
        |              |              |
        +--------------+--------------+
                       |
                Local HTTP API
                       |
                Node/Express
                       |
                   PostgreSQL DB
                       |
              Laptop Dashboard
```

The laptop should bind the server to `0.0.0.0`, not only `localhost`, so
phones on the hotspot can connect.

------------------------------------------------------------------------


## PostgreSQL Setup

Run PostgreSQL locally on the event laptop.

Suggested database:

```text
tathva_tshirt
```

Example environment configuration:

```env
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/tathva_tshirt
PORT=3000
HOST=0.0.0.0
```

Do not hard-code credentials.

The PostgreSQL server should preferably remain accessible only from the laptop. Phones connect to the Express API, never directly to PostgreSQL.

If using Prisma, use PostgreSQL as the datasource and use migrations.

If using `pg`, provide a small schema/migration script.

For event-day backup, document:

```bash
pg_dump "$DATABASE_URL" > tathva_tshirt_backup.sql
```

For restore, document the corresponding `psql` command.

---

## 3. Core Data Model

Minimum student record:

``` text
Student
-------
id
rollNo              UNIQUE
name                optional
tshirtSize
collected            BOOLEAN
collectedAt          nullable
collectedBy          nullable
```

If the source spreadsheet contains additional useful fields, preserve
them only if needed.

Possible sizes:

``` text
XS
S
M
L
XL
XXL
XXXL
```

Do not hard-code the allowed sizes unless the input data requires it.

------------------------------------------------------------------------

## 4. Spreadsheet Import

The laptop dashboard should support importing the initial student
database from CSV.

Expected minimum CSV:

``` csv
RollNo,Name,TshirtSize
B22CS001,Student Name,M
B22CS002,Student Name,L
B22CS003,Student Name,XL
```

Import requirements:

-   Validate required columns.
-   Normalize roll numbers.
-   Reject duplicate roll numbers or clearly report them.
-   Show import summary:
    -   total rows
    -   successfully imported
    -   duplicates
    -   invalid rows
-   Do not silently overwrite existing collection status during a
    re-import.
-   Provide a backup/export function.

If the actual spreadsheet uses different column names, make the importer
configurable or document the expected mapping.

------------------------------------------------------------------------

## 5. Phone Distribution Workflow

The staff workflow should be extremely fast.

### Workflow

1.  Staff opens the local web app on their phone.
2.  Tap `Scan QR`.
3.  Camera opens.
4.  Scan student's QR.
5.  QR resolves to a roll number.
6.  Phone requests student data from the laptop server.
7.  Display prominently:
    -   Roll number
    -   Name if available
    -   T-shirt size
    -   Current collection status
8.  If not collected:
    -   show a large `MARK AS GIVEN` button.
9.  Staff hands over shirt.
10. Staff taps `MARK AS GIVEN`.
11. Server atomically marks the record as collected.
12. Show success confirmation.
13. Immediately return to scanning mode / provide a prominent
    `SCAN NEXT` button.

The number of taps between scans should be minimized.

------------------------------------------------------------------------

## 6. Duplicate / Already Collected Handling

This is critical.

If two phones scan the same student:

-   Both may initially see the student.
-   Only the first successful `MARK AS GIVEN` operation should change
    the database.
-   The second operation must receive a response such as:

``` text
ALREADY COLLECTED
Collected at: 14:32
```

Do not allow two phones to successfully mark the same shirt as given.

Use a PostgreSQL transaction or, preferably for this operation, an atomic conditional update such as:

``` sql
UPDATE students
SET collected = 1,
    collected_at = CURRENT_TIMESTAMP,
    collected_by = ?
WHERE roll_no = ?
  AND collected = 0;
```

Then check the affected row count.

------------------------------------------------------------------------

## 7. API

Keep the API small.

Suggested endpoints:

``` text
GET  /api/health

GET  /api/students/:rollNo

POST /api/students/:rollNo/collect

GET  /api/stats

GET  /api/students?search=

POST /api/import

GET  /api/export
```

The collection endpoint should return clear machine-readable statuses.

Example:

``` json
{
  "success": true,
  "status": "COLLECTED",
  "student": {
    "rollNo": "B22CS001",
    "name": "Student Name",
    "tshirtSize": "M"
  }
}
```

Already collected:

``` json
{
  "success": false,
  "status": "ALREADY_COLLECTED",
  "student": {
    "rollNo": "B22CS001",
    "name": "Student Name",
    "tshirtSize": "M",
    "collectedAt": "2026-09-28T14:32:00Z"
  }
}
```

Not found:

``` json
{
  "success": false,
  "status": "NOT_FOUND"
}
```

------------------------------------------------------------------------

## 8. Laptop Dashboard

Do not spend time on visual design.

The dashboard needs:

### Summary

``` text
Total Students: 2500
Collected:      1375
Remaining:      1125
Progress:       55%
```

### Size breakdown

``` text
S     120 / 200
M     350 / 600
L     500 / 800
XL    300 / 500
XXL   105 / 250
```

### Search

Search by:

-   roll number
-   name

Display:

-   size
-   collected/not collected
-   collection timestamp
-   collector/device identifier if implemented

### Recent collections

Show the latest collected students.

### Import/export

Buttons:

``` text
Import CSV
Export CSV
Backup Database
```

### Reset

Do NOT provide a one-click destructive reset without confirmation.

------------------------------------------------------------------------

## 9. LAN Configuration

The server should:

-   Listen on `0.0.0.0`.
-   Use a configurable port, e.g. `3000`.
-   Print the LAN URL on startup.

Example:

``` text
Tathva T-Shirt Distribution Server

Server running:
  Local: http://localhost:3000
  LAN:   http://192.168.43.1:3000

Connect phones to the laptop hotspot and open:
http://192.168.43.1:3000
```

Do not assume the hotspot gateway IP.

Detect the laptop's active LAN IP where practical, or allow:

``` bash
HOST=0.0.0.0
PORT=3000
```

and print useful instructions.

------------------------------------------------------------------------

## 10. Network Reliability

The distribution system is LAN-based.

Still implement:

-   API request timeout handling.
-   Clear `SERVER UNREACHABLE` error.
-   Retry button.
-   No optimistic collection marking.
-   Server remains the source of truth.
-   Phones should never claim a collection succeeded unless the server
    confirmed it.

If practical, add a lightweight health indicator:

``` text
● Connected
```

or:

``` text
● Server offline
```

Do not build a complicated offline synchronization system unless testing
reveals that it is actually necessary.

------------------------------------------------------------------------

## 11. Staff Identification

The distribution system can initially use a simple device/staff
identifier.

For example:

``` text
Phone A
Phone B
Phone C
```

or allow staff to enter a name when opening the app.

This value can be stored in `collectedBy`.

Do not build full staff authentication unless required.

------------------------------------------------------------------------

# Separate QR Workflow

## 12. Student QR Generator

Keep the student QR workflow isolated from the local distribution
server.

Purpose:

-   Student authenticates with Google.
-   System determines the student's RollNo from their authenticated
    account/profile.
-   Student sees their RollNo.
-   Student sees a QR code containing only the required identifier,
    preferably the RollNo.
-   The distribution phones scan this QR.

Example:

``` text
Student Portal

Logged in as:
student@nitc.ac.in

Roll No:
B22CS001

[ QR CODE ]
```

The QR payload should be simple:

``` text
B22CS001
```

or a versioned format if desired:

``` text
TATHVA:B22CS001
```

Do not put t-shirt size or collection status in the QR.

The server must always look up the latest information.

------------------------------------------------------------------------

## 13. Isolation of QR Workflow

The QR student portal should be a separate application/service from the
LAN distribution server.

Important:

-   It must not depend on the event laptop being online.
-   It must not share the PostgreSQL database.
-   It must not deploy through the event laptop.
-   It should have its own minimal authentication/data layer.
-   Keep it independent from VM/Vercel infrastructure used by other
    projects.

Because Google authentication requires internet access, the
QR-generation portal itself may be hosted separately. The event
distribution system remains fully local.

Possible implementation:

``` text
QR Portal
---------
React / Next.js / simple web app
Google OAuth
Minimal student -> RollNo mapping
QR generation

             completely separate

Distribution System
-------------------
Laptop
Node/Express
PostgreSQL
LAN
Phones
```

If an existing student identity system already provides the RollNo
through Google login, reuse it instead of building a second student
database.

Do not add unnecessary infrastructure.

------------------------------------------------------------------------

## 14. Security Boundaries

The LAN server is intended for the event environment.

Still:

-   Validate roll numbers.
-   Validate all API inputs.
-   Use parameterized database queries/ORM.
-   Do not allow arbitrary SQL.
-   Do not expose the PostgreSQL database directly.
-   Do not put secrets in frontend code.
-   Do not put Google OAuth secrets in the LAN application.
-   Restrict CORS appropriately for the local app.
-   Do not log sensitive credentials.

The QR only needs to contain a non-secret RollNo.

------------------------------------------------------------------------

## 15. Project Structure

Suggested structure:

``` text
tathva-tshirt/
│
├── server/
│   ├── src/
│   ├── prisma/              # if Prisma is used
│   ├── data/
│   └── package.json
│
├── dashboard/
│   ├── src/
│   └── package.json
│
├── mobile/
│   ├── src/
│   └── package.json
│
├── qr-portal/
│   ├── src/
│   └── package.json
│
├── scripts/
│
├── sample-data/
│   └── students.csv
│
├── README.md
└── PLAN.md
```

If a web/PWA phone client is sufficiently reliable, prefer it over
building a native app to save time.

------------------------------------------------------------------------

# 16. One-Day Development Plan

## Phase 1 --- 1 hour

Set up:

-   repository
-   Node project
-   Express server
-   PostgreSQL
-   basic schema
-   health endpoint

Verify server works over LAN.

## Phase 2 --- 1.5 hours

Implement:

-   CSV import
-   student lookup
-   collection endpoint
-   atomic duplicate protection
-   statistics endpoint

Test with curl/Postman.

## Phase 3 --- 1.5 hours

Build phone workflow:

-   scan QR
-   lookup
-   display size
-   mark given
-   already-collected handling
-   scan next

Prioritize speed over UI.

## Phase 4 --- 1.5 hours

Build laptop dashboard:

-   totals
-   size breakdown
-   search
-   recent collections
-   import/export

## Phase 5 --- 1 hour

LAN testing:

-   laptop hotspot
-   connect multiple phones
-   test simultaneous scans
-   test duplicate scans
-   test server restart
-   test invalid QR
-   test student not found

## Phase 6 --- 1 hour

Build/test separate QR portal:

-   Google login
-   RollNo mapping
-   QR generation
-   test scanning from multiple phones

## Phase 7 --- 30 minutes

Deployment/documentation:

-   one-command startup
-   README
-   backup instructions
-   emergency troubleshooting
-   sample CSV
-   final end-to-end test

------------------------------------------------------------------------

# 17. Acceptance Criteria

The project is finished when:

-   [ ] Laptop can start the server with one command.
-   [ ] Server is reachable from phones connected to the laptop hotspot.
-   [ ] Student CSV imports correctly.
-   [ ] RollNo lookup takes approximately one request.
-   [ ] QR scan opens the correct student.
-   [ ] T-shirt size is immediately visible.
-   [ ] Staff can mark the shirt as given with one tap.
-   [ ] Duplicate collection is prevented atomically.
-   [ ] Multiple phones can operate simultaneously.
-   [ ] Dashboard updates after collections.
-   [ ] Dashboard shows totals and size breakdown.
-   [ ] CSV export works.
-   [ ] Invalid/nonexistent RollNo is handled cleanly.
-   [ ] Server restart does not lose data.
-   [ ] PostgreSQL database can be backed up.
-   [ ] Student QR portal is independent of the LAN server.
-   [ ] Google authentication works in the QR portal.
-   [ ] QR contains the RollNo, not shirt size/status.
-   [ ] No dependency on VM/Vercel exists for the event distribution
    system.

------------------------------------------------------------------------

# 18. Important Implementation Principle

Do not overengineer this.

This is an event operations tool, not a production SaaS application.

Optimize for:

1.  Speed of scanning.
2.  Correct t-shirt size.
3.  Preventing duplicate collection.
4.  Multiple phones working simultaneously.
5.  Easy recovery if something goes wrong.
6.  Simple setup by event staff.

Avoid spending time on:

-   fancy UI
-   animations
-   complex authentication for staff
-   microservices
-   Kubernetes
-   cloud infrastructure
-   complicated offline sync
-   unnecessary abstractions

Build the smallest reliable system that satisfies the workflow.
