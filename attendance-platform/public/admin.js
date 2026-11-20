'use strict';
const A = '/api/admin';
let me = null;
let sections = [];

/* ---------- أدوات التاريخ ---------- */
function addDays(d, n) {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}
function rangeOf(kind) {
  const t = me.today;
  if (kind === 'week') return [addDays(t, -6), t];
  if (kind === 'month') return [t.slice(0, 8) + '01', t];
  return [t, t];
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

/* ---------- التبويبات ---------- */
const loaders = {};
function openTab(name) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  try { sessionStorage.setItem('tab', name); } catch { /* لا شيء */ }
  loaders[name] && loaders[name]();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => openTab(t.dataset.tab)));

/* ---------- البداية ---------- */
async function loadMe() {
  me = await api(`${A}/me`);
  $('#school-name').textContent = me.school.name;
  document.title = `لوحة المدير — ${me.school.name}`;
  const link = `${location.origin}/t/${me.school.teacher_token}`;
  $$('.teacher-link').forEach((c) => (c.textContent = link));
  $('#setup-hint').classList.toggle('hidden', me.counts.students > 0 && me.counts.teachers > 0);
  $('#ss-name').value = me.school.name;
  $('#ss-admin').value = me.school.admin_name;
  $('#ss-cc').value = me.school.country_code || '966';
}

async function loadSections() {
  sections = await api(`${A}/sections`);
  const grades = [...new Set(sections.map((s) => s.grade))];
  const gSel = $('#r-grade');
  const cur = gSel.value;
  gSel.innerHTML = '<option value="">الكل</option>' + grades.map((g) => `<option>${esc(g)}</option>`).join('');
  gSel.value = cur;
  fillSectionSelect();
  $('#grades-list').innerHTML = grades.map((g) => `<option value="${esc(g)}">`).join('');
  const fSel = $('#s-filter-section');
  const fc = fSel.value;
  fSel.innerHTML = '<option value="">كل الشعب</option>' + sections.map((s) => `<option value="${s.id}">${esc(s.grade)} / ${esc(s.section)}</option>`).join('');
  fSel.value = fc;
}
function fillSectionSelect() {
  const g = $('#r-grade').value;
  const sel = $('#r-section');
  sel.innerHTML = '<option value="">الكل</option>' + sections.filter((s) => !g || s.grade === g).map((s) => `<option value="${s.id}">${esc(s.section)}</option>`).join('');
}
$('#r-grade').addEventListener('change', fillSectionSelect);

$$('.copy-link').forEach((b) => b.addEventListener('click', async () => {
  const text = `${location.origin}/t/${me.school.teacher_token}`;
  try { await navigator.clipboard.writeText(text); toast('تم نسخ الرابط'); } catch { prompt('انسخ الرابط:', text); }
}));

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
});

/* ---------- الإحصائيات ---------- */
function bars(container, rows, labelFn) {
  const max = Math.max(1, ...rows.map((r) => r.absent + r.late + r.escape));
  container.innerHTML = rows.length ? rows.map((r) => {
    const tot = r.absent + r.late + r.escape;
    const seg = (k) => (r[k] ? `<span class="bar-seg ${k}" style="width:${(r[k] / max) * 100}%" title="${TYPE_LABEL[k]}: ${r[k]}"></span>` : '');
    return `<div class="bar-row"><span>${labelFn(r)}</span><span class="bar-track">${seg('absent')}${seg('late')}${seg('escape')}</span><span class="num">${tot}</span></div>`;
  }).join('') : '<p class="muted small">لا توجد بيانات في هذه الفترة</p>';
}

