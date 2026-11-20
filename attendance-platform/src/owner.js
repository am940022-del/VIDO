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

const SESSION_HOURS = 12;
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

function ownerRouter({ today, str, HttpError, wrap, newToken, cookieSecure, newSchool, addMonths }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات كثيرة، حاول لاحقاً' } });
  const cookie = { httpOnly: true, sameSite: 'strict', secure: cookieSecure, path: '/', maxAge: SESSION_HOURS * 3600e3 };

  r.post('/login', limiter, wrap(async (req, res) => {
    const email = str(req.body.email, 150).toLowerCase();
    const a = db.prepare('SELECT * FROM platform_admins WHERE email = ?').get(email);
    const ok = a && (await bcrypt.compare(String(req.body.password || ''), a.password_hash));
    if (!ok) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
    const token = newToken(32);
    db.prepare('DELETE FROM owner_sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO owner_sessions (token, admin_id, expires_at) VALUES (?,?,?)').run(token, a.id, Date.now() + SESSION_HOURS * 3600e3);
    res.cookie('osid', token, cookie);
    res.json({ ok: true, must_change_password: !!a.must_change_password });
  }));

  r.post('/logout', (req, res) => {
    if (req.cookies.osid) db.prepare('DELETE FROM owner_sessions WHERE token = ?').run(req.cookies.osid);
    res.clearCookie('osid', { path: '/' });
    res.json({ ok: true });
  });

  // ---- كل ما بعده يتطلب جلسة المالك ----
  r.use((req, res, next) => {
    const row = req.cookies.osid && db.prepare(`SELECT s.admin_id, s.expires_at, a.must_change_password, a.email, a.name
      FROM owner_sessions s JOIN platform_admins a ON a.id = s.admin_id WHERE s.token = ?`).get(req.cookies.osid);
    if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    req.owner = row;
    // كلمة المرور المؤقتة يجب تغييرها قبل أي شيء آخر
    if (row.must_change_password && !['/me', '/password'].includes(req.path)) {
      return res.status(403).json({ error: 'غيّر كلمة المرور المؤقتة أولاً', code: 'must_change_password' });
    }
    next();
  });

  r.get('/me', (req, res) => res.json({ email: req.owner.email, name: req.owner.name, must_change_password: !!req.owner.must_change_password, today: today(), country_code: String(process.env.DEFAULT_COUNTRY_CODE || '966').replace(/\D/g, '') }));

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

module.exports = { ownerRouter, schoolAccess, createOwner, tempPassword };
