'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
process.env.DATA_DIR = tmp;
const app = require('../src/server');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body, isForm) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let payload;
    if (isForm) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  };
}

/** تسجيل مدرسة ثم تفعيلها (كما يفعل مالك المنصة) ثم الدخول */
async function register(c, body) {
  const r = await c('POST', '/api/register', body);
  if (r.status !== 200) return r;
  require('../src/db').prepare("UPDATE schools SET status = 'active' WHERE email = ?").run(body.email.toLowerCase());
  await c('POST', '/api/login', { email: body.email, password: body.password });
  return r;
}

async function studentsXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.addRow(['اسم الطالب', 'الصف', 'الشعبة']);
  rows.forEach((r) => ws.addRow(r));
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'students.xlsx');
  fd.append('mode', 'append');
  return fd;
}

test('دورة كاملة: تسجيل، رفع، رصد، إحصاء، تصدير، وعزل المدارس', async () => {
  const a = client();
  const b = client();

  assert.equal((await register(a, { schoolName: 'مدرسة أ', adminName: 'مدير أ', email: 'a@x.com', password: 'password1' })).status, 200);
  assert.equal((await register(b, { schoolName: 'مدرسة ب', adminName: 'مدير ب', email: 'b@x.com', password: 'password2' })).status, 200);
  assert.equal((await register(b, { schoolName: 'x', adminName: 'y', email: 'A@x.com', password: 'password3' })).status, 409);

  // رفع الطلاب
  const up = await a('POST', '/api/admin/students/upload', await studentsXlsx([
    ['أحمد علي', 'الأول', '1'], ['سعيد محمد', 'الأول', '1'], ['خالد عمر', 'الأول', '2'], ['فهد ناصر', 'الثاني', '1'], ['أحمد علي', 'الأول', '1'],
  ]), true);
  assert.equal(up.status, 200);
  assert.deepEqual(up.data, { added: 4, skipped: 1, sections: 3 });

  // رفع المعلمين بصيغة CSV
  const fd = new FormData();
  fd.append('file', new Blob(['﻿اسم المعلم,المادة\nأ. سالم,رياضيات\n']), 't.csv');
  const tu = await a('POST', '/api/admin/teachers/upload', fd, true);
  assert.equal(tu.status, 200, JSON.stringify(tu.data));
  assert.equal(tu.data.added, 1);

  const me = (await a('GET', '/api/admin/me')).data;
  const token = me.school.teacher_token;
  const t = client();
  const info = (await t('GET', `/api/t/${token}/info`)).data;
  assert.equal(info.school, 'مدرسة أ');
  assert.equal(info.periods.length, 7);
  assert.equal(info.sections.length, 3);

  const sec = info.sections.find((s) => s.grade === 'الأول' && s.section === '1');
  const list = (await t('GET', `/api/t/${token}/sections/${sec.id}/students?period=2`)).data;
  assert.equal(list.students.length, 2);

  const st = list.students[0];
  assert.equal((await t('PUT', `/api/t/${token}/mark`, { student_id: st.id, period: 2, type: 'late', teacher_id: info.teachers[0].id })).status, 200);
  assert.equal((await t('PUT', `/api/t/${token}/mark`, { student_id: st.id, period: 2, type: 'absent' })).status, 200); // تعديل
  assert.equal((await t('PUT', `/api/t/${token}/mark`, { student_id: list.students[1].id, period: 3, type: 'escape' })).status, 200);
  assert.equal((await t('PUT', `/api/t/${token}/mark`, { student_id: st.id, period: 99, type: 'late' })).status, 400);

  // رصد مجمّع في طلب واحد + إلغاء + رفض تاريخ قديم
  const batch = await t('POST', `/api/t/${token}/marks`, { teacher_id: info.teachers[0].id, items: [
    { student_id: st.id, period: 4, type: 'late' },
    { student_id: list.students[1].id, period: 4, type: 'absent' },
    { student_id: list.students[1].id, period: 4, type: null },
    { student_id: st.id, period: 5, type: 'late', date: '2000-01-01' },
  ] });
  assert.equal(batch.status, 200);
  assert.equal(batch.data.saved, 3);
  assert.equal(batch.data.results[3].reason, 'stale');

  // كشف الطالب لولي الأمر
  await a('PATCH', `/api/admin/students/${st.id}`, { guardian_phone: '0551234567' });
  const rep = (await a('GET', `/api/admin/student-reports?student_id=${st.id}`)).data;
  assert.equal(rep.students[0].totals.absent, 1);
  assert.equal(rep.students[0].totals.late, 1);
  assert.equal(rep.students[0].guardian_phone, '0551234567');
  assert.equal(rep.country_code, '966');
  const all = (await a('GET', '/api/admin/student-reports')).data;
  assert.equal(all.students.length, 2);
  const sx = await a('GET', `/api/admin/students/${st.id}/export.xlsx`);
  assert.equal(sx.status, 200);
  await t('POST', `/api/t/${token}/marks`, { items: [{ student_id: st.id, period: 4, type: null }] });

  const stats = (await a('GET', '/api/admin/stats')).data;
  assert.equal(stats.totals.total, 2);
  assert.equal(stats.totals.absent, 1);
  assert.equal(stats.totals.escape, 1);

  const xlsx = await a('GET', '/api/admin/export.xlsx');
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.data);
  assert.equal(wb.worksheets[0].rowCount, 3);

  // ---- العزل ----
  const bInfo = (await b('GET', '/api/admin/me')).data;
  assert.equal(bInfo.counts.students, 0);
  assert.equal((await b('GET', '/api/admin/stats')).data.totals.total, 0);
  assert.equal((await b('GET', '/api/admin/students')).data.length, 0);
  // مدير ب لا يستطيع حذف طالب من مدرسة أ
  await b('DELETE', `/api/admin/students/${st.id}`);
  assert.equal((await a('GET', '/api/admin/students')).data.length, 4);
  // رابط مدرسة ب لا يصل لطلاب مدرسة أ
  const tb = bInfo.school.teacher_token;
  assert.equal((await t('GET', `/api/t/${tb}/sections/${sec.id}/students?period=1`)).status, 404);
  assert.equal((await t('PUT', `/api/t/${tb}/mark`, { student_id: st.id, period: 1, type: 'late' })).status, 404);
  // بدون تسجيل دخول
  assert.equal((await client()('GET', '/api/admin/students')).status, 401);
  assert.equal((await t('GET', '/api/t/invalid-token-123456789/info')).status, 404);

  assert.equal((await b('GET', `/api/admin/student-reports?student_id=${st.id}`)).data.students.length, 0);
  assert.equal((await b('GET', `/api/admin/students/${st.id}/export.xlsx`)).status, 404);
  assert.equal((await b('PATCH', `/api/admin/students/${st.id}`, { guardian_phone: '1' })).status, 404);
  assert.equal((await t('POST', `/api/t/${tb}/marks`, { items: [{ student_id: st.id, period: 1, type: 'late' }] })).data.saved, 0);

  // تغيير الرابط يوقف القديم
  await a('POST', '/api/admin/rotate-link');
  assert.equal((await t('GET', `/api/t/${token}/info`)).status, 404);

  // دخول خاطئ
  assert.equal((await client()('POST', '/api/login', { email: 'a@x.com', password: 'wrong-pass' })).status, 401);
  assert.equal((await client()('POST', '/api/login', { email: 'a@x.com', password: 'password1' })).status, 200);
});

