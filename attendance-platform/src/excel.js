'use strict';
const ExcelJS = require('exceljs');
const { readXls, isXls } = require('./xls');

/* ---------- قراءة الملفات المرفوعة (xlsx / csv) ---------- */

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

function clean(s) {
  return cellText(s).replace(/\s+/g, ' ').trim();
}

/* توحيد الأرقام العربية (١١ → 11) */
function latinDigits(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
}

/* الصفوف بالكلمات كما في ملفات الوزارة: «الثاني عشر» ← 12 */
const ORDINALS = [
  ['الحادي عشر', 11], ['الثاني عشر', 12], ['الاول', 1], ['الثاني', 2], ['الثالث', 3], ['الرابع', 4], ['الخامس', 5],
  ['السادس', 6], ['السابع', 7], ['الثامن', 8], ['التاسع', 9], ['العاشر', 10],
];
const plainAr = (s) => clean(s).replace(/[أإآ]/g, 'ا').replace(/ـ/g, '').replace(/\s+/g, ' ');
function ordinalGrade(text) {
  const t = plainAr(text);
  for (const [w, n] of ORDINALS) if (t === w || t === `ال${w.replace(/^ال/, '')}`) return String(n);
  return null;
}

/* «الصف 11» و«١١» و«11» و«الصف الحادي عشر» تصبح كلها «11»، والصفوف مثل «الأول المتوسط» تبقى كما هي */
function normGrade(g) {
  let v = latinDigits(clean(g)).replace(/^(ال)?صف\s*[:\-]?\s*/, '').trim();
  return ordinalGrade(v) || v || latinDigits(clean(g));
}

/* الصف من سطر عنوان مثل «بيانات الطالب الأساسية للصف الثاني عشر» أو «قائمة طلاب الصف 11» */
function gradeFromTitle(rows, beforeRow) {
  for (let r = Math.min(beforeRow, rows.length) - 1; r >= 0; r--) {
    for (const cell of rows[r]) {
      const m = latinDigits(plainAr(cell)).match(/(?:لل|ال)صف\s+(.+)$/);
      if (!m) continue;
      const rest = m[1].trim();
      const num = rest.match(/^(\d{1,2})\b/);
      if (num) return num[1];
      for (const [w, n] of ORDINALS) if (rest.startsWith(w)) return String(n);
    }
  }
  return null;
}
function normSection(s) {
  let v = latinDigits(clean(s)).replace(/^(ال)?(شعبه|شعبة|فصل)\s*[:\-]?\s*/, '').trim();
  return v || latinDigits(clean(s));
}

/* «11/1» أو «11-1» أو «11 / 2» في عمود واحد → صف وشعبة */
function splitGradeSection(v) {
  const m = latinDigits(clean(v)).match(/^(.*?)\s*[\/\\\-–]\s*([^\/\\\-–]+)$/);
  return m ? { grade: normGrade(m[1]), section: normSection(m[2]) } : null;
}

function normalizeHeader(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/* بعض الأنظمة تصدّر جدول HTML باسم .xls */
function readHtmlTable(text) {
  const rows = [];
  const dec = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
  // العناوين قبل الجدول (مثل «بيانات الطلاب للصف العاشر») كسطور مستقلة
  const before = text.split(/<table/i)[0].replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  for (const line of dec(before.replace(/<\/(p|div|h\d|tr|br)>|<br\s*\/?>/gi, '\n')).split('\n')) {
    if (clean(line)) rows.push([clean(line)]);
  }
  for (const tr of text.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    rows.push((tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => clean(dec(c))));
  }
  return rows;
}

async function readRows(buffer, filename) {
  const lower = (filename || '').toLowerCase();
  let raw = null;
  if (isXls(buffer)) raw = readXls(buffer);
  else if (/^\s*</.test(buffer.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, ''))) raw = readHtmlTable(buffer.toString('utf8'));
  if (raw) return raw.map((r) => r.map(clean)).filter((r) => r.some((v) => v !== ''));

  const wb = new ExcelJS.Workbook();
  if (lower.endsWith('.csv')) {
    const { Readable } = require('stream');
    // إزالة BOM إن وجد
    let text = buffer.toString('utf8').replace(/^﻿/, '');
    await wb.csv.read(Readable.from([text]));
  } else {
    await wb.xlsx.load(buffer);
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = clean(cell.value);
    });
    for (let i = 0; i < vals.length; i++) if (vals[i] === undefined) vals[i] = '';
    if (vals.some((v) => v !== '')) rows.push(vals);
  });
  return rows;
}

/**
 * يبحث عن صف العناوين ويحدد رقم كل عمود حسب الكلمات المفتاحية.
 * fields: { key: [aliases...] }
 */
