'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./db');
const xl = require('./excel');

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = process.env.SCHOOL_TZ || 'Asia/Riyadh';
const IS_PROD = process.env.NODE_ENV === 'production';
// الكوكي الآمن يتطلب HTTPS؛ يمكن تعطيله مؤقتاً للتجربة على عنوان IP بدون شهادة
const COOKIE_SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : IS_PROD;
const SESSION_DAYS = 14;
const TYPES = ['absent', 'late', 'escape'];

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' }, // لا يتسرب رابط المعلمين لمواقع أخرى
  })
);
app.use(compression());
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(xlsx|csv)$/i.test(file.originalname)),
});

/* ---------------- أدوات ---------------- */

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
/** ترتيب طبيعي: الصف 9 قبل 10 قبل 11، والشعبة 2 قبل 10 */
const sortSections = (rows) => rows.sort((a, b) => collator.compare(a.grade, b.grade) || collator.compare(a.section, b.section));

const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function today() {
  // YYYY-MM-DD حسب المنطقة الزمنية للمدرسة
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** يتحقق أن الطلب صادر من نفس الموقع (حماية إضافية من CSRF) */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'طلب غير مسموح' });
    } catch {
      return res.status(403).json({ error: 'طلب غير مسموح' });
    }
  }
  next();
}
app.use('/api', sameOrigin);

/* فحص الصحة لمنصات الاستضافة ومراقبة التشغيل */
app.get('/healthz', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

/* ---------------- مصادقة المدير ---------------- */

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات كثيرة، حاول لاحقاً' } });

function setSession(res, schoolId) {
  const token = newToken(32);
  db.prepare('INSERT INTO sessions (token, school_id, expires_at) VALUES (?,?,?)').run(token, schoolId, Date.now() + SESSION_DAYS * 864e5);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: SESSION_DAYS * 864e5, path: '/' });
}

function requireAdmin(req, res, next) {
  const token = req.cookies.sid;
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  const row = db.prepare('SELECT school_id, expires_at FROM sessions WHERE token = ?').get(token);
  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'انتهت الجلسة، سجّل الدخول مجدداً' });
  }
  req.schoolId = row.school_id;
  next();
}