test('الصفوف الرقمية: توحيد الأرقام، الترتيب الطبيعي، وعمود «11/1»', async () => {
  const a = client();
  await register(a, { schoolName: 'ج', adminName: 'م', email: 'c@x.com', password: 'password1' });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.addRow(['الاسم', 'الصف', 'الشعبة']);
  [['أ', '11', '1'], ['ب', '١١', '٢'], ['ج', 'الصف 11', 'الشعبة 10'], ['د', '9', '1'], ['هـ', '10', '1']].forEach((r) => ws.addRow(r));
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 's.xlsx');
  const up = await a('POST', '/api/admin/students/upload', fd, true);
  assert.equal(up.data.sections, 5);
  const secs = (await a('GET', '/api/admin/sections')).data.map((s) => `${s.grade}/${s.section}`);
  assert.deepEqual(secs, ['9/1', '10/1', '11/1', '11/2', '11/10']);

  // عمود واحد «الصف/الشعبة»
  const fd2 = new FormData();
  fd2.append('file', new Blob(['الاسم,الصف\nو,12/3\nز,١٢-٤\n']), 's.csv');
  const up2 = await a('POST', '/api/admin/students/upload', fd2, true);
  assert.equal(up2.data.added, 2);
  const secs2 = (await a('GET', '/api/admin/sections')).data.map((s) => `${s.grade}/${s.section}`);
  assert.ok(secs2.includes('12/3') && secs2.includes('12/4'));
});