async function loadOverview() {
  const from = $('#o-from').value, to = $('#o-to').value;
  const d = await api(`${A}/stats?${qs({ from, to })}`);
  const t = d.totals;
  $('#o-totals').innerHTML = `
    <div class="card stat"><div class="stat-label">إجمالي الحالات</div><div class="stat-value num">${t.total || 0}</div></div>
    <div class="card stat absent"><div class="stat-label">غياب</div><div class="stat-value num">${t.absent || 0}</div></div>
    <div class="card stat late"><div class="stat-label">تأخير</div><div class="stat-value num">${t.late || 0}</div></div>
    <div class="card stat escape"><div class="stat-label">هروب</div><div class="stat-value num">${t.escape || 0}</div></div>`;
  bars($('#o-sections'), d.bySection.slice(0, 15), (r) => `${esc(r.grade)} / ${esc(r.section)}`);
  bars($('#o-periods'), d.byPeriod, (r) => `الحصة ${r.period}`);

  const topCard = (k, title) => `<div class="card"><h3 class="card-title">${title}</h3>${
    d.top[k].length ? `<div class="stack">${d.top[k].map((s, i) => `<div class="row between"><span><span class="muted num">${i + 1}.</span> ${esc(s.name)} <span class="muted small">${esc(s.grade)} / ${esc(s.section)}</span></span><span class="badge ${k}">${s[k]}</span></div>`).join('')}</div>` : '<p class="muted small">لا يوجد</p>'
  }</div>`;
  $('#o-top').innerHTML = topCard('absent', 'الأكثر غياباً') + topCard('late', 'الأكثر تأخراً') + topCard('escape', 'الأكثر هروباً');

  $('#o-students').innerHTML = d.students.length ? d.students.map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.grade)}</td><td>${esc(s.section)}</td><td class="num">${s.absent}</td><td class="num">${s.late}</td><td class="num">${s.escape}</td><td class="num"><strong>${s.total}</strong></td>
      <td>${guardianActions(s, from, to)}</td></tr>`).join('')
    : '<tr><td colspan="9" class="empty">لا توجد حالات مرصودة في هذه الفترة</td></tr>';
}
loaders.overview = () => loadOverview().catch((e) => toast(e.message));
$('#o-from').addEventListener('change', loaders.overview);
$('#o-to').addEventListener('change', loaders.overview);
$$('[data-range]').forEach((b) => b.addEventListener('click', () => {
  const [f, t] = rangeOf(b.dataset.range);
  $('#o-from').value = f;
  $('#o-to').value = t;
  loaders.overview();
}));
$('#o-xlsx').addEventListener('click', () => (location.href = `${A}/export.xlsx?${qs({ from: $('#o-from').value, to: $('#o-to').value })}`));
$('#o-letters').addEventListener('click', () => window.open(`/student-report?${qs({ from: $('#o-from').value, to: $('#o-to').value })}`, '_blank'));
$('#o-pdf').addEventListener('click', () => window.open(`/report?${qs({ from: $('#o-from').value, to: $('#o-to').value })}`, '_blank'));

/* ---------- أولياء الأمور ---------- */
const sentKey = (id, from, to) => `sent:${id}:${from}:${to}`;
function isSent(id, from, to) { try { return !!localStorage.getItem(sentKey(id, from, to)); } catch { return false; } }

function guardianActions(s, from, to) {
  const sent = isSent(s.id, from, to);
  const q = qs({ student_id: s.id, from, to });
  const msg = s.guardian_phone
    ? `<button class="btn btn-sm" data-wa="${s.id}" type="button">${sent ? '✓ أُرسل' : 'واتساب'}</button><button class="btn btn-ghost btn-sm" data-sms="${s.id}" type="button">SMS</button>`
    : `<button class="btn btn-ghost btn-sm" data-phone="${s.id}" data-phone-val="" type="button">+ رقم ولي الأمر</button>`;
  return `<div class="row" style="flex-wrap:nowrap;gap:4px">
    <a class="btn btn-ghost btn-sm" href="/student-report?${q}" target="_blank" rel="noopener">كشف</a>
    <a class="btn btn-ghost btn-sm" href="${A}/students/${s.id}/export.xlsx?${qs({ from, to })}">Excel</a>${msg}</div>`;
}

/* يجلب تفاصيل الطالب ثم يفتح واتساب/الرسائل بنص جاهز */
async function sendToGuardian(id, kind, from, to) {
  // تُفتح النافذة فوراً (قبل الانتظار) حتى لا يحجبها المتصفح
  const win = kind === 'wa' ? window.open('', '_blank') : null;
  try {
    const d = await api(`${A}/student-reports?${qs({ student_id: id, from, to })}`);
    const st = d.students[0];
    if (!st.guardian_phone) throw new Error('لا يوجد رقم لولي الأمر');
    const text = guardianMessage(d.school, d.from, d.to, st);
    if (kind === 'wa') win.location.href = whatsappUrl(st.guardian_phone, d.country_code, text);
    else location.href = smsUrl(st.guardian_phone, d.country_code, text);
    try { localStorage.setItem(sentKey(id, from, to), '1'); } catch { /* لا شيء */ }
    const b = document.querySelector(`[data-wa="${id}"]`);
    if (b) b.textContent = '✓ أُرسل';
  } catch (e) {
    if (win) win.close();
    toast(e.message);
  }
}

async function editPhone(id, current) {
  const v = prompt('رقم جوال ولي الأمر:', current || '');
  if (v === null) return false;
  await api(`${A}/students/${id}`, { method: 'PATCH', body: { guardian_phone: v.trim() } });
  toast('تم حفظ الرقم');
  return true;
}

$('#o-students').addEventListener('click', async (e) => {
  const from = $('#o-from').value, to = $('#o-to').value;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.wa) sendToGuardian(t.dataset.wa, 'wa', from, to);
  else if (t.dataset.sms) sendToGuardian(t.dataset.sms, 'sms', from, to);
  else if (t.dataset.phone && await editPhone(t.dataset.phone, '')) loaders.overview();
});

/* ---------- السجلات ---------- */
function recordQuery() {
  return qs({ from: $('#r-from').value, to: $('#r-to').value, grade: $('#r-grade').value, section_id: $('#r-section').value, type: $('#r-type').value, q: $('#r-q').value.trim() });
}
async function loadRecords() {
  const d = await api(`${A}/records?${recordQuery()}`);
  $('#r-count').textContent = `${d.records.length} سجل`;
  $('#r-body').innerHTML = d.records.length ? d.records.map((r) => `<tr>
      <td class="num">${r.date}</td><td class="num">${r.period_number}</td><td>${esc(r.student_name)}</td><td>${esc(r.grade)}</td><td>${esc(r.section)}</td>
      <td><span class="badge ${r.type}">${TYPE_LABEL[r.type]}</span></td><td>${esc(r.teacher_name || '—')}</td><td>${esc(r.note || '')}</td>
      <td><button class="btn btn-ghost btn-sm btn-danger" data-del-record="${r.id}" type="button">حذف</button></td></tr>`).join('')
    : '<tr><td colspan="9" class="empty">لا توجد سجلات مطابقة</td></tr>';
}
loaders.records = () => loadRecords().catch((e) => toast(e.message));
$('#r-apply').addEventListener('click', loaders.records);
$('#r-q').addEventListener('keydown', (e) => e.key === 'Enter' && loaders.records());
$('#r-xlsx').addEventListener('click', () => (location.href = `${A}/export.xlsx?${recordQuery()}`));
$('#r-pdf').addEventListener('click', () => window.open(`/report?${recordQuery()}`, '_blank'));
$('#r-body').addEventListener('click', async (e) => {
  const id = e.target.dataset.delRecord;
  if (!id || !confirm('حذف هذا السجل؟')) return;
  await api(`${A}/records/${id}`, { method: 'DELETE' });
  toast('تم الحذف');
  loaders.records();
});

/* ---------- الطلاب ---------- */
async function loadStudentsTab() {
  await loadSections();
  $('#s-sections').innerHTML = sections.length ? sections.map((s) => `<tr><td>${esc(s.grade)}</td><td>${esc(s.section)}</td><td class="num">${s.students}</td>
    <td><button class="btn btn-ghost btn-sm btn-danger" data-del-section="${s.id}" type="button">حذف</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">لم يتم رفع أي قائمة بعد</td></tr>';
  await loadStudentList();
}
async function loadStudentList() {
  const list = await api(`${A}/students?${qs({ section_id: $('#s-filter-section').value, q: $('#s-q').value.trim() })}`);
  $('#s-list').innerHTML = list.length ? list.map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.grade)}</td><td>${esc(s.section)}</td>
    <td class="num">${esc(s.student_no || '')}</td><td class="num"><bdi>${esc(s.guardian_phone || '')}</bdi></td>
    <td><div class="row" style="flex-wrap:nowrap;gap:4px">
      <a class="btn btn-ghost btn-sm" href="/student-report?${qs({ student_id: s.id, from: me.today.slice(0, 8) + '01', to: me.today })}" target="_blank" rel="noopener">كشف</a>
      <button class="btn btn-ghost btn-sm" data-edit-phone="${s.id}" data-phone-val="${esc(s.guardian_phone || '')}" type="button">الجوال</button>
      <button class="btn btn-ghost btn-sm btn-danger" data-del-student="${s.id}" type="button">حذف</button></div></td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">لا يوجد طلاب</td></tr>';
}
loaders.students = () => loadStudentsTab().catch((e) => toast(e.message));
$('#s-filter-section').addEventListener('change', () => loadStudentList());
let sqTimer;
$('#s-q').addEventListener('input', () => { clearTimeout(sqTimer); sqTimer = setTimeout(loadStudentList, 250); });

