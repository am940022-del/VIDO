'use strict';
/*
 * لوحة مالك المنصة (/owner): المدارس واشتراكاتها.
 * - تفعيل طلبات الاشتراك، الإيقاف، تمديد الاشتراك، الباقة والملاحظات.
 * - إنشاء مدرسة مباشرة وإعادة تعيين كلمة مرور مديرها (كلمة مؤقتة يغيّرها المدير عند أول دخول).
 * - المالك يرى أرقاماً مجمّعة فقط، ولا يرى بيانات الطلاب.
 */
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const totp = require('./totp');
const QRCode = require('qrcode');

const SESSION_HOURS = 12;
const PENDING_MINUTES = 5;   // مهلة إدخال رمز التحقق بعد كلمة المرور
const MAX_CODE_ATTEMPTS = 5;
const STATUSES = ['pending', 'active', 'suspended'];

function tempPassword() {
  // سهلة القراءة والإملاء بالهاتف: بدون 0/O و1/l
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(12), (b) => abc[b % abc.length]).join('');
}

/** هل يُسمح للمدرسة بالدخول؟ يُستخدم لدخول المدير ولرابط المعلمين */
function schoolAccess(school, today) {
  if (!school) return { ok: false, code: 'missing', message: 'الحساب غير موجود' };
  if (school.status === 'pending') return { ok: false, code: 'pending', message: 'طلب اشتراك المدرسة قيد المراجعة من إدارة المنصة. سيتم تفعيله قريباً.' };
  if (school.status === 'suspended') return { ok: false, code: 'suspended', message: 'تم إيقاف حساب المدرسة. تواصل مع إدارة المنصة.' };
  if (school.subscription_end && school.subscription_end < today) {
    return { ok: false, code: 'expired', message: `انتهى اشتراك المدرسة بتاريخ ${school.subscription_end}. تواصل مع إدارة المنصة للتجديد.` };
  }
  return { ok: true };
}

/** ينشئ مالك المنصة أو يعيد تعيين كلمة مروره؛ يعيد كلمة مرور مؤقتة */
function createOwner(email, name) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('بريد غير صحيح');
  const pass = tempPassword();
  const hash = bcrypt.hashSync(pass, 11);
  const ex = db.prepare('SELECT id FROM platform_admins WHERE email = ?').get(email);
  if (ex) {
    db.prepare('UPDATE platform_admins SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, ex.id);
    db.prepare('DELETE FROM owner_sessions WHERE admin_id = ?').run(ex.id);
  } else {
    db.prepare('INSERT INTO platform_admins (email, name, password_hash) VALUES (?,?,?)').run(email, name || 'مالك المنصة', hash);
  }
  return pass;
}

