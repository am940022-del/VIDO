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

/* ترقيات المخطط للقواعد الموجودة */
const schoolCols = db.prepare('PRAGMA table_info(schools)').all().map((c) => c.name);
if (!schoolCols.includes('country_code')) db.exec("ALTER TABLE schools ADD COLUMN country_code TEXT NOT NULL DEFAULT '966'");
db.exec('CREATE INDEX IF NOT EXISTS idx_records_student_date ON records(student_id, date)');

// حالة الطالب: active نشط، withdrawn منقطع، transferred منتقل من المدرسة
const studentCols = db.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
if (!studentCols.includes('status')) {
  db.exec(`ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
           ALTER TABLE students ADD COLUMN status_date TEXT;
           ALTER TABLE students ADD COLUMN status_note TEXT;`);
}
db.exec(`
CREATE INDEX IF NOT EXISTS idx_students_status ON students(school_id, status);
-- سجل تغييرات الطالب: نقل بين الشعب، انقطاع، انتقال، إعادة تفعيل
CREATE TABLE IF NOT EXISTS student_events (
  id         INTEGER PRIMARY KEY,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  from_text  TEXT,
  to_text    TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_student ON student_events(student_id);
`);

/* ---- النموذج التجاري: مالك المنصة يتحكم في وصول المدارس ---- */
const cols = () => db.prepare('PRAGMA table_info(schools)').all().map((c) => c.name);
if (!cols().includes('status')) {
  // المدارس الموجودة قبل هذه الميزة تبقى مفعّلة حتى لا يُقطع عنها الوصول
  db.exec(`ALTER TABLE schools ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
           ALTER TABLE schools ADD COLUMN plan TEXT;
           ALTER TABLE schools ADD COLUMN subscription_end TEXT;
           ALTER TABLE schools ADD COLUMN contact_phone TEXT;
           ALTER TABLE schools ADD COLUMN owner_notes TEXT;
           ALTER TABLE schools ADD COLUMN approved_at TEXT;
           ALTER TABLE schools ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS platform_admins (
  id                   INTEGER PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS owner_sessions (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`);

/* التحقق بخطوتين لمالك المنصة */
const adminCols = db.prepare('PRAGMA table_info(platform_admins)').all().map((c) => c.name);
if (!adminCols.includes('totp_secret')) {
  db.exec(`ALTER TABLE platform_admins ADD COLUMN totp_secret TEXT;
           ALTER TABLE platform_admins ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
           ALTER TABLE platform_admins ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
           ALTER TABLE platform_admins ADD COLUMN recovery_codes TEXT NOT NULL DEFAULT '[]';`);
}
const sessCols = db.prepare('PRAGMA table_info(owner_sessions)').all().map((c) => c.name);
if (!sessCols.includes('verified')) {
  // verified=0: كلمة المرور صحيحة وبانتظار رمز التحقق بخطوتين
  db.exec(`ALTER TABLE owner_sessions ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;
           ALTER TABLE owner_sessions ADD COLUMN failed INTEGER NOT NULL DEFAULT 0;`);
}

/* الوظيفة كما في ملف الموظفين (معلم مادة رياضيات، مدير مدرسة...) */
if (!db.prepare('PRAGMA table_info(teachers)').all().some((c) => c.name === 'job')) {
  db.exec('ALTER TABLE teachers ADD COLUMN job TEXT');
}

/* name_match(name, query): بحث الأسماء العربية بالكلمات ومع اختلاف الهمزات (src/search.js) */
const { nameMatches } = require('./search');
db.function('name_match', { deterministic: true }, (name, q) => (nameMatches(name, q) ? 1 : 0));

module.exports = db;