$('#s-upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (fd.get('mode') === 'replace' && !confirm('سيتم حذف جميع الطلاب الحاليين وسجلاتهم. هل أنت متأكد؟')) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const r = await api(`${A}/students/upload`, { method: 'POST', form: fd });
    toast(`تمت إضافة ${r.added} طالب${r.skipped ? ` (تم تجاهل ${r.skipped} مكرر)` : ''} — ${r.sections} شعبة`);
    e.target.reset();
    await loadMe();
    loaders.students();
  } catch (ex) { toast(ex.message); } finally { btn.disabled = false; }
});
$('#s-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`${A}/students`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast('تمت الإضافة');
    e.target.reset();
    await loadMe();
    loaders.students();
  } catch (ex) { toast(ex.message); }
});
document.addEventListener('click', async (e) => {
  const sid = e.target.dataset.delStudent, secId = e.target.dataset.delSection;
  if (e.target.dataset.editPhone) {
    try { if (await editPhone(e.target.dataset.editPhone, e.target.dataset.phoneVal)) loadStudentList(); } catch (ex) { toast(ex.message); }
    return;
  }
  if (sid && confirm('حذف الطالب وجميع سجلاته؟')) {
    await api(`${A}/students/${sid}`, { method: 'DELETE' });
    toast('تم الحذف');
    loaders.students();
  }
  if (secId && confirm('حذف الشعبة وجميع طلابها وسجلاتهم؟')) {
    await api(`${A}/sections/${secId}`, { method: 'DELETE' });
    toast('تم الحذف');
    loaders.students();
  }
});

