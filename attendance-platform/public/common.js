'use strict';
/* أدوات مشتركة */
const TYPE_LABEL = { absent: 'غياب', late: 'تأخير', escape: 'هروب' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch { /* لا شيء */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'تعذر الاتصال بالخادم');
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function fmtDate(d, short) {
  try {
    const opts = short ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', opts).format(new Date(d + 'T12:00:00'));
  } catch { return d; }
}

/* تطبيع البحث العربي: تجاهل الهمزات والتاء المربوطة والألف المقصورة والتشكيل */
function normAr(s) {
  return String(s || '').toLowerCase()
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

/* ---------- التواصل مع ولي الأمر ---------- */
function normalizePhone(raw, cc = '966') {
  let d = String(raw || '')
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
    .replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (d.length <= 9) d = cc + d;
  return d;
}

function guardianMessage(school, from, to, st) {
  const t = st.totals;
  const lines = [
    `السلام عليكم ورحمة الله،`,
    `ولي أمر الطالب: ${st.name} (${gradeLabel(st.grade)} - ${sectionLabel(st.section)})`,
    ``,
    `نفيدكم من ${school} بملخص حضور ابنكم ${from === to ? `بتاريخ ${from}` : `في الفترة من ${from} إلى ${to}`}:`,
    `• الغياب: ${t.absent} حصة${st.absentDays ? ` (في ${st.absentDays} يوم)` : ''}`,
    `• التأخير: ${t.late}`,
    `• الهروب: ${t.escape}`,
  ];
  if (st.records && st.records.length) {
    lines.push('', 'التفاصيل:');
    const max = 20;
    st.records.slice(0, max).forEach((r) => lines.push(`- ${r.date} الحصة ${r.period_number}: ${TYPE_LABEL[r.type]}`));
    if (st.records.length > max) lines.push(`… و${st.records.length - max} حالات أخرى`);
  }
  lines.push('', 'نأمل منكم المتابعة والتواصل مع المدرسة.', `إدارة ${school}`);
  return lines.join('\n');
}

function whatsappUrl(phone, cc, text) {
  const p = normalizePhone(phone, cc);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function smsUrl(phone, cc, text) {
  return `sms:+${normalizePhone(phone, cc)}?&body=${encodeURIComponent(text)}`;
}

/* «11» → «الصف 11»، والأسماء النصية مثل «الأول المتوسط» تبقى كما هي */
function gradeLabel(g) { return /^\d+$/.test(String(g)) ? `الصف ${g}` : String(g); }
function sectionLabel(s) { return `شعبة ${s}`; }
