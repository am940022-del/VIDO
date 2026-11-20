'use strict';
const ExcelJS = require('exceljs');

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

function normalizeHeader(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

async function readRows(buffer, filename) {
  const wb = new ExcelJS.Workbook();
  const lower = (filename || '').toLowerCase();
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
function mapColumns(rows, fields, required) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const headers = rows[r].map(normalizeHeader);
    const map = {};
    for (const [key, aliases] of Object.entries(fields)) {
      const normAliases = aliases.map(normalizeHeader);
      // تطابق تام أولاً ثم تطابق جزئي
      let idx = headers.findIndex((h) => normAliases.includes(h));
      if (idx === -1) idx = headers.findIndex((h) => h && normAliases.some((a) => h.includes(a)));
      if (idx !== -1 && !Object.values(map).includes(idx)) map[key] = idx;
    }
    if (required.every((k) => map[k] !== undefined)) return { headerRow: r, map };
  }
  return null;
}

const STUDENT_FIELDS = {
  name: ['اسم الطالب', 'الاسم', 'اسم', 'name', 'student name', 'student'],
  grade: ['الصف', 'صف', 'المرحله', 'grade', 'class'],
  section: ['الشعبه', 'شعبه', 'الفصل', 'فصل', 'section', 'division'],
  student_no: ['رقم الطالب', 'رقم الهويه', 'السجل المدني', 'الرقم', 'id', 'student id', 'number'],
  guardian_phone: ['جوال ولي الامر', 'رقم ولي الامر', 'ولي الامر', 'الجوال', 'جوال', 'هاتف', 'phone', 'mobile'],
};

const TEACHER_FIELDS = {
  name: ['اسم المعلم', 'اسم المعلمه', 'الاسم', 'اسم', 'name', 'teacher'],
  subject: ['الماده', 'ماده', 'التخصص', 'subject'],
  phone: ['الجوال', 'جوال', 'رقم الجوال', 'هاتف', 'phone', 'mobile'],
};

async function parseStudents(buffer, filename) {
  const rows = await readRows(buffer, filename);
  const found = mapColumns(rows, STUDENT_FIELDS, ['name', 'grade', 'section']);
  if (!found) {
    throw new Error('لم يتم العثور على الأعمدة المطلوبة: الاسم، الصف، الشعبة. استخدم القالب المرفق.');
  }
  const { headerRow, map } = found;
  const out = [];
  for (const row of rows.slice(headerRow + 1)) {
    const get = (k) => (map[k] === undefined ? '' : clean(row[map[k]]));
    const name = get('name');
    const grade = get('grade');
    const section = get('section');
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
  ws.addRow(['محمد أحمد علي', 'الأول المتوسط', '1', '1001', '0500000000']);
  ws.addRow(['خالد سعيد عمر', 'الأول المتوسط', '2', '1002', '']);
  ws.addRow(['عبدالله فهد ناصر', 'الثاني المتوسط', '1', '1003', '']);
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

module.exports = { parseStudents, parseTeachers, templateStudents, templateTeachers, exportRecords, TYPE_LABEL };