test('إدارة الطلاب: نقل، انقطاع، انتقال، مزامنة القائمة، ودمج الشعب', async () => {
  const a = client();
  await register(a, { schoolName: 'د', adminName: 'م', email: 'd@x.com', password: 'password1' });
  const csv = (text) => { const fd = new FormData(); fd.append('file', new Blob([text]), 's.csv'); return fd; };
  const up = (text, extra = {}) => { const fd = csv(text); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return a('POST', '/api/admin/students/upload', fd, true); };

  await up('الاسم,الصف,الشعبة,رقم الطالب\nسعد,11,1,1\nفهد,11,1,2\nماجد,11,2,3\nنواف,11,2,4\n');
  const students = (await a('GET', '/api/admin/students')).data;
  const id = (n) => students.find((s) => s.name === n).id;
  const token = (await a('GET', '/api/admin/me')).data.school.teacher_token;
  const t = client();

  // نقل سعد إلى 11/2
  assert.equal((await a('PATCH', `/api/admin/students/${id('سعد')}`, { grade: '11', section: '2', note: 'طلب ولي الأمر' })).status, 200);
  // فهد منقطع
  await a('PATCH', `/api/admin/students/${id('فهد')}`, { status: 'withdrawn', note: 'انقطاع' });
  const secs = (await a('GET', '/api/admin/sections')).data;
  assert.deepEqual(secs.map((s) => [s.section, s.students, s.inactive]), [['1', 0, 1], ['2', 3, 0]]);

  // المعلم لا يرى المنقطع ولا يستطيع رصده
  const info = (await t('GET', `/api/t/${token}/info`)).data;
  assert.equal(info.sections.length, 1); // الشعبة 1 لم يعد فيها طلاب نشطون
  const r = await t('POST', `/api/t/${token}/marks`, { items: [{ student_id: id('فهد'), period: 1, type: 'absent' }] });
  assert.equal(r.data.saved, 0);

  const detail = (await a('GET', `/api/admin/students/${id('سعد')}`)).data;
  assert.equal(detail.events[0].kind, 'move');
  assert.equal(detail.events[0].from_text, 'الصف 11 / شعبة 1');

  // جماعي: ماجد ونواف منتقلان من المدرسة
  const bulk = await a('POST', '/api/admin/students/bulk', { ids: [id('ماجد'), id('نواف')], action: 'status', status: 'transferred' });
  assert.equal(bulk.data.changed, 2);
  const counts = (await a('GET', '/api/admin/students/counts')).data;
  assert.deepEqual(counts, { active: 1, withdrawn: 1, transferred: 2 });

  // مزامنة: سعد ينتقل إلى 12/1، ماجد يعود، طالب جديد، ونواف غير موجود
  const file = 'الاسم,الصف,الشعبة,رقم الطالب\nسعد,12,1,1\nماجد,11,2,3\nريان,12,1,9\nفهد,11,1,2\n';
  const prev = (await up(file, { mode: 'sync', dry_run: '1' })).data;
  assert.equal(prev.preview, true);
  assert.deepEqual([prev.summary.moved, prev.summary.reactivated, prev.summary.added, prev.summary.missing], [1, 2, 1, 0]);
  const ap = (await up(file, { mode: 'sync', missing_action: 'withdrawn' })).data;
  assert.equal(ap.applied, true);
  const after = (await a('GET', '/api/admin/students?status=all')).data;
  const by = (n) => after.find((s) => s.name === n);
  assert.equal(`${by('سعد').grade}/${by('سعد').section}`, '12/1');
  assert.equal(by('ماجد').status, 'active');
  assert.equal(by('فهد').status, 'active');
  assert.equal(by('نواف').status, 'transferred');
  assert.ok(by('ريان'));

  // مزامنة ثانية بدون ريان: يصبح منقطعاً
  const ap2 = (await up('الاسم,الصف,الشعبة\nسعد,12,1\nماجد,11,2\nفهد,11,1\n', { mode: 'sync', missing_action: 'withdrawn' })).data;
  assert.equal(ap2.summary.missing, 1);
  assert.equal((await a('GET', '/api/admin/students?status=withdrawn')).data[0].name, 'ريان');

  // دمج الشعب: إعادة تسمية 11/1 إلى 11/2 تدمجهما
  const s111 = (await a('GET', '/api/admin/sections')).data.find((s) => s.grade === '11' && s.section === '1');
  const m = await a('PATCH', `/api/admin/sections/${s111.id}`, { grade: '11', section: '2' });
  assert.equal(m.data.merged, true);
  assert.equal((await a('GET', '/api/admin/sections')).data.filter((s) => s.grade === '11').length, 1);
});