function mapColumns(rows, fields, required, minFields = 1) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const headers = rows[r].map(normalizeHeader);
    const map = {};
    for (const [key, aliases] of Object.entries(fields)) {
      const normAliases = aliases.map(normalizeHeader);
      // تطابق تام أولاً ثم تطابق جزئي
      let idx = headers.findIndex((h) => normAliases.includes(h));
      if (idx === -1) idx = headers.findIndex((h) => h && normAliases.some((a) => h.includes(a)));
      if (idx !== -1 && !Object.values(map).includes(idx)) map[key] = idx;
    }
    if (required.every((k) => map[k] !== undefined) && Object.keys(map).length >= minFields) return { headerRow: r, map };
  }
  return null;
}

const STUDENT_FIELDS = {
  name: ['اسم الطالب', 'الاسم', 'اسم', 'name', 'student name', 'student'],
  grade: ['الصف', 'صف', 'المرحله', 'grade', 'class'],
  section: ['الشعبه', 'شعبه', 'الفصل', 'فصل', 'section', 'division'],
  student_no: ['رقم الطالب', 'الرقم المدرسي', 'الرقم المدني', 'رقم الهويه', 'السجل المدني', 'الرقم', 'id', 'student id', 'number'],
  guardian_phone: ['جوال ولي الامر', 'رقم ولي الامر', 'ولي الامر', 'الجوال', 'جوال', 'هاتف', 'phone', 'mobile'],
};

const TEACHER_FIELDS = {
  name: ['اسم المعلم', 'اسم المعلمه', 'الاسم', 'اسم', 'name', 'teacher'],
  subject: ['الماده', 'ماده', 'التخصص', 'subject'],
  phone: ['الجوال', 'جوال', 'رقم الجوال', 'هاتف', 'phone', 'mobile'],
};

/**
 * defaults: { grade, section } تُستخدم إن لم يحدد الملف الصف أو الشعبة
 * (مثل ملفات الوزارة التي تذكر الصف في العنوان فقط).
 */
async function parseStudents(buffer, filename, defaults = {}) {
  const rows = await readRows(buffer, filename);
  const found = mapColumns(rows, STUDENT_FIELDS, ['name'], 2);
  if (!found) {
    throw new Error('لم يتم العثور على عمود «اسم الطالب» مع الصف أو الشعبة. استخدم القالب المرفق، أو أضف الأسماء يدوياً.');
  }
  const { headerRow, map } = found;
  const titleGrade = map.grade === undefined ? gradeFromTitle(rows, headerRow) : null;
  const defGrade = normGrade(defaults.grade || '');
  const defSection = normSection(defaults.section || '');
  if (map.grade === undefined && !titleGrade && !defGrade) {
    throw new Error('لم يُعرف الصف من الملف. اختر الصف في نموذج الرفع ثم أعد المحاولة.');
  }
  if (map.section === undefined && !defSection && map.grade === undefined) {
    throw new Error('لم تُعرف الشعبة من الملف. اختر الشعبة في نموذج الرفع ثم أعد المحاولة.');
  }
  const out = [];
  for (const row of rows.slice(headerRow + 1)) {
    const get = (k) => (map[k] === undefined ? '' : clean(row[map[k]]));
    const name = get('name');
    // تجاهل تكرار صف العناوين في الصفحات التالية من التقرير
    if (!name || plainAr(name) === plainAr(rows[headerRow][map.name])) continue;
    let grade = normGrade(get('grade')) || titleGrade || defGrade;
    let section = normSection(get('section')) || defSection;
    // بدون عمود شعبة: نقبل «11/1» في عمود الصف
    if (!section) {
      const sp = splitGradeSection(get('grade'));
      if (sp) ({ grade, section } = sp);
    }
    if (!name || !grade || !section) continue;
    out.push({
      name: name.slice(0, 200),
      grade: grade.slice(0, 60),
      section: section.slice(0, 30),
      student_no: get('student_no').slice(0, 40) || null,
      guardian_phone: get('guardian_phone').slice(0, 30) || null,
    });
  }
  return out;
}

async function parseTeachers(buffer, filename) {
  const rows = await readRows(buffer, filename);
  const found = mapColumns(rows, TEACHER_FIELDS, ['name']);
  if (!found) throw new Error('لم يتم العثور على عمود "اسم المعلم". استخدم القالب المرفق.');
  const { headerRow, map } = found;
  const out = [];
  for (const row of rows.slice(headerRow + 1)) {
    const get = (k) => (map[k] === undefined ? '' : clean(row[map[k]]));
    const name = get('name');
    if (!name) continue;
    out.push({
      name: name.slice(0, 200),
      subject: get('subject').slice(0, 80) || null,
      phone: get('phone').slice(0, 30) || null,
    });
  }
  return out;
}