/* ---------- المعلمون ---------- */
async function loadTeachers() {
  const list = await api(`${A}/teachers`);
  $('#t-list').innerHTML = list.length ? list.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.name)}</td><td>${esc(t.subject || '')}</td>
    <td class="num" dir="ltr">${esc(t.phone || '')}</td><td class="num">${t.records}</td>
    <td><button class="btn btn-ghost btn-sm btn-danger" data-del-teacher="${t.id}" type="button">حذف</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">لا يوجد معلمون</td></tr>';
}
loaders.teachers = () => loadTeachers().catch((e) => toast(e.message));
$('#t-upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const r = await api(`${A}/teachers/upload`, { method: 'POST', form: new FormData(e.target) });
    toast(`تمت إضافة ${r.added} معلم${r.skipped ? ` (تم تجاهل ${r.skipped} مكرر)` : ''}`);
    e.target.reset();
    await loadMe();
    loaders.teachers();
  } catch (ex) { toast(ex.message); } finally { btn.disabled = false; }
});
$('#t-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`${A}/teachers`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast('تمت الإضافة');
    e.target.reset();
    await loadMe();
    loaders.teachers();
  } catch (ex) { toast(ex.message); }
});
$('#t-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.delTeacher;
  if (!id || !confirm('حذف المعلم؟ (تبقى سجلاته محفوظة باسمه)')) return;
  await api(`${A}/teachers/${id}`, { method: 'DELETE' });
  toast('تم الحذف');
  loaders.teachers();
});

/* ---------- الحصص ---------- */
let periods = [];
function renderPeriods() {
  $('#p-count').value = periods.length;
  $('#p-list').innerHTML = periods.map((p, i) => `<div class="inline-fields">
      <div class="field" style="flex:0 0 80px"><label>الحصة</label><p class="num" style="min-height:44px;display:flex;align-items:center;font-weight:700">${i + 1}</p></div>
      <div class="field"><label for="ps-${i}">من</label><input id="ps-${i}" type="time" data-i="${i}" data-k="start_time" value="${p.start_time || ''}"></div>
      <div class="field"><label for="pe-${i}">إلى</label><input id="pe-${i}" type="time" data-i="${i}" data-k="end_time" value="${p.end_time || ''}"></div>
    </div>`).join('');
}
loaders.periods = async () => {
  periods = await api(`${A}/periods`);
  renderPeriods();
};
$('#p-count').addEventListener('change', (e) => {
  const n = Math.max(1, Math.min(12, Number(e.target.value) || 1));
  while (periods.length < n) periods.push({ start_time: '', end_time: '' });
  periods.length = n;
  renderPeriods();
});
$('#p-list').addEventListener('change', (e) => {
  const { i, k } = e.target.dataset;
  if (i !== undefined) periods[i][k] = e.target.value;
});
$('#p-save').addEventListener('click', async () => {
  try {
    await api(`${A}/periods`, { method: 'PUT', body: { periods } });
    toast('تم حفظ الحصص');
  } catch (ex) { toast(ex.message); }
});

/* ---------- الإعدادات ---------- */
$('#rotate').addEventListener('click', async () => {
  if (!confirm('سيتوقف الرابط الحالي عن العمل، وستحتاج إرسال الرابط الجديد لجميع المعلمين. متابعة؟')) return;
  await api(`${A}/rotate-link`, { method: 'POST' });
  await loadMe();
  toast('تم إنشاء رابط جديد');
});
$('#set-school').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`${A}/settings`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    await loadMe();
    toast('تم الحفظ');
  } catch (ex) { toast(ex.message); }
});
$('#set-pass').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`${A}/password`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('تم تغيير كلمة المرور');
  } catch (ex) { toast(ex.message); }
});

/* ---------- تشغيل ---------- */
(async () => {
  try {
    await loadMe();
  } catch (e) {
    if (e.status === 401) return location.replace('/');
    return toast(e.message);
  }
  const [f, t] = rangeOf('month');
  $('#o-from').value = f; $('#o-to').value = t;
  $('#r-from').value = me.today; $('#r-to').value = me.today;
  await loadSections().catch(() => {});
  let tab = 'overview';
  try { tab = sessionStorage.getItem('tab') || tab; } catch { /* لا شيء */ }
  openTab(tab);
})();