test('النموذج التجاري: طلب اشتراك، تفعيل المالك، الإيقاف، انتهاء الاشتراك، وكلمة المرور المؤقتة', async () => {
  const { createOwner } = require('../src/owner');
  const school = client();
  const owner = client();
  const t = client();

  // طلب اشتراك: لا دخول قبل التفعيل
  const reg = await school('POST', '/api/register', { schoolName: 'هـ', adminName: 'م', email: 'h@x.com', password: 'password1', contactPhone: '91234567' });
  assert.equal(reg.data.pending, true);
  const denied = await school('POST', '/api/login', { email: 'h@x.com', password: 'password1' });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'pending');

  // المالك: كلمة مؤقتة يجب تغييرها أولاً
  const pass = createOwner('owner@x.com', 'المالك');
  assert.equal((await owner('POST', '/api/owner/login', { email: 'owner@x.com', password: pass })).data.must_change_password, true);
  assert.equal((await owner('GET', '/api/owner/schools')).status, 403);
  assert.equal((await owner('PUT', '/api/owner/password', { current: pass, next: 'short' })).status, 400);
  assert.equal((await owner('PUT', '/api/owner/password', { current: pass, next: 'a-strong-pass-123' })).status, 200);
  assert.equal((await client()('GET', '/api/owner/schools')).status, 401);
  // مدير مدرسة لا يصل للوحة المالك
  assert.equal((await school('GET', '/api/owner/schools')).status, 401);

  const list = (await owner('GET', '/api/owner/schools')).data;
  const sc = list.schools.find((x) => x.email === 'h@x.com');
  assert.equal(sc.status, 'pending');
  assert.ok(list.summary.pending >= 1);

  // تفعيل لمدة سنة
  await owner('PATCH', `/api/owner/schools/${sc.id}`, { status: 'active', extend_months: 12 });
  assert.equal((await school('POST', '/api/login', { email: 'h@x.com', password: 'password1' })).status, 200);
  const me = (await school('GET', '/api/admin/me')).data;
  assert.ok(me.subscription.days_left >= 360);
  const token = me.school.teacher_token;
  assert.equal((await t('GET', `/api/t/${token}/info`)).status, 200);

  // إيقاف: المدير والمعلمون يُمنعون
  await owner('PATCH', `/api/owner/schools/${sc.id}`, { status: 'suspended' });
  assert.equal((await school('GET', '/api/admin/me')).status, 403);
  assert.equal((await t('GET', `/api/t/${token}/info`)).status, 403);

  // انتهاء الاشتراك
  await owner('PATCH', `/api/owner/schools/${sc.id}`, { status: 'active', subscription_end: '2020-01-01' });
  const exp = await school('GET', '/api/admin/me');
  assert.equal(exp.status, 403);
  assert.equal(exp.data.code, 'expired');
  // التمديد من اليوم عند الانتهاء
  await owner('PATCH', `/api/owner/schools/${sc.id}`, { extend_months: 1 });
  assert.equal((await school('GET', '/api/admin/me')).status, 200);

  // المالك ينشئ مدرسة بكلمة مؤقتة: المدير يجب أن يغيّرها
  const created = (await owner('POST', '/api/owner/schools', { name: 'و', admin_name: 'م', email: 'w@x.com', contact_phone: '9', plan: 'سنوية', extend_months: 12 })).data;
  const w = client();
  assert.equal((await w('POST', '/api/login', { email: 'w@x.com', password: created.temp_password })).status, 200);
  assert.equal((await w('GET', '/api/admin/me')).data.school.must_change_password, 1);
  assert.equal((await w('GET', '/api/admin/students')).status, 403);
  await w('PUT', '/api/admin/password', { current: created.temp_password, next: 'newpass123' });
  assert.equal((await w('GET', '/api/admin/students')).status, 200);

  // إعادة تعيين كلمة المرور تُنهي الجلسات
  const rs = (await owner('POST', `/api/owner/schools/${created.id}/reset-password`)).data;
  assert.equal((await w('GET', '/api/admin/me')).status, 401);
  assert.ok(rs.temp_password.length >= 10);

  // الحذف يتطلب الاسم
  assert.equal((await owner('DELETE', `/api/owner/schools/${created.id}`, { confirm_name: 'خطأ' })).status, 400);
  assert.equal((await owner('DELETE', `/api/owner/schools/${created.id}`, { confirm_name: 'و' })).status, 200);
});