app.post('/api/register', authLimiter, wrap(async (req, res) => {
  const schoolName = str(req.body.schoolName, 150);
  const adminName = str(req.body.adminName, 100);
  const email = str(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!schoolName || !adminName) throw new HttpError(400, 'اسم المدرسة واسم المدير مطلوبان');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'البريد الإلكتروني غير صحيح');
  if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  if (db.prepare('SELECT 1 FROM schools WHERE email = ?').get(email)) throw new HttpError(409, 'هذا البريد مسجّل مسبقاً');

  const hash = await bcrypt.hash(password, 11);
  const info = db.prepare('INSERT INTO schools (name, admin_name, email, password_hash, teacher_token) VALUES (?,?,?,?,?)')
    .run(schoolName, adminName, email, hash, newToken(18));
  // حصص افتراضية: 7 حصص
  const ins = db.prepare('INSERT INTO periods (school_id, number) VALUES (?, ?)');
  for (let i = 1; i <= 7; i++) ins.run(info.lastInsertRowid, i);
  setSession(res, info.lastInsertRowid);
  res.json({ ok: true });
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const school = db.prepare('SELECT id, password_hash FROM schools WHERE email = ?').get(email);
  const ok = school && (await bcrypt.compare(password, school.password_hash));
  if (!ok) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  setSession(res, school.id);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

/* ---------------- واجهة المدير (كل الاستعلامات مقيدة بـ school_id) ---------------- */

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/me', (req, res) => {
  const s = db.prepare('SELECT id, name, admin_name, email, teacher_token, country_code, created_at FROM schools WHERE id = ?').get(req.schoolId);
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM students WHERE school_id = @id) AS students,
      (SELECT COUNT(*) FROM teachers WHERE school_id = @id) AS teachers,
      (SELECT COUNT(*) FROM sections WHERE school_id = @id) AS sections,
      (SELECT COUNT(*) FROM periods  WHERE school_id = @id) AS periods`).get({ id: req.schoolId });
  res.json({ school: s, counts, today: today() });
});

admin.put('/settings', (req, res) => {
  const name = str(req.body.name, 150);
  const adminName = str(req.body.adminName, 100);
  const cc = String(req.body.countryCode || '966').replace(/\D/g, '').slice(0, 4) || '966';
  if (!name || !adminName) throw new HttpError(400, 'الحقول مطلوبة');
  db.prepare('UPDATE schools SET name = ?, admin_name = ?, country_code = ? WHERE id = ?').run(name, adminName, cc, req.schoolId);
  res.json({ ok: true });
});

admin.put('/password', wrap(async (req, res) => {
  const { current, next } = req.body;
  const s = db.prepare('SELECT password_hash FROM schools WHERE id = ?').get(req.schoolId);
  if (typeof current !== 'string' || !(await bcrypt.compare(current, s.password_hash))) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
  if (typeof next !== 'string' || next.length < 8) throw new HttpError(400, 'كلمة المرور الجديدة 8 أحرف على الأقل');
  db.prepare('UPDATE schools SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(next, 11), req.schoolId);
  db.prepare('DELETE FROM sessions WHERE school_id = ? AND token != ?').run(req.schoolId, req.cookies.sid);
  res.json({ ok: true });
}));

admin.post('/rotate-link', (req, res) => {
  const token = newToken(18);
  db.prepare('UPDATE schools SET teacher_token = ? WHERE id = ?').run(token, req.schoolId);
  res.json({ teacher_token: token });
});

/* --- الصفوف والطلاب --- */

admin.get('/sections', (req, res) => {
  const rows = db.prepare(`SELECT sec.id, sec.grade, sec.section, COUNT(st.id) AS students
    FROM sections sec LEFT JOIN students st ON st.section_id = sec.id
    WHERE sec.school_id = ? GROUP BY sec.id`).all(req.schoolId);
  res.json(sortSections(rows));
});

admin.delete('/sections/:id', (req, res) => {
  db.prepare('DELETE FROM sections WHERE id = ? AND school_id = ?').run(Number(req.params.id), req.schoolId);
  res.json({ ok: true });
});

function getOrCreateSection(schoolId, grade, section) {
  const found = db.prepare('SELECT id FROM sections WHERE school_id = ? AND grade = ? AND section = ?').get(schoolId, grade, section);
  if (found) return found.id;
  return db.prepare('INSERT INTO sections (school_id, grade, section) VALUES (?,?,?)').run(schoolId, grade, section).lastInsertRowid;
}

admin.post('/students/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'أرفق ملف Excel (xlsx) أو CSV');
  let list;
  try {
    list = await xl.parseStudents(req.file.buffer, req.file.originalname);
  } catch (e) {
    throw new HttpError(400, e.message || 'تعذر قراءة الملف');
  }
  if (!list.length) throw new HttpError(400, 'لم يتم العثور على طلاب في الملف');
  const replace = req.body.mode === 'replace';
  let added = 0, skipped = 0;
  db.transaction(() => {
    if (replace) db.prepare('DELETE FROM sections WHERE school_id = ?').run(req.schoolId); // يحذف الطلاب والسجلات تبعاً
    const exists = db.prepare('SELECT 1 FROM students WHERE section_id = ? AND name = ?');
    const ins = db.prepare('INSERT INTO students (school_id, section_id, name, student_no, guardian_phone) VALUES (?,?,?,?,?)');
    for (const s of list) {
      const secId = getOrCreateSection(req.schoolId, s.grade, s.section);
      if (exists.get(secId, s.name)) { skipped++; continue; }
      ins.run(req.schoolId, secId, s.name, s.student_no, s.guardian_phone);
      added++;
    }
  })();
  const sections = db.prepare('SELECT COUNT(*) AS n FROM sections WHERE school_id = ?').get(req.schoolId).n;
  res.json({ added, skipped, sections });
}));

admin.get('/students', (req, res) => {
  const secId = Number(req.query.section_id) || null;
  const q = str(req.query.q, 100);
  const rows = db.prepare(`SELECT st.id, st.name, st.student_no, st.guardian_phone, sec.grade, sec.section, sec.id AS section_id
    FROM students st JOIN sections sec ON sec.id = st.section_id
    WHERE st.school_id = @school AND (@sec IS NULL OR st.section_id = @sec) AND (@q = '' OR st.name LIKE '%' || @q || '%')
    LIMIT 3000`).all({ school: req.schoolId, sec: secId, q });
  res.json(rows.sort((a, b) => collator.compare(a.grade, b.grade) || collator.compare(a.section, b.section) || collator.compare(a.name, b.name)));
});

admin.post('/students', (req, res) => {
  const name = str(req.body.name), grade = xl.normGrade(str(req.body.grade, 60)), section = xl.normSection(str(req.body.section, 30));
  if (!name || !grade || !section) throw new HttpError(400, 'الاسم والصف والشعبة مطلوبة');
  const secId = getOrCreateSection(req.schoolId, grade, section);
  db.prepare('INSERT INTO students (school_id, section_id, name, student_no, guardian_phone) VALUES (?,?,?,?,?)')
    .run(req.schoolId, secId, name, str(req.body.student_no, 40) || null, str(req.body.guardian_phone, 30) || null);
  res.json({ ok: true });
});

admin.delete('/students/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ? AND school_id = ?').run(Number(req.params.id), req.schoolId);
  res.json({ ok: true });
});

/* --- المعلمون --- */

admin.get('/teachers', (req, res) => {
  res.json(db.prepare(`SELECT t.id, t.name, t.subject, t.phone,
      (SELECT COUNT(*) FROM records r WHERE r.teacher_id = t.id) AS records
    FROM teachers t WHERE t.school_id = ? ORDER BY t.name`).all(req.schoolId));
});

admin.post('/teachers', (req, res) => {
  const name = str(req.body.name);
  if (!name) throw new HttpError(400, 'اسم المعلم مطلوب');
  db.prepare('INSERT INTO teachers (school_id, name, subject, phone) VALUES (?,?,?,?)').run(req.schoolId, name, str(req.body.subject, 80) || null, str(req.body.phone, 30) || null);
  res.json({ ok: true });
});

admin.post('/teachers/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'أرفق ملف Excel (xlsx) أو CSV');
  let list;
  try {
    list = await xl.parseTeachers(req.file.buffer, req.file.originalname);
  } catch (e) {
    throw new HttpError(400, e.message || 'تعذر قراءة الملف');
  }
  if (!list.length) throw new HttpError(400, 'لم يتم العثور على معلمين في الملف');
  let added = 0, skipped = 0;
  db.transaction(() => {
    if (req.body.mode === 'replace') db.prepare('DELETE FROM teachers WHERE school_id = ?').run(req.schoolId);
    const exists = db.prepare('SELECT 1 FROM teachers WHERE school_id = ? AND name = ?');
    const ins = db.prepare('INSERT INTO teachers (school_id, name, subject, phone) VALUES (?,?,?,?)');
    for (const t of list) {
      if (exists.get(req.schoolId, t.name)) { skipped++; continue; }
      ins.run(req.schoolId, t.name, t.subject, t.phone);
      added++;
    }
  })();
  res.json({ added, skipped });
}));

admin.delete('/teachers/:id', (req, res) => {
  db.prepare('DELETE FROM teachers WHERE id = ? AND school_id = ?').run(Number(req.params.id), req.schoolId);
  res.json({ ok: true });
});

/* --- الحصص --- */

admin.get('/periods', (req, res) => {
  res.json(db.prepare('SELECT number, start_time, end_time FROM periods WHERE school_id = ? ORDER BY number').all(req.schoolId));
});

admin.put('/periods', (req, res) => {
  const list = Array.isArray(req.body.periods) ? req.body.periods : [];
  if (list.length < 1 || list.length > 12) throw new HttpError(400, 'عدد الحصص يجب أن يكون بين 1 و 12');
  const time = (t) => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? t : null);
  db.transaction(() => {
    db.prepare('DELETE FROM periods WHERE school_id = ?').run(req.schoolId);
    const ins = db.prepare('INSERT INTO periods (school_id, number, start_time, end_time) VALUES (?,?,?,?)');
    list.forEach((p, i) => ins.run(req.schoolId, i + 1, time(p.start_time), time(p.end_time)));
  })();
  res.json({ ok: true });
});

/* --- السجلات والإحصائيات --- */

function recordFilters(req) {
  const t = today();
  const from = isDate(req.query.from) ? req.query.from : t;
  const to = isDate(req.query.to) ? req.query.to : t;
  return {
    school: req.schoolId,
    from,
    to,
    grade: str(req.query.grade, 60),
    sec: Number(req.query.section_id) || null,
    type: TYPES.includes(req.query.type) ? req.query.type : '',
    q: str(req.query.q, 100),
  };
}

const FILTER_SQL = `r.school_id = @school AND r.date BETWEEN @from AND @to
  AND (@grade = '' OR sec.grade = @grade) AND (@sec IS NULL OR r.section_id = @sec)
  AND (@type = '' OR r.type = @type) AND (@q = '' OR st.name LIKE '%' || @q || '%')`;

function queryRecords(f) {
  return db.prepare(`SELECT r.id, r.date, r.period_number, r.type, r.note, r.created_at,
      COALESCE(t.name, r.teacher_name) AS teacher_name, st.name AS student_name, sec.grade, sec.section
    FROM records r JOIN students st ON st.id = r.student_id JOIN sections sec ON sec.id = r.section_id
    LEFT JOIN teachers t ON t.id = r.teacher_id
    WHERE ${FILTER_SQL} ORDER BY r.date DESC, sec.grade, sec.section, r.period_number, st.name LIMIT 20000`).all(f);
}

function queryStudentSummary(f) {
  return db.prepare(`SELECT st.id, st.name, sec.grade, sec.section, st.guardian_phone,
      SUM(r.type = 'absent') AS absent, SUM(r.type = 'late') AS late, SUM(r.type = 'escape') AS "escape", COUNT(*) AS total
    FROM records r JOIN students st ON st.id = r.student_id JOIN sections sec ON sec.id = r.section_id
    WHERE ${FILTER_SQL} GROUP BY st.id ORDER BY total DESC, st.name LIMIT 5000`).all(f);
}

admin.get('/records', (req, res) => {
  const f = recordFilters(req);
  res.json({ filters: f, records: queryRecords(f) });
});

admin.delete('/records/:id', (req, res) => {
  db.prepare('DELETE FROM records WHERE id = ? AND school_id = ?').run(Number(req.params.id), req.schoolId);
  res.json({ ok: true });
});

admin.get('/stats', (req, res) => {
  const f = recordFilters(req);
  const base = `FROM records r JOIN students st ON st.id = r.student_id JOIN sections sec ON sec.id = r.section_id WHERE ${FILTER_SQL}`;
  const totals = db.prepare(`SELECT SUM(r.type='absent') AS absent, SUM(r.type='late') AS late, SUM(r.type='escape') AS "escape",
      COUNT(*) AS total, COUNT(DISTINCT r.student_id) AS students ${base}`).get(f);
  const byDay = db.prepare(`SELECT r.date, SUM(r.type='absent') AS absent, SUM(r.type='late') AS late, SUM(r.type='escape') AS "escape"
      ${base} GROUP BY r.date ORDER BY r.date`).all(f);
  const bySection = db.prepare(`SELECT sec.id, sec.grade, sec.section,
      (SELECT COUNT(*) FROM students s2 WHERE s2.section_id = sec.id) AS size,
      SUM(r.type='absent') AS absent, SUM(r.type='late') AS late, SUM(r.type='escape') AS "escape", COUNT(*) AS total
      ${base} GROUP BY sec.id ORDER BY total DESC`).all(f);
  const byPeriod = db.prepare(`SELECT r.period_number AS period, SUM(r.type='absent') AS absent, SUM(r.type='late') AS late, SUM(r.type='escape') AS "escape"
      ${base} GROUP BY r.period_number ORDER BY r.period_number`).all(f);
  const students = queryStudentSummary(f);
  const top = (k) => students.filter((s) => s[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, 10);
  res.json({ filters: f, totals, byDay, bySection, byPeriod, top: { absent: top('absent'), late: top('late'), escape: top('escape') }, students });
});

admin.patch('/students/:id', (req, res) => {
  const phone = str(req.body.guardian_phone, 30) || null;
  const r = db.prepare('UPDATE students SET guardian_phone = ? WHERE id = ? AND school_id = ?').run(phone, Number(req.params.id), req.schoolId);
  if (!r.changes) throw new HttpError(404, 'الطالب غير موجود');
  res.json({ ok: true });
});

/**
 * كشوف أولياء الأمور: لكل طالب سجلاته في الفترة.
 * student_id لطالب واحد، أو بدونها لكل من لديه حالات (مع فلاتر الصف/الشعبة/الحالة).
 */
function studentReports(req) {
  const f = recordFilters(req);
  const sid = Number(req.query.student_id) || null;
  const students = sid
    ? db.prepare(`SELECT st.id, st.name, st.student_no, st.guardian_phone, sec.grade, sec.section
        FROM students st JOIN sections sec ON sec.id = st.section_id WHERE st.id = ? AND st.school_id = ?`).all(sid, req.schoolId)
    : queryStudentSummary(f).slice(0, 1000);
  const recStmt = db.prepare(`SELECT r.date, r.period_number, r.type, r.note, COALESCE(t.name, r.teacher_name) AS teacher_name
    FROM records r LEFT JOIN teachers t ON t.id = r.teacher_id
    WHERE r.school_id = @school AND r.student_id = @id AND r.date BETWEEN @from AND @to AND (@type = '' OR r.type = @type)
    ORDER BY r.date, r.period_number`);
  const phoneStmt = db.prepare('SELECT student_no, guardian_phone FROM students WHERE id = ?');
  const list = students.map((s) => {
    const records = recStmt.all({ ...f, id: s.id });
    const extra = phoneStmt.get(s.id);
    const totals = { absent: 0, late: 0, escape: 0 };
    records.forEach((r) => totals[r.type]++);
    // أيام الغياب الكامل = أيام غاب فيها كل الحصص المرصودة لذلك اليوم
    const days = new Set(records.filter((r) => r.type === 'absent').map((r) => r.date));
    return { id: s.id, name: s.name, grade: s.grade, section: s.section, student_no: extra.student_no, guardian_phone: extra.guardian_phone, totals, absentDays: days.size, records };
  });
  const school = db.prepare('SELECT name, country_code FROM schools WHERE id = ?').get(req.schoolId);
  return { school: school.name, country_code: school.country_code, from: f.from, to: f.to, students: list };
}

admin.get('/student-reports', (req, res) => res.json(studentReports(req)));

admin.get('/students/:id/export.xlsx', wrap(async (req, res) => {
  req.query.student_id = req.params.id;
  const data = studentReports(req);
  if (!data.students.length) throw new HttpError(404, 'الطالب غير موجود');
  const buf = await xl.exportStudent(data, data.students[0]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="student_${data.students[0].id}_${data.from}_${data.to}.xlsx"`);
  res.send(Buffer.from(buf));
}));

