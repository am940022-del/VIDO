'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(dataDir, 'attendance.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  admin_name    TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  teacher_token TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id        INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade     TEXT NOT NULL,
  section   TEXT NOT NULL,
  UNIQUE (school_id, grade, section)
);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY,
  school_id      INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  section_id     INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  student_no     TEXT,
  guardian_phone TEXT
);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);

CREATE TABLE IF NOT EXISTS teachers (
  id        INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  subject   TEXT,
  phone     TEXT
);
CREATE INDEX IF NOT EXISTS idx_teachers_school ON teachers(school_id);

CREATE TABLE IF NOT EXISTS periods (
  id         INTEGER PRIMARY KEY,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  number     INTEGER NOT NULL,
  start_time TEXT,
  end_time   TEXT,
  UNIQUE (school_id, number)
);

CREATE TABLE IF NOT EXISTS records (
  id            INTEGER PRIMARY KEY,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  section_id    INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  period_number INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('absent','late','escape')),
  teacher_id    INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  teacher_name  TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (school_id, student_id, date, period_number)
);
CREATE INDEX IF NOT EXISTS idx_records_school_date ON records(school_id, date);
CREATE INDEX IF NOT EXISTS idx_records_student ON records(student_id);
`);

module.exports = db;