/** عند فقدان الجوال: يعطّل التحقق بخطوتين، ويُطلب إعداده من جديد عند الدخول التالي */
function resetOwner2fa(email) {
  const a = db.prepare('SELECT id FROM platform_admins WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!a) throw new Error('لا يوجد مالك بهذا البريد');
  db.prepare("UPDATE platform_admins SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0, recovery_codes = '[]' WHERE id = ?").run(a.id);
  db.prepare('DELETE FROM owner_sessions WHERE admin_id = ?').run(a.id);
}

function ownerRouter({ today, str, HttpError, wrap, newToken, cookieSecure, newSchool, addMonths }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.OWNER_RATE_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات كثيرة، حاول لاحقاً' } });
  const cookie = { httpOnly: true, sameSite: 'strict', secure: cookieSecure, path: '/', maxAge: SESSION_HOURS * 3600e3 };

  r.post('/login', limiter, wrap(async (req, res) => {
    const email = str(req.body.email, 150).toLowerCase();
    const a = db.prepare('SELECT * FROM platform_admins WHERE email = ?').get(email);
    const ok = a && (await bcrypt.compare(String(req.body.password || ''), a.password_hash));
    if (!ok) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
    const token = newToken(32);
    db.prepare('DELETE FROM owner_sessions WHERE expires_at < ?').run(Date.now());
    const need2fa = !!a.totp_enabled;
    // مع التحقق بخطوتين: جلسة مؤقتة قصيرة لا تفتح شيئاً حتى يُدخل الرمز
    const exp = Date.now() + (need2fa ? PENDING_MINUTES * 60e3 : SESSION_HOURS * 3600e3);
    db.prepare('INSERT INTO owner_sessions (token, admin_id, expires_at, verified) VALUES (?,?,?,?)').run(token, a.id, exp, need2fa ? 0 : 1);
    res.cookie('osid', token, cookie);
    res.json({ ok: true, need_2fa: need2fa, must_change_password: !!a.must_change_password });
  }));

  /** الخطوة الثانية: رمز التطبيق (6 أرقام) أو رمز استرداد */
  r.post('/login/2fa', limiter, (req, res) => {
    const s = req.cookies.osid && db.prepare('SELECT * FROM owner_sessions WHERE token = ?').get(req.cookies.osid);
    if (!s || s.expires_at < Date.now() || s.verified) throw new HttpError(401, 'انتهت المهلة، سجّل الدخول من جديد');
    const a = db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(s.admin_id);
    const code = String(req.body.code || '').trim();
    let ok = false;
    const step = totp.verify(a.totp_secret, code, a.totp_last_step);
    if (step !== null) {
      db.prepare('UPDATE platform_admins SET totp_last_step = ? WHERE id = ?').run(step, a.id);
      ok = true;
    } else if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) { // ليس رمز تطبيق: جرّب رموز الاسترداد
      const codes = JSON.parse(a.recovery_codes || '[]');
      const h = totp.hashCode(code);
      if (codes.includes(h)) {
        db.prepare('UPDATE platform_admins SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.filter((x) => x !== h)), a.id);
        ok = true;
      }
    }
    if (!ok) {
      const failed = s.failed + 1;
      if (failed >= MAX_CODE_ATTEMPTS) {
        db.prepare('DELETE FROM owner_sessions WHERE token = ?').run(s.token);
        throw new HttpError(401, 'محاولات خاطئة كثيرة، سجّل الدخول من جديد');
      }
      db.prepare('UPDATE owner_sessions SET failed = ? WHERE token = ?').run(failed, s.token);
      throw new HttpError(400, 'الرمز غير صحيح');
    }
    // جلسة جديدة بعد التحقق (رمز مختلف عن جلسة الانتظار)
    const token = newToken(32);
    db.prepare('DELETE FROM owner_sessions WHERE token = ?').run(s.token);
    db.prepare('INSERT INTO owner_sessions (token, admin_id, expires_at, verified) VALUES (?,?,?,1)').run(token, a.id, Date.now() + SESSION_HOURS * 3600e3);
    res.cookie('osid', token, cookie);
    res.json({ ok: true, must_change_password: !!a.must_change_password });
  });

  r.post('/logout', (req, res) => {
    if (req.cookies.osid) db.prepare('DELETE FROM owner_sessions WHERE token = ?').run(req.cookies.osid);
    res.clearCookie('osid', { path: '/' });
    res.json({ ok: true });
  });

  // ---- كل ما بعده يتطلب جلسة المالك ----
  r.use((req, res, next) => {
    const row = req.cookies.osid && db.prepare(`SELECT s.admin_id, s.expires_at, s.verified, a.must_change_password, a.totp_enabled,
        a.recovery_codes, a.email, a.name
      FROM owner_sessions s JOIN platform_admins a ON a.id = s.admin_id WHERE s.token = ?`).get(req.cookies.osid);
    if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    if (!row.verified) return res.status(401).json({ error: 'أدخل رمز التحقق', code: 'need_2fa' });
    req.owner = row;
    // 1) كلمة المرور المؤقتة تُغيّر أولاً  2) ثم إعداد التحقق بخطوتين (إلزامي) قبل الوصول للمدارس
    if (row.must_change_password && !['/me', '/password'].includes(req.path)) {
      return res.status(403).json({ error: 'غيّر كلمة المرور المؤقتة أولاً', code: 'must_change_password' });
    }
    if (!row.must_change_password && !row.totp_enabled && !['/me', '/password', '/2fa/setup', '/2fa/enable'].includes(req.path)) {
      return res.status(403).json({ error: 'فعّل التحقق بخطوتين أولاً', code: 'need_2fa_setup' });
    }
    next();
  });

  r.get('/me', (req, res) => res.json({ email: req.owner.email, name: req.owner.name, must_change_password: !!req.owner.must_change_password, totp_enabled: !!req.owner.totp_enabled, recovery_left: JSON.parse(req.owner.recovery_codes || '[]').length, today: today(), country_code: String(process.env.DEFAULT_COUNTRY_CODE || '966').replace(/\D/g, '') }));

  /** إعداد التحقق بخطوتين: سر جديد + رمز QR لمسحه بتطبيق المصادقة */
  r.post('/2fa/setup', wrap(async (req, res) => {
    if (req.owner.totp_enabled) throw new HttpError(400, 'التحقق بخطوتين مفعّل مسبقاً');
    const secret = totp.generateSecret();
    db.prepare('UPDATE platform_admins SET totp_secret = ? WHERE id = ?').run(secret, req.owner.admin_id);
    const url = totp.otpauthUrl(secret, req.owner.email, process.env.PLATFORM_NAME || 'Attendance Platform');
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ secret: secret.match(/.{1,4}/g).join(' '), otpauth: url, qr_svg: qr });
  }));

  function issueRecovery(adminId) {
    const codes = totp.recoveryCodes(10);
    db.prepare('UPDATE platform_admins SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.map(totp.hashCode)), adminId);
    return codes;
  }

  r.post('/2fa/enable', (req, res) => {
    const a = db.prepare('SELECT totp_secret, totp_enabled FROM platform_admins WHERE id = ?').get(req.owner.admin_id);
    if (a.totp_enabled) throw new HttpError(400, 'التحقق بخطوتين مفعّل مسبقاً');
    const step = totp.verify(a.totp_secret, req.body.code, 0);
    if (step === null) throw new HttpError(400, 'الرمز غير صحيح. تأكد من وقت الجوال وأدخل الرمز الحالي.');
    db.prepare('UPDATE platform_admins SET totp_enabled = 1, totp_last_step = ? WHERE id = ?').run(step, req.owner.admin_id);
    // الجلسات الأخرى (إن وُجدت) تُغلق
    db.prepare('DELETE FROM owner_sessions WHERE admin_id = ? AND token != ?').run(req.owner.admin_id, req.cookies.osid);
    res.json({ ok: true, recovery_codes: issueRecovery(req.owner.admin_id) });
  });

  /** رموز استرداد جديدة (تُلغي القديمة) — تتطلب رمزاً حالياً من التطبيق */
  r.post('/2fa/recovery', (req, res) => {
    const a = db.prepare('SELECT totp_secret, totp_last_step FROM platform_admins WHERE id = ?').get(req.owner.admin_id);
    const step = totp.verify(a.totp_secret, req.body.code, a.totp_last_step);
    if (step === null) throw new HttpError(400, 'الرمز غير صحيح');
    db.prepare('UPDATE platform_admins SET totp_last_step = ? WHERE id = ?').run(step, req.owner.admin_id);
    res.json({ ok: true, recovery_codes: issueRecovery(req.owner.admin_id) });
  });

  r.put('/password', wrap(async (req, res) => {
    const a = db.prepare('SELECT password_hash FROM platform_admins WHERE id = ?').get(req.owner.admin_id);
    if (!(await bcrypt.compare(String(req.body.current || ''), a.password_hash))) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
    const next = String(req.body.next || '');
    if (next.length < 10) throw new HttpError(400, 'كلمة المرور الجديدة 10 أحرف على الأقل');
    db.prepare('UPDATE platform_admins SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(await bcrypt.hash(next, 11), req.owner.admin_id);
    db.prepare('DELETE FROM owner_sessions WHERE admin_id = ? AND token != ?').run(req.owner.admin_id, req.cookies.osid);
    res.json({ ok: true });
  }));

  r.get('/schools', (req, res) => {
    const t = today();
    const since = addMonths(t, -1);
    const rows = db.prepare(`SELECT s.id, s.name, s.admin_name, s.email, s.contact_phone, s.status, s.plan, s.subscription_end,
        s.owner_notes, s.created_at, s.approved_at,
        (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'active') AS students,
        (SELECT COUNT(*) FROM teachers te WHERE te.school_id = s.id) AS teachers,
        (SELECT COUNT(*) FROM records r WHERE r.school_id = s.id AND r.date >= @since) AS records_30d,
        (SELECT MAX(r.date) FROM records r WHERE r.school_id = s.id) AS last_activity
      FROM schools s ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, s.created_at DESC`).all({ since });
    for (const s of rows) {
      const a = schoolAccess(s, t);
      s.access = a.ok ? 'ok' : a.code;
      s.days_left = s.subscription_end ? Math.round((new Date(s.subscription_end) - new Date(t)) / 864e5) : null;
    }
    const summary = {
      total: rows.length,
      active: rows.filter((s) => s.access === 'ok').length,
      pending: rows.filter((s) => s.status === 'pending').length,
      suspended: rows.filter((s) => s.status === 'suspended').length,
      expired: rows.filter((s) => s.access === 'expired').length,
      expiring: rows.filter((s) => s.access === 'ok' && s.days_left !== null && s.days_left <= 14).length,
      students: rows.reduce((n, s) => n + s.students, 0),
    };
    res.json({ today: t, summary, schools: rows });
  });

  /** إنشاء مدرسة مباشرة (مفعّلة) مع كلمة مرور مؤقتة للمدير */
  r.post('/schools', wrap(async (req, res) => {
    const pass = tempPassword();
    const id = await newSchool({
      schoolName: str(req.body.name, 150),
      adminName: str(req.body.admin_name, 100),
      email: str(req.body.email, 150).toLowerCase(),
      password: pass,
      contactPhone: str(req.body.contact_phone, 30),
      status: 'active',
      mustChange: true,
    });
    applyUpdate(id, req.body);
    res.json({ ok: true, id, temp_password: pass });
  }));

  function applyUpdate(id, b) {
    const s = db.prepare('SELECT * FROM schools WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'المدرسة غير موجودة');
    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw new HttpError(400, 'حالة غير صحيحة');
      db.prepare('UPDATE schools SET status = ?, approved_at = COALESCE(approved_at, CASE WHEN ? = \'active\' THEN datetime(\'now\') END) WHERE id = ?').run(b.status, b.status, id);
    }
    if (b.subscription_end !== undefined) {
      if (b.subscription_end !== null && b.subscription_end !== '' && !isDate(b.subscription_end)) throw new HttpError(400, 'تاريخ غير صحيح');
      db.prepare('UPDATE schools SET subscription_end = ? WHERE id = ?').run(b.subscription_end || null, id);
    }
    if (b.extend_months !== undefined) {
      const m = Number(b.extend_months);
      if (!Number.isInteger(m) || m < 1 || m > 60) throw new HttpError(400, 'مدة غير صحيحة');
      const t = today();
      const cur = db.prepare('SELECT subscription_end FROM schools WHERE id = ?').get(id).subscription_end;
      const base = cur && cur > t ? cur : t; // التمديد من نهاية الاشتراك الحالي، أو من اليوم إن كان منتهياً
      db.prepare('UPDATE schools SET subscription_end = ? WHERE id = ?').run(addMonths(base, m), id);
    }
    if (b.plan !== undefined) db.prepare('UPDATE schools SET plan = ? WHERE id = ?').run(str(b.plan, 60) || null, id);
    if (b.owner_notes !== undefined) db.prepare('UPDATE schools SET owner_notes = ? WHERE id = ?').run(str(b.owner_notes, 1000) || null, id);
    if (b.contact_phone !== undefined) db.prepare('UPDATE schools SET contact_phone = ? WHERE id = ?').run(str(b.contact_phone, 30) || null, id);
  }

  r.patch('/schools/:id', (req, res) => {
    applyUpdate(Number(req.params.id), req.body);
    res.json({ ok: true });
  });

  /** كلمة مرور مؤقتة جديدة لمدير المدرسة (عند نسيانها) */
  r.post('/schools/:id/reset-password', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM schools WHERE id = ?').get(id)) throw new HttpError(404, 'المدرسة غير موجودة');
    const pass = tempPassword();
    db.prepare('UPDATE schools SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(await bcrypt.hash(pass, 11), id);
    db.prepare('DELETE FROM sessions WHERE school_id = ?').run(id);
    res.json({ ok: true, temp_password: pass });
  }));

  /** حذف نهائي: يتطلب كتابة اسم المدرسة للتأكيد */
  r.delete('/schools/:id', (req, res) => {
    const s = db.prepare('SELECT name FROM schools WHERE id = ?').get(Number(req.params.id));
    if (!s) throw new HttpError(404, 'المدرسة غير موجودة');
    if (str(req.body.confirm_name, 150) !== s.name) throw new HttpError(400, 'اكتب اسم المدرسة كما هو للتأكيد');
    db.prepare('DELETE FROM schools WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}

module.exports = { ownerRouter, schoolAccess, createOwner, resetOwner2fa, tempPassword };
