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

  assert.equal((await a('POST', '/api/register', { schoolName: 'مدرسة أ', adminName: 'مدير أ', email: 'a@x.com', password: 'password1' })).status, 200);
  assert.equal((await b('POST', '/api/register', { schoolName: 'مدرسة ب', adminName: 'مدير ب', email: 'b@x.com', password: 'password2' })).status, 200);
  assert.equal((await b('POST', '/api/register', { schoolName: 'x', adminName: 'y', email: 'A@x.com', password: 'password3' })).status, 409);

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
