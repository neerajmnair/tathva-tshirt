-- Tathva T-Shirt Distribution schema (idempotent).
CREATE TABLE IF NOT EXISTS students (
  id           SERIAL PRIMARY KEY,
  roll_no      TEXT        NOT NULL UNIQUE,
  name         TEXT,
  tshirt_size  TEXT        NOT NULL,
  collected    BOOLEAN     NOT NULL DEFAULT FALSE,
  collected_at TIMESTAMPTZ,
  collected_by TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS students_name_lower_idx   ON students (lower(name));
CREATE INDEX IF NOT EXISTS students_collected_at_idx ON students (collected_at DESC);
CREATE INDEX IF NOT EXISTS students_size_idx         ON students (tshirt_size);

-- Append-only audit of every successful collection. Useful if the students
-- table ever has to be restored/re-imported mid-event.
CREATE TABLE IF NOT EXISTS collection_log (
  id           SERIAL PRIMARY KEY,
  roll_no      TEXT        NOT NULL,
  tshirt_size  TEXT,
  collected_by TEXT,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_log_at_idx ON collection_log (collected_at DESC);
