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
const { ownerRouter, schoolAccess } = require('./owner');

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
  fileFilter: (req, file, cb) => cb(null, /\.(xlsx|xls|csv|html?)$/i.test(file.originalname)),
});

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

/** نوع الصورة من محتواها الفعلي (لا من الامتداد): PNG أو JPEG أو WebP فقط — بدون SVG */
function imageType(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
const logoUrl = (key) => (key ? `/logos/${key}` : null);

/* ---------------- أدوات ---------------- */

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
/** ترتيب طبيعي: الصف 9 قبل 10 قبل 11، والشعبة 2 قبل 10 */
const sortSections = (rows) => rows.sort((a, b) => collator.compare(a.grade, b.grade) || collator.compare(a.section, b.section));

const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function today() {
  // YYYY-MM-DD حسب المنطقة الزمنية للمدرسة
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const SUPPORT = {
  whatsapp: (process.env.SUPPORT_WHATSAPP || '').replace(/\D/g, ''),
  email: process.env.SUPPORT_EMAIL || '',
  name: process.env.PLATFORM_NAME || 'رصد الحضور',
};
// request: التسجيل العام يُنشئ طلب اشتراك ينتظر موافقة المالك. closed: المالك وحده يُنشئ المدارس.
const REGISTRATION_MODE = process.env.REGISTRATION_MODE === 'closed' ? 'closed' : 'request';

function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, last));
  return x.toISOString().slice(0, 10);
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

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT) || 20, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات كثيرة، حاول لاحقاً' } });

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
  const school = db.prepare('SELECT status, subscription_end, must_change_password FROM schools WHERE id = ?').get(row.school_id);
  const access = schoolAccess(school, today());
  if (!access.ok) return res.status(403).json({ error: access.message, code: access.code, support: SUPPORT });
  if (school.must_change_password && !['/me', '/password'].includes(req.path)) {
    return res.status(403).json({ error: 'غيّر كلمة المرور المؤقتة أولاً', code: 'must_change_password' });
  }
  req.schoolId = row.school_id;
  next();
}

/** إنشاء مدرسة (من طلب الاشتراك العام أو من لوحة المالك) */
async function newSchool({ schoolName, adminName, email, password, contactPhone, status, mustChange }) {
  if (!schoolName || !adminName) throw new HttpError(400, 'اسم المدرسة واسم المدير مطلوبان');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'البريد الإلكتروني غير صحيح');
  if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  if (db.prepare('SELECT 1 FROM schools WHERE email = ?').get(email)) throw new HttpError(409, 'هذا البريد مسجّل مسبقاً');
  const hash = await bcrypt.hash(password, 11);
  const cc = String(process.env.DEFAULT_COUNTRY_CODE || '966').replace(/\D/g, '').slice(0, 4) || '966';
  const info = db.prepare(`INSERT INTO schools (name, admin_name, email, password_hash, teacher_token, country_code, contact_phone, status, must_change_password, approved_at)
    VALUES (?,?,?,?,?,?,?,?,?, CASE WHEN ? = 'active' THEN datetime('now') END)`)
    .run(schoolName, adminName, email, hash, newToken(18), cc, contactPhone || null, status, mustChange ? 1 : 0, status);
  // حصص افتراضية: 7 حصص
  const ins = db.prepare('INSERT INTO periods (school_id, number) VALUES (?, ?)');
  for (let i = 1; i <= 7; i++) ins.run(info.lastInsertRowid, i);
  return info.lastInsertRowid;
}

app.get('/api/public/info', (req, res) => res.json({ registration: REGISTRATION_MODE, support: SUPPORT }));