/* ---------- إنشاء ملفات Excel ---------- */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };

function styleSheet(ws, widths) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  ws.columns.forEach((c, i) => (c.width = widths[i] || 16));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 24;
}

async function templateStudents() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الطلاب');
  ws.addRow(['اسم الطالب', 'الصف', 'الشعبة', 'رقم الطالب', 'جوال ولي الأمر']);
  ws.addRow(['محمد أحمد علي', '10', '1', '1001', '0500000000']);
  ws.addRow(['خالد سعيد عمر', '11', '1', '1002', '']);
  ws.addRow(['عبدالله فهد ناصر', '11', '2', '1003', '']);
  ws.addRow(['سالم علي حسن', '11', '3', '1004', '']);
  styleSheet(ws, [30, 20, 10, 16, 18]);
  return wb.xlsx.writeBuffer();
}

async function templateTeachers() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المعلمون');
  ws.addRow(['اسم المعلم', 'المادة', 'الجوال']);
  ws.addRow(['أ. سالم محمد', 'الرياضيات', '0500000000']);
  ws.addRow(['أ. فيصل علي', 'العلوم', '']);
  styleSheet(ws, [30, 20, 18]);
  return wb.xlsx.writeBuffer();
}

const TYPE_LABEL = { absent: 'غياب', late: 'تأخير', escape: 'هروب' };

async function exportRecords({ schoolName, from, to, records, summary }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = schoolName;

  const ws = wb.addWorksheet('السجل');
  ws.addRow(['التاريخ', 'الحصة', 'اسم الطالب', 'الصف', 'الشعبة', 'الحالة', 'المعلم', 'ملاحظة']);
  for (const r of records) {
    ws.addRow([r.date, r.period_number, r.student_name, r.grade, r.section, TYPE_LABEL[r.type], r.teacher_name || '', r.note || '']);
  }
  styleSheet(ws, [14, 8, 30, 18, 10, 10, 22, 30]);
  ws.autoFilter = { from: 'A1', to: 'H1' };
  const colors = { غياب: 'FFFEE2E2', تأخير: 'FFFEF3C7', هروب: 'FFEDE9FE' };
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const c = row.getCell(6);
    if (colors[c.value]) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors[c.value] } };
  });

  const ws2 = wb.addWorksheet('ملخص الطلاب');
  ws2.addRow(['اسم الطالب', 'الصف', 'الشعبة', 'غياب', 'تأخير', 'هروب', 'المجموع']);
  for (const s of summary) {
    ws2.addRow([s.name, s.grade, s.section, s.absent, s.late, s.escape, s.total]);
  }
  styleSheet(ws2, [30, 18, 10, 10, 10, 10, 10]);

  const ws3 = wb.addWorksheet('معلومات');
  ws3.views = [{ rightToLeft: true }];
  ws3.addRow(['المدرسة', schoolName]);
  ws3.addRow(['من تاريخ', from]);
  ws3.addRow(['إلى تاريخ', to]);
  ws3.addRow(['عدد السجلات', records.length]);
  ws3.getColumn(1).width = 16;
  ws3.getColumn(2).width = 40;
  ws3.getColumn(1).font = { bold: true };

  return wb.xlsx.writeBuffer();
}

async function exportStudent(data, st) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('كشف الطالب');
  ws.views = [{ rightToLeft: true }];
  const info = [
    ['المدرسة', data.school], ['اسم الطالب', st.name], ['الصف', st.grade], ['الشعبة', st.section],
    ['رقم الطالب', st.student_no || ''], ['الفترة', `${data.from} إلى ${data.to}`],
    ['عدد حصص الغياب', st.totals.absent], ['أيام الغياب', st.absentDays], ['التأخير', st.totals.late], ['الهروب', st.totals.escape],
  ];
  info.forEach((r) => ws.addRow(r));
  ws.getColumn(1).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(['التاريخ', 'الحصة', 'الحالة', 'المعلم', 'ملاحظة']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = HEADER_FILL));
  for (const r of st.records) ws.addRow([r.date, r.period_number, TYPE_LABEL[r.type], r.teacher_name || '', r.note || '']);
  [18, 30, 10, 22, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return wb.xlsx.writeBuffer();
}

module.exports = { readRows, gradeFromTitle, normGrade, normSection, latinDigits, exportStudent, parseStudents, parseTeachers, templateStudents, templateTeachers, exportRecords, TYPE_LABEL };