admin.get('/export.xlsx', wrap(async (req, res) => {
  const f = recordFilters(req);
  const school = db.prepare('SELECT name FROM schools WHERE id = ?').get(req.schoolId);
  const buf = await xl.exportRecords({ schoolName: school.name, from: f.from, to: f.to, records: queryRecords(f), summary: queryStudentSummary(f) });
  const fname = `attendance_${f.from}_${f.to}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(Buffer.from(buf));
}));

admin.get('/templates/:kind.xlsx', wrap(async (req, res) => {
  const kind = req.params.kind;
  if (!['students', 'teachers'].includes(kind)) throw new HttpError(404, 'غير موجود');
  const buf = kind === 'students' ? await xl.templateStudents() : await xl.templateTeachers();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}_template.xlsx"`);
  res.send(Buffer.from(buf));
}));

app.use('/api/admin', admin);

/* ---------------- واجهة المعلمين (برابط المدرسة فقط، بدون تسجيل دخول) ---------------- */

// معلمو المدرسة غالباً يتشاركون نفس عنوان IP (شبكة المدرسة)، لذا الحد سخي ومرتبط بالرابط + العنوان
const teacherLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.TEACHER_RATE_LIMIT) || 1500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token}|${rateLimit.ipKeyGenerator(req.ip)}`,
  message: { error: 'طلبات كثيرة، حاول بعد لحظات' },
});
const teacher = express.Router({ mergeParams: true });
teacher.use(teacherLimiter);
teacher.use((req, res, next) => {
  const token = req.params.token;
  const school = typeof token === 'string' && token.length >= 16
    ? db.prepare('SELECT id, name FROM schools WHERE teacher_token = ?').get(token)
    : null;
  if (!school) return res.status(404).json({ error: 'الرابط غير صحيح أو تم تغييره. اطلب الرابط الجديد من إدارة المدرسة.' });
  req.schoolId = school.id;
  req.schoolName = school.name;
  next();
});

teacher.get('/info', (req, res) => {
  const sections = db.prepare(`SELECT sec.id, sec.grade, sec.section, COUNT(st.id) AS students
    FROM sections sec LEFT JOIN students st ON st.section_id = sec.id
    WHERE sec.school_id = ? GROUP BY sec.id`).all(req.schoolId);
  sortSections(sections);
  res.json({
    school: req.schoolName,
    today: today(),
    periods: db.prepare('SELECT number, start_time, end_time FROM periods WHERE school_id = ? ORDER BY number').all(req.schoolId),
    teachers: db.prepare('SELECT id, name, subject FROM teachers WHERE school_id = ? ORDER BY name').all(req.schoolId),
    sections,
  });
});

teacher.get('/sections/:id/students', (req, res) => {
  const secId = Number(req.params.id);
  const sec = db.prepare('SELECT id, grade, section FROM sections WHERE id = ? AND school_id = ?').get(secId, req.schoolId);
  if (!sec) throw new HttpError(404, 'الشعبة غير موجودة');
  const period = Number(req.query.period) || 0;
  const date = today();
  const students = db.prepare(`SELECT st.id, st.name,
      (SELECT r.type FROM records r WHERE r.student_id = st.id AND r.date = @date AND r.period_number = @period) AS status,
      (SELECT GROUP_CONCAT(r.period_number || ':' || r.type) FROM records r WHERE r.student_id = st.id AND r.date = @date AND r.period_number != @period) AS other
    FROM students st WHERE st.section_id = @sec AND st.school_id = @school ORDER BY st.name`).all({ sec: secId, school: req.schoolId, date, period });
  res.json({ section: sec, date, period, students });
});

function teacherOf(schoolId, id) {
  id = Number(id) || null;
  if (!id) return { id: null, name: null };
  const t = db.prepare('SELECT id, name FROM teachers WHERE id = ? AND school_id = ?').get(id, schoolId);
  return t || { id: null, name: null };
}

/**
 * يطبق مجموعة تغييرات رصد في معاملة واحدة.
 * item: { student_id, period, type: 'absent'|'late'|'escape'|null, note?, date? }
 * type = null تعني إزالة الرصد (الطالب حاضر).
 */
function applyMarks(schoolId, teacher, items) {
  const date = today();
  const getStudent = db.prepare('SELECT id, section_id FROM students WHERE id = ? AND school_id = ?');
  const validPeriods = new Set(db.prepare('SELECT number FROM periods WHERE school_id = ?').all(schoolId).map((p) => p.number));
  const upsert = db.prepare(`INSERT INTO records (school_id, student_id, section_id, date, period_number, type, teacher_id, teacher_name, note)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT (school_id, student_id, date, period_number) DO UPDATE SET
      type = excluded.type, teacher_id = excluded.teacher_id, teacher_name = excluded.teacher_name,
      note = COALESCE(excluded.note, records.note), created_at = datetime('now')`);
  const del = db.prepare('DELETE FROM records WHERE school_id = ? AND student_id = ? AND date = ? AND period_number = ?');
  const results = [];
  db.transaction(() => {
    for (const it of items) {
      const period = Number(it.period);
      const type = it.type === null ? null : it.type;
      // تغييرات محفوظة على الجهاز من يوم سابق تُرفض حتى لا تُسجل بتاريخ خاطئ
      if (it.date && it.date !== date) { results.push({ ok: false, reason: 'stale' }); continue; }
      if (type !== null && !TYPES.includes(type)) { results.push({ ok: false, reason: 'type' }); continue; }
      if (!validPeriods.has(period)) { results.push({ ok: false, reason: 'period' }); continue; }
      const st = getStudent.get(Number(it.student_id), schoolId);
      if (!st) { results.push({ ok: false, reason: 'student' }); continue; }
      if (type === null) del.run(schoolId, st.id, date, period);
      else upsert.run(schoolId, st.id, st.section_id, date, period, type, teacher.id, teacher.name, str(it.note, 300) || null);
      results.push({ ok: true });
    }
  })();
  return results;
}

// رصد دفعة واحدة: طلب واحد لعدة طلاب (أخف على الخادم وأسرع للمعلم)
teacher.post('/marks', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length || items.length > 300) throw new HttpError(400, 'لا توجد تغييرات');
  const results = applyMarks(req.schoolId, teacherOf(req.schoolId, req.body.teacher_id), items);
  res.json({ ok: true, saved: results.filter((r) => r.ok).length, results });
});

teacher.put('/mark', (req, res) => {
  if (!TYPES.includes(req.body.type)) throw new HttpError(400, 'نوع غير صحيح');
  const [r] = applyMarks(req.schoolId, teacherOf(req.schoolId, req.body.teacher_id), [req.body]);
  if (!r.ok) throw r.reason === 'student' ? new HttpError(404, 'الطالب غير موجود') : new HttpError(400, 'تعذر حفظ الرصد');
  res.json({ ok: true });
});

teacher.delete('/mark', (req, res) => {
  applyMarks(req.schoolId, { id: null, name: null }, [{ ...req.body, type: null }]);
  res.json({ ok: true });
});

app.use('/api/t/:token', teacher);

/* ---------------- الصفحات ---------------- */

const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { index: false, extensions: ['html'], maxAge: '1h' }));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/report', (req, res) => res.sendFile(path.join(pub, 'report.html')));
app.get('/student-report', (req, res) => res.sendFile(path.join(pub, 'student-report.html')));
app.get('/t/:token', (req, res) => res.sendFile(path.join(pub, 'teacher.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود' }));

app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status === 500) console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من 5 ميجابايت' : status === 500 ? 'حدث خطأ في الخادم' : err.message;
  res.status(status).json({ error: msg });
});

if (require.main === module) {
  const backup = require('./backup');
  const server = app.listen(PORT, () => console.log(`منصة الحضور تعمل على المنفذ ${PORT} (${IS_PROD ? 'production' : 'development'})`));
  const stopBackups = backup.schedule();
  // تنظيف الجلسات المنتهية كل ساعة
  const cleanup = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3);
  cleanup.unref();

  // إيقاف آمن: إنهاء الطلبات الجارية ثم إغلاق قاعدة البيانات
  const shutdown = (sig) => {
    console.log(`${sig}: إيقاف الخادم…`);
    stopBackups();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