app.post('/api/register', authLimiter, wrap(async (req, res) => {
  if (REGISTRATION_MODE === 'closed') throw new HttpError(403, 'التسجيل يتم عن طريق إدارة المنصة. تواصل معنا.');
  await newSchool({
    schoolName: str(req.body.schoolName, 150),
    adminName: str(req.body.adminName, 100),
    email: str(req.body.email, 150).toLowerCase(),
    password: typeof req.body.password === 'string' ? req.body.password : '',
    contactPhone: str(req.body.contactPhone, 30),
    status: 'pending',
  });
  res.json({ ok: true, pending: true, support: SUPPORT });
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const school = db.prepare('SELECT id, password_hash FROM schools WHERE email = ?').get(email);
  const ok = school && (await bcrypt.compare(password, school.password_hash));
  if (!ok) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
  const access = schoolAccess(db.prepare('SELECT status, subscription_end FROM schools WHERE id = ?').get(school.id), today());
  if (!access.ok) return res.status(403).json({ error: access.message, code: access.code, support: SUPPORT });
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
  const s = db.prepare('SELECT id, name, admin_name, email, teacher_token, country_code, created_at, plan, subscription_end, must_change_password, logo_key FROM schools WHERE id = ?').get(req.schoolId);
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM students WHERE school_id = @id AND status = 'active') AS students,
      (SELECT COUNT(*) FROM teachers WHERE school_id = @id) AS teachers,
      (SELECT COUNT(*) FROM sections WHERE school_id = @id) AS sections,
      (SELECT COUNT(*) FROM periods  WHERE school_id = @id) AS periods`).get({ id: req.schoolId });
  const t = today();
  const daysLeft = s.subscription_end ? Math.round((new Date(s.subscription_end) - new Date(t)) / 864e5) : null;
  s.logo_url = logoUrl(s.logo_key);
  delete s.logo_key;
  res.json({ school: s, counts, today: t, subscription: { plan: s.plan, end: s.subscription_end, days_left: daysLeft }, support: SUPPORT });
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
  db.prepare('UPDATE schools SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(await bcrypt.hash(next, 11), req.schoolId);
  db.prepare('DELETE FROM sessions WHERE school_id = ? AND token != ?').run(req.schoolId, req.cookies.sid);
  res.json({ ok: true });
}));

admin.post('/logo', logoUpload.single('logo'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'اختر صورة الشعار');
  const type = imageType(req.file.buffer);
  if (!type) throw new HttpError(400, 'الشعار يجب أن يكون صورة PNG أو JPG أو WebP');
  const key = newToken(12);
  db.prepare('UPDATE schools SET logo = ?, logo_type = ?, logo_key = ? WHERE id = ?').run(req.file.buffer, type, key, req.schoolId);
  res.json({ ok: true, logo_url: logoUrl(key) });
});

admin.delete('/logo', (req, res) => {
  db.prepare('UPDATE schools SET logo = NULL, logo_type = NULL, logo_key = NULL WHERE id = ?').run(req.schoolId);
  res.json({ ok: true });
});

admin.post('/rotate-link', (req, res) => {
  const token = newToken(18);
  db.prepare('UPDATE schools SET teacher_token = ? WHERE id = ?').run(token, req.schoolId);
  res.json({ teacher_token: token });
});

/* --- الصفوف والطلاب --- */

const STATUSES = ['active', 'withdrawn', 'transferred'];
const STATUS_LABEL = { active: 'نشط', withdrawn: 'منقطع', transferred: 'منتقل من المدرسة' };
const secText = (grade, section) => `${/^\d+$/.test(grade) ? `الصف ${grade}` : grade} / شعبة ${section}`;

admin.get('/sections', (req, res) => {
  const rows = db.prepare(`SELECT sec.id, sec.grade, sec.section,
      COUNT(CASE WHEN st.status = 'active' THEN 1 END) AS students,
      COUNT(CASE WHEN st.status != 'active' THEN 1 END) AS inactive
    FROM sections sec LEFT JOIN students st ON st.section_id = sec.id
    WHERE sec.school_id = ? GROUP BY sec.id`).all(req.schoolId);
  res.json(sortSections(rows));
});

/** إعادة تسمية شعبة؛ وإن وُجدت شعبة بنفس الاسم تُدمج فيها (ينتقل طلابها وسجلاتها) */
admin.patch('/sections/:id', (req, res) => {
  const id = Number(req.params.id);
  const sec = db.prepare('SELECT * FROM sections WHERE id = ? AND school_id = ?').get(id, req.schoolId);
  if (!sec) throw new HttpError(404, 'الشعبة غير موجودة');
  const grade = xl.normGrade(str(req.body.grade, 60)), section = xl.normSection(str(req.body.section, 30));
  if (!grade || !section) throw new HttpError(400, 'الصف والشعبة مطلوبان');
  const target = db.prepare('SELECT id FROM sections WHERE school_id = ? AND grade = ? AND section = ? AND id != ?').get(req.schoolId, grade, section, id);
  db.transaction(() => {
    if (target) {
      db.prepare('UPDATE students SET section_id = ? WHERE section_id = ?').run(target.id, id);
      db.prepare('UPDATE records SET section_id = ? WHERE section_id = ?').run(target.id, id);
      db.prepare('DELETE FROM sections WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE sections SET grade = ?, section = ? WHERE id = ?').run(grade, section, id);
    }
  })();
  res.json({ ok: true, merged: !!target });
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

function logEvent(schoolId, studentId, kind, fromText, toText, note, date) {
  db.prepare('INSERT INTO student_events (school_id, student_id, date, kind, from_text, to_text, note) VALUES (?,?,?,?,?,?,?)')
    .run(schoolId, studentId, date || today(), kind, fromText || null, toText || null, note || null);
}

/** نقل طالب لشعبة أخرى (السجلات السابقة تبقى باسم الشعبة القديمة للإحصاء التاريخي) */
function moveStudent(schoolId, st, secId, note, date) {
  if (st.section_id === secId) return false;
  const from = db.prepare('SELECT grade, section FROM sections WHERE id = ?').get(st.section_id);
  const to = db.prepare('SELECT grade, section FROM sections WHERE id = ? AND school_id = ?').get(secId, schoolId);
  if (!to) throw new HttpError(404, 'الشعبة غير موجودة');
  db.prepare('UPDATE students SET section_id = ? WHERE id = ?').run(secId, st.id);
  logEvent(schoolId, st.id, 'move', secText(from.grade, from.section), secText(to.grade, to.section), note, date);
  st.section_id = secId;
  return true;
}

function setStudentStatus(schoolId, st, status, note, date) {
  if (!STATUSES.includes(status)) throw new HttpError(400, 'حالة غير صحيحة');
  if (st.status === status) return false;
  const d = date || today();
  db.prepare('UPDATE students SET status = ?, status_date = ?, status_note = ? WHERE id = ?')
    .run(status, status === 'active' ? null : d, status === 'active' ? null : note || null, st.id);
  logEvent(schoolId, st.id, status === 'active' ? 'reactivated' : status, STATUS_LABEL[st.status], STATUS_LABEL[status], note, d);
  st.status = status;
  return true;
}

/** يحدد الشعبة المطلوبة من section_id أو من (grade, section) مع إنشائها إن لزم */
function targetSection(schoolId, body) {
  if (body.section_id) return Number(body.section_id);
  const grade = xl.normGrade(str(body.grade, 60)), section = xl.normSection(str(body.section, 30));
  if (!grade || !section) return null;
  return getOrCreateSection(schoolId, grade, section);
}

/* ---------- رفع القوائم ومزامنتها ----------
 * mode=append  : إضافة فقط
 * mode=replace : حذف الكل ثم إضافة
 * mode=sync    : تحديث القائمة — يطابق الطلاب (برقم الطالب ثم بالاسم)، ينقل من تغيرت شعبته،
 *                يضيف الجدد، يعيد تفعيل العائدين، ويعالج من لم يرد في الملف حسب missing_action.
 *                مع dry_run=1 يعيد معاينة التغييرات دون تطبيقها.
 */
function planSync(schoolId, list, wholeSchool = false) {
  const inFile = new Set(list.map((r) => `${r.grade}\u0000${r.section}`));
  const all = db.prepare(`SELECT st.id, st.name, st.student_no, st.guardian_phone, st.section_id, st.status, sec.grade, sec.section
    FROM students st JOIN sections sec ON sec.id = st.section_id WHERE st.school_id = ?`).all(schoolId);
  const byNo = new Map(), byName = new Map();
  for (const s of all) {
    if (s.student_no) byNo.set(String(s.student_no), s);
    const k = s.name.replace(/\s+/g, ' ').trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(s);
  }
  const used = new Set();
  const plan = { unchanged: [], moved: [], reactivated: [], added: [], ambiguous: [], missing: [] };
  for (const row of list) {
    let match = row.student_no && byNo.get(String(row.student_no));
    if (match && used.has(match.id)) match = null;
    if (!match) {
      const cands = (byName.get(row.name) || []).filter((c) => !used.has(c.id));
      match = cands.find((c) => c.grade === row.grade && c.section === row.section) || (cands.length === 1 ? cands[0] : null);
      if (!match && cands.length > 1) { plan.ambiguous.push({ name: row.name, to: secText(row.grade, row.section) }); continue; }
    }
    if (!match) { plan.added.push({ row, name: row.name, to: secText(row.grade, row.section) }); continue; }
    used.add(match.id);
    const item = { row, st: match, name: match.name, from: secText(match.grade, match.section), to: secText(row.grade, row.section) };
    if (match.status !== 'active') plan.reactivated.push(item);
    else if (match.grade !== row.grade || match.section !== row.section) plan.moved.push(item);
    else plan.unchanged.push(item);
  }
  // «غير موجود في الملف» يُحسب فقط داخل الشعب الموجودة في الملف، إلا إذا كان الملف لكل المدرسة
  for (const s of all) if (s.status === 'active' && !used.has(s.id) && (wholeSchool || inFile.has(`${s.grade}\u0000${s.section}`))) plan.missing.push({ st: s, name: s.name, from: secText(s.grade, s.section) });
  return plan;
}

admin.post('/students/upload', upload.array('file', 60), wrap(async (req, res) => {
  if (!req.files || !req.files.length) throw new HttpError(400, 'أرفق ملف Excel (xlsx أو xls) أو CSV');
  // عدة ملفات (مثل ملف لكل شعبة من نظام الوزارة) تُعامل كقائمة واحدة
  let list = [];
  const files = [];
  for (const f of req.files) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      const part = await xl.parseStudents(f.buffer, f.originalname, { grade: req.body.grade, section: req.body.section });
      list = list.concat(part);
      const secs = [...new Set(part.map((s) => secText(s.grade, s.section)))];
      files.push({ name, students: part.length, sections: secs });
    } catch (e) {
      throw new HttpError(400, req.files.length > 1 ? `${name}: ${e.message}` : e.message || 'تعذر قراءة الملف');
    }
  }
  if (!list.length) throw new HttpError(400, 'لم يتم العثور على طلاب في الملف');
  const mode = ['replace', 'sync'].includes(req.body.mode) ? req.body.mode : 'append';

  if (mode === 'sync') {
    const plan = planSync(req.schoolId, list, req.body.scope === 'all');
    const view = (arr) => arr.slice(0, 300).map(({ name, from, to }) => ({ name, from, to }));
    const summary = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length]));
    if (req.body.dry_run === '1') {
      return res.json({ preview: true, files, summary, moved: view(plan.moved), reactivated: view(plan.reactivated), added: view(plan.added), missing: view(plan.missing), ambiguous: plan.ambiguous.slice(0, 300) });
    }
    const missingAction = ['withdrawn', 'transferred'].includes(req.body.missing_action) ? req.body.missing_action : 'keep';
    const note = 'تحديث القائمة';
    const upd = db.prepare('UPDATE students SET student_no = COALESCE(?, student_no), guardian_phone = COALESCE(?, guardian_phone) WHERE id = ?');
    const ins = db.prepare('INSERT INTO students (school_id, section_id, name, student_no, guardian_phone) VALUES (?,?,?,?,?)');
    db.transaction(() => {
      for (const it of [...plan.unchanged, ...plan.moved, ...plan.reactivated]) {
        upd.run(it.row.student_no, it.row.guardian_phone, it.st.id);
        moveStudent(req.schoolId, it.st, getOrCreateSection(req.schoolId, it.row.grade, it.row.section), note);
        if (it.st.status !== 'active') setStudentStatus(req.schoolId, it.st, 'active', note);
      }
      for (const it of plan.added) {
        const r = ins.run(req.schoolId, getOrCreateSection(req.schoolId, it.row.grade, it.row.section), it.row.name, it.row.student_no, it.row.guardian_phone);
        logEvent(req.schoolId, r.lastInsertRowid, 'created', null, it.to, note);
      }
      if (missingAction !== 'keep') for (const it of plan.missing) setStudentStatus(req.schoolId, it.st, missingAction, 'غير موجود في القائمة المحدّثة');
    })();
    return res.json({ applied: true, summary, missing_action: missingAction });
  }

  let added = 0, skipped = 0;
  db.transaction(() => {
    if (mode === 'replace') db.prepare('DELETE FROM sections WHERE school_id = ?').run(req.schoolId); // يحذف الطلاب والسجلات تبعاً
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
  res.json({ added, skipped, sections, files });
}));

admin.get('/students', (req, res) => {
  const secId = Number(req.query.section_id) || null;
  const q = str(req.query.q, 100);
  const status = STATUSES.includes(req.query.status) ? req.query.status : req.query.status === 'all' ? '' : 'active';
  const rows = db.prepare(`SELECT st.id, st.name, st.student_no, st.guardian_phone, st.status, st.status_date, st.status_note,
      sec.grade, sec.section, sec.id AS section_id
    FROM students st JOIN sections sec ON sec.id = st.section_id
    WHERE st.school_id = @school AND (@sec IS NULL OR st.section_id = @sec) AND (@q = '' OR name_match(st.name, @q))
      AND (@status = '' OR st.status = @status)
    LIMIT 5000`).all({ school: req.schoolId, sec: secId, q, status });
  res.json(rows.sort((a, b) => collator.compare(a.grade, b.grade) || collator.compare(a.section, b.section) || collator.compare(a.name, b.name)));
});

admin.get('/students/counts', (req, res) => {
  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM students WHERE school_id = ? GROUP BY status').all(req.schoolId);
  res.json(Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n || 0])));
});

admin.get('/students/:id', (req, res) => {
  const st = db.prepare(`SELECT st.id, st.name, st.student_no, st.guardian_phone, st.status, st.status_date, st.status_note,
      sec.grade, sec.section, sec.id AS section_id
    FROM students st JOIN sections sec ON sec.id = st.section_id WHERE st.id = ? AND st.school_id = ?`).get(Number(req.params.id), req.schoolId);
  if (!st) throw new HttpError(404, 'الطالب غير موجود');
  st.events = db.prepare('SELECT date, kind, from_text, to_text, note FROM student_events WHERE student_id = ? ORDER BY id DESC').all(st.id);
  st.records = db.prepare('SELECT COUNT(*) AS n FROM records WHERE student_id = ?').get(st.id).n;
  res.json(st);
});

admin.post('/students', (req, res) => {
  const name = str(req.body.name), grade = xl.normGrade(str(req.body.grade, 60)), section = xl.normSection(str(req.body.section, 30));
  if (!name || !grade || !section) throw new HttpError(400, 'الاسم والصف والشعبة مطلوبة');
  const secId = getOrCreateSection(req.schoolId, grade, section);
  const r = db.prepare('INSERT INTO students (school_id, section_id, name, student_no, guardian_phone) VALUES (?,?,?,?,?)')
    .run(req.schoolId, secId, name, str(req.body.student_no, 40) || null, str(req.body.guardian_phone, 30) || null);
  logEvent(req.schoolId, r.lastInsertRowid, 'created', null, secText(grade, section), 'إضافة يدوية');
  res.json({ ok: true });
});

/** إضافة يدوية سريعة: لصق الأسماء (اسم في كل سطر، ويمكن أن يكون معه رقم الطالب) لشعبة واحدة */
admin.post('/students/paste', (req, res) => {
  const grade = xl.normGrade(str(req.body.grade, 60)), section = xl.normSection(str(req.body.section, 30));
  if (!grade || !section) throw new HttpError(400, 'حدد الصف والشعبة');
  const lines = String(req.body.names || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
  if (!lines.length) throw new HttpError(400, 'اكتب اسماً واحداً على الأقل');
  const secId = getOrCreateSection(req.schoolId, grade, section);
  const exists = db.prepare('SELECT 1 FROM students WHERE section_id = ? AND name = ?');
  const ins = db.prepare('INSERT INTO students (school_id, section_id, name, student_no) VALUES (?,?,?,?)');
  let added = 0, skipped = 0;
  db.transaction(() => {
    for (const line of lines) {
      // أعمدة منسوخة من Excel (Tab) أو مفصولة بفاصلة: الاسم + رقم الطالب بأي ترتيب، ويُتجاهل رقم التسلسل
      const parts = line.split(/\t|,|،/).map((p) => p.trim()).filter(Boolean);
      const name = (parts.find((p) => /[\u0600-\u06FFa-z]/i.test(p) && !/^\d+$/.test(p)) || '').replace(/\s+/g, ' ').slice(0, 200);
      const no = parts.filter((p) => /^\d{5,}$/.test(xl.latinDigits(p))).map((p) => xl.latinDigits(p))[0] || null;
      if (!name) { skipped++; continue; }
      if (exists.get(secId, name)) { skipped++; continue; }
      const r = ins.run(req.schoolId, secId, name, no);
      logEvent(req.schoolId, r.lastInsertRowid, 'created', null, secText(grade, section), 'إضافة يدوية');
      added++;
    }
  })();
  res.json({ ok: true, added, skipped, section: secText(grade, section) });
});

/** تعديل جزئي: البيانات، النقل لشعبة أخرى، والحالة (نشط/منقطع/منتقل) */
admin.patch('/students/:id', (req, res) => {
  const st = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(Number(req.params.id), req.schoolId);
  if (!st) throw new HttpError(404, 'الطالب غير موجود');
  const b = req.body;
  const date = isDate(b.date) ? b.date : today();
  db.transaction(() => {
    if (b.name !== undefined) {
      const name = str(b.name);
      if (!name) throw new HttpError(400, 'الاسم مطلوب');
      db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name, st.id);
    }
    if (b.student_no !== undefined) db.prepare('UPDATE students SET student_no = ? WHERE id = ?').run(str(b.student_no, 40) || null, st.id);
    if (b.guardian_phone !== undefined) db.prepare('UPDATE students SET guardian_phone = ? WHERE id = ?').run(str(b.guardian_phone, 30) || null, st.id);
    if (b.section_id !== undefined || b.grade !== undefined) {
      const secId = targetSection(req.schoolId, b);
      if (!secId) throw new HttpError(400, 'حدد الشعبة');
      moveStudent(req.schoolId, st, secId, str(b.note, 300), date);
    }
    if (b.status !== undefined) setStudentStatus(req.schoolId, st, b.status, str(b.note, 300), date);
  })();
  res.json({ ok: true });
});

/** إجراء جماعي على عدة طلاب: نقل إلى شعبة، أو تغيير الحالة */
admin.post('/students/bulk', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 2000);
  if (!ids.length) throw new HttpError(400, 'لم يتم اختيار طلاب');
  const date = isDate(req.body.date) ? req.body.date : today();
  const note = str(req.body.note, 300);
  const get = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?');
  let changed = 0;
  db.transaction(() => {
    const secId = req.body.action === 'move' ? targetSection(req.schoolId, req.body) : null;
    if (req.body.action === 'move' && !secId) throw new HttpError(400, 'حدد الشعبة');
    if (req.body.action !== 'move' && req.body.action !== 'status') throw new HttpError(400, 'إجراء غير معروف');
    for (const id of ids) {
      const st = get.get(id, req.schoolId);
      if (!st) continue;
      if (req.body.action === 'move' ? moveStudent(req.schoolId, st, secId, note, date) : setStudentStatus(req.schoolId, st, req.body.status, note, date)) changed++;
    }
  })();
  res.json({ ok: true, changed });
});

admin.delete('/students/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ? AND school_id = ?').run(Number(req.params.id), req.schoolId);
  res.json({ ok: true });
});

/* --- المعلمون --- */

admin.get('/teachers', (req, res) => {
  res.json(db.prepare(`SELECT t.id, t.name, t.subject, t.phone, t.job,
      (SELECT COUNT(*) FROM records r WHERE r.teacher_id = t.id) AS records
    FROM teachers t WHERE t.school_id = ? ORDER BY t.name`).all(req.schoolId));
});

admin.post('/teachers', (req, res) => {
  const name = str(req.body.name);
  if (!name) throw new HttpError(400, 'اسم المعلم مطلوب');
  db.prepare('INSERT INTO teachers (school_id, name, subject, phone) VALUES (?,?,?,?)').run(req.schoolId, name, str(req.body.subject, 80) || null, str(req.body.phone, 30) || null);
  res.json({ ok: true });
});

/**
 * رفع ملف المعلمين. ملف موظفي المدرسة من الوزارة يُقرأ كما هو: المعلمون فقط افتراضياً
 * (staff=all لاستيراد كل الموظفين)، والمادة من المسمى الوظيفي.
 * dry_run=1 يعرض المعاينة دون حفظ. المعلم الموجود بنفس الاسم تُحدّث مادته وجواله.
 */
admin.post('/teachers/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'أرفق ملف Excel (xlsx أو xls) أو CSV');
  let all;
  try {
    all = await xl.parseTeachers(req.file.buffer, req.file.originalname);
  } catch (e) {
    throw new HttpError(400, e.message || 'تعذر قراءة الملف');
  }
  const list = req.body.staff === 'all' ? all : all.filter((t) => t.is_teacher);
  const others = all.filter((t) => !t.is_teacher);
  if (!list.length) throw new HttpError(400, 'لم يتم العثور على معلمين في الملف');
  const subjects = {};
  for (const t of list) subjects[t.subject || 'بدون مادة'] = (subjects[t.subject || 'بدون مادة'] || 0) + 1;
  const summary = { total: all.length, teachers: all.length - others.length, others: others.length, importing: list.length };
  if (req.body.dry_run === '1') {
    return res.json({ preview: true, summary, subjects, others: others.map((t) => ({ name: t.name, job: t.job })), sample: list.slice(0, 300).map(({ name, subject, job }) => ({ name, subject, job })) });
  }
  let added = 0, updated = 0;
  db.transaction(() => {
    if (req.body.mode === 'replace') db.prepare('DELETE FROM teachers WHERE school_id = ?').run(req.schoolId);
    const find = db.prepare('SELECT id FROM teachers WHERE school_id = ? AND name = ?');
    const ins = db.prepare('INSERT INTO teachers (school_id, name, subject, phone, job) VALUES (?,?,?,?,?)');
    const upd = db.prepare('UPDATE teachers SET subject = COALESCE(?, subject), phone = COALESCE(?, phone), job = COALESCE(?, job) WHERE id = ?');
    for (const t of list) {
      const ex = find.get(req.schoolId, t.name);
      if (ex) { upd.run(t.subject, t.phone, t.job, ex.id); updated++; continue; }
      ins.run(req.schoolId, t.name, t.subject, t.phone, t.job);
      added++;
    }
  })();
  res.json({ added, updated, skipped: 0, summary, subjects });
}));

/** إدخال جماعي: اسم في كل سطر، ومادة واحدة للجميع أو مادة بجانب كل اسم (مفصولة بفاصلة أو Tab) */
admin.post('/teachers/paste', (req, res) => {
  const common = xl.normSubject(str(req.body.subject, 80));
  const lines = String(req.body.names || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
  if (!lines.length) throw new HttpError(400, 'اكتب اسماً واحداً على الأقل');
  const find = db.prepare('SELECT id FROM teachers WHERE school_id = ? AND name = ?');
  const ins = db.prepare('INSERT INTO teachers (school_id, name, subject, phone) VALUES (?,?,?,?)');
  const upd = db.prepare('UPDATE teachers SET subject = COALESCE(?, subject), phone = COALESCE(?, phone) WHERE id = ?');
  let added = 0, updated = 0, skipped = 0;
  db.transaction(() => {
    for (const line of lines) {
      const parts = line.split(/\t|,|،/).map((p) => p.trim()).filter(Boolean);
      const texts = parts.filter((p) => /[؀-ۿa-z]/i.test(p));
      const name = (texts[0] || '').replace(/\s+/g, ' ').slice(0, 200);
      if (!name) { skipped++; continue; }
      // مادة السطر: النص الثاني، أو المادة من مسمى مثل «معلم مادة رياضيات»
      const rest = texts[1] || '';
      const subject = (rest && (xl.subjectFromJob(rest) || xl.normSubject(rest))) || common;
      const phone = parts.map((p) => xl.latinDigits(p)).find((p) => /^\+?\d{8,15}$/.test(p)) || null;
      const ex = find.get(req.schoolId, name);
      if (ex) { upd.run(subject, phone, ex.id); updated++; } else { ins.run(req.schoolId, name, subject, phone); added++; }
    }
  })();
  res.json({ ok: true, added, updated, skipped });
});

/** تعديل معلم، أو تعيين مادة لعدة معلمين دفعة واحدة */
admin.patch('/teachers/:id', (req, res) => {
  const t = db.prepare('SELECT id FROM teachers WHERE id = ? AND school_id = ?').get(Number(req.params.id), req.schoolId);
  if (!t) throw new HttpError(404, 'المعلم غير موجود');
  if (req.body.name !== undefined) {
    const name = str(req.body.name);
    if (!name) throw new HttpError(400, 'الاسم مطلوب');
    db.prepare('UPDATE teachers SET name = ? WHERE id = ?').run(name, t.id);
  }
  if (req.body.subject !== undefined) db.prepare('UPDATE teachers SET subject = ? WHERE id = ?').run(xl.normSubject(str(req.body.subject, 80)), t.id);
  if (req.body.phone !== undefined) db.prepare('UPDATE teachers SET phone = ? WHERE id = ?').run(str(req.body.phone, 30) || null, t.id);
  res.json({ ok: true });
});

admin.post('/teachers/bulk', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 1000);
  if (!ids.length) throw new HttpError(400, 'لم يتم اختيار معلمين');
  const subject = xl.normSubject(str(req.body.subject, 80));
  let changed = 0;
  db.transaction(() => {
    const upd = db.prepare('UPDATE teachers SET subject = ? WHERE id = ? AND school_id = ?');
    const del = db.prepare('DELETE FROM teachers WHERE id = ? AND school_id = ?');
    for (const id of ids) changed += (req.body.action === 'delete' ? del.run(id, req.schoolId) : upd.run(subject, id, req.schoolId)).changes;
  })();
  res.json({ ok: true, changed });
});

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
  AND (@type = '' OR r.type = @type) AND (@q = '' OR name_match(st.name, @q))`;

function queryRecords(f) {
  return db.prepare(`SELECT r.id, r.date, r.period_number, r.type, r.note, r.created_at,
      COALESCE(t.name, r.teacher_name) AS teacher_name, st.name AS student_name, sec.grade, sec.section
    FROM records r JOIN students st ON st.id = r.student_id JOIN sections sec ON sec.id = r.section_id
    LEFT JOIN teachers t ON t.id = r.teacher_id
    WHERE ${FILTER_SQL} ORDER BY r.date DESC, sec.grade, sec.section, r.period_number, st.name LIMIT 20000`).all(f);
}

function queryStudentSummary(f) {
  return db.prepare(`SELECT st.id, st.name, sec.grade, sec.section, st.guardian_phone, st.status,
      SUM(r.type = 'absent') AS absent, SUM(r.type = 'late') AS late, SUM(r.type = 'escape') AS "escape", COUNT(*) AS total
    FROM records r JOIN students st ON st.id = r.student_id JOIN sections sec ON sec.id = r.section_id
    WHERE ${FILTER_SQL} GROUP BY st.id ORDER BY total DESC, st.name LIMIT 5000`).all(f);
}

/** كشف شعبة ليوم محدد: كل طلاب الشعبة وحالة كل منهم في كل حصة */
admin.get('/sections/:id/day', (req, res) => {
  const sec = db.prepare('SELECT id, grade, section FROM sections WHERE id = ? AND school_id = ?').get(Number(req.params.id), req.schoolId);
  if (!sec) throw new HttpError(404, 'الشعبة غير موجودة');
  const date = isDate(req.query.date) ? req.query.date : today();
  const periods = db.prepare('SELECT number FROM periods WHERE school_id = ? ORDER BY number').all(req.schoolId).map((p) => p.number);
  const recs = db.prepare(`SELECT r.student_id, r.period_number, r.type, r.note, COALESCE(t.name, r.teacher_name) AS teacher
    FROM records r LEFT JOIN teachers t ON t.id = r.teacher_id
    WHERE r.school_id = ? AND r.section_id = ? AND r.date = ?`).all(req.schoolId, sec.id, date);
  const withRecords = new Set(recs.map((r) => r.student_id));
  // الطلاب النشطون في الشعبة، ومن انتقل منها وله رصد في ذلك اليوم
  const students = db.prepare(`SELECT id, name, student_no, status, section_id FROM students
    WHERE school_id = ? AND (section_id = ? AND status = 'active' OR id IN (SELECT student_id FROM records WHERE section_id = ? AND date = ?))`)
    .all(req.schoolId, sec.id, sec.id, date)
    .sort((a, b) => collator.compare(a.name, b.name));
  const byStudent = {};
  for (const r of recs) (byStudent[r.student_id] ||= {})[r.period_number] = { type: r.type, note: r.note, teacher: r.teacher };
  const totals = { absent: 0, late: 0, escape: 0, students: withRecords.size, size: students.filter((s) => s.status === 'active' && s.section_id === sec.id).length };
  recs.forEach((r) => totals[r.type]++);
  // الحصص التي رُصد فيها شيء (لمعرفة هل رصد المعلمون الحصة)
  const markedPeriods = [...new Set(recs.map((r) => r.period_number))];
  res.json({ section: sec, date, periods, marked_periods: markedPeriods, totals,
    students: students.map((s) => ({ id: s.id, name: s.name, student_no: s.student_no, status: s.status, marks: byStudent[s.id] || {} })) });
});

/** رصد أو تصحيح من الإدارة لأي يوم سابق (الحالة null = حاضر) */
admin.put('/marks', (req, res) => {
  const date = isDate(req.body.date) ? req.body.date : null;
  if (!date) throw new HttpError(400, 'التاريخ غير صحيح');
  if (date > today()) throw new HttpError(400, 'لا يمكن الرصد لتاريخ قادم');
  const st = db.prepare('SELECT id, section_id FROM students WHERE id = ? AND school_id = ?').get(Number(req.body.student_id), req.schoolId);
  if (!st) throw new HttpError(404, 'الطالب غير موجود');
  const period = Number(req.body.period);
  if (!db.prepare('SELECT 1 FROM periods WHERE school_id = ? AND number = ?').get(req.schoolId, period)) throw new HttpError(400, 'الحصة غير صحيحة');
  const type = req.body.type === null || req.body.type === '' ? null : req.body.type;
  if (type !== null && !TYPES.includes(type)) throw new HttpError(400, 'نوع غير صحيح');
  if (type === null) {
    db.prepare('DELETE FROM records WHERE school_id = ? AND student_id = ? AND date = ? AND period_number = ?').run(req.schoolId, st.id, date, period);
  } else {
    // الشعبة في السجل: شعبة الطالب في ذلك اليوم إن سبق رصده فيه، وإلا شعبته الحالية
    const prev = db.prepare('SELECT section_id FROM records WHERE school_id = ? AND student_id = ? AND date = ? LIMIT 1').get(req.schoolId, st.id, date);
    db.prepare(`INSERT INTO records (school_id, student_id, section_id, date, period_number, type, teacher_id, teacher_name, note)
      VALUES (?,?,?,?,?,?,NULL,'الإدارة',?)
      ON CONFLICT (school_id, student_id, date, period_number) DO UPDATE SET type = excluded.type, note = COALESCE(excluded.note, records.note)`)
      .run(req.schoolId, st.id, prev ? prev.section_id : st.section_id, date, period, type, str(req.body.note, 300) || null);
  }
  res.json({ ok: true });
});

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
      (SELECT COUNT(*) FROM students s2 WHERE s2.section_id = sec.id AND s2.status = 'active') AS size,
      SUM(r.type='absent') AS absent, SUM(r.type='late') AS late, SUM(r.type='escape') AS "escape", COUNT(*) AS total
      ${base} GROUP BY sec.id ORDER BY total DESC`).all(f);
  const byPeriod = db.prepare(`SELECT r.period_number AS period, SUM(r.type='absent') AS absent, SUM(r.type='late') AS late, SUM(r.type='escape') AS "escape"
      ${base} GROUP BY r.period_number ORDER BY r.period_number`).all(f);
  const students = queryStudentSummary(f);
  const top = (k) => students.filter((s) => s[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, 10);
  res.json({ filters: f, totals, byDay, bySection, byPeriod, top: { absent: top('absent'), late: top('late'), escape: top('escape') }, students });
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
  const school = db.prepare('SELECT name, country_code, logo_key FROM schools WHERE id = ?').get(req.schoolId);
  return { school: school.name, logo_url: logoUrl(school.logo_key), country_code: school.country_code, from: f.from, to: f.to, students: list };
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

/* ---------------- لوحة مالك المنصة ---------------- */
app.use('/api/owner', ownerRouter({ today, str, HttpError, wrap, newToken, cookieSecure: COOKIE_SECURE, newSchool, addMonths }));

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
    ? db.prepare('SELECT id, name, status, subscription_end, logo_key FROM schools WHERE teacher_token = ?').get(token)
    : null;
  if (!school) return res.status(404).json({ error: 'الرابط غير صحيح أو تم تغييره. اطلب الرابط الجديد من إدارة المدرسة.' });
  const access = schoolAccess(school, today());
  if (!access.ok) return res.status(403).json({ error: access.code === 'pending' ? 'حساب المدرسة لم يُفعّل بعد.' : 'الرصد متوقف حالياً لهذه المدرسة. راجع إدارة المدرسة.', code: access.code });
  req.schoolId = school.id;
  req.schoolName = school.name;
  req.schoolLogo = logoUrl(school.logo_key);
  next();
});

teacher.get('/info', (req, res) => {
  const sections = db.prepare(`SELECT sec.id, sec.grade, sec.section, COUNT(st.id) AS students
    FROM sections sec JOIN students st ON st.section_id = sec.id AND st.status = 'active'
    WHERE sec.school_id = ? GROUP BY sec.id`).all(req.schoolId);
  sortSections(sections);
  res.json({
    school: req.schoolName,
    logo_url: req.schoolLogo,
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
    FROM students st WHERE st.section_id = @sec AND st.school_id = @school AND st.status = 'active' ORDER BY st.name`).all({ sec: secId, school: req.schoolId, date, period });
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
  const getStudent = db.prepare("SELECT id, section_id FROM students WHERE id = ? AND school_id = ? AND status = 'active'");
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
// بدون تخزين طويل: المتصفح يتحقق في كل زيارة (رد 304 خفيف إن لم يتغير شيء)،
// حتى تصل التحديثات للجوالات فوراً بعد النشر
app.use(express.static(pub, { index: false, extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
// الشعارات: الرابط يتغير مع كل رفع، لذلك تُخزّن في المتصفح طويلاً
app.get('/logos/:key', (req, res) => {
  const row = /^[\w-]{10,40}$/.test(req.params.key) && db.prepare('SELECT logo, logo_type FROM schools WHERE logo_key = ?').get(req.params.key);
  if (!row || !row.logo) return res.status(404).end();
  res.set({ 'Content-Type': row.logo_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
  res.send(row.logo);
});
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/owner', (req, res) => res.sendFile(path.join(pub, 'owner.html')));
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
