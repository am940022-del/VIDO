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
  renderSubscription();
}

/* ---------- الاشتراك ---------- */
function supportButtons(sp) {
  if (!sp) return '';
  return (sp.whatsapp ? `<a class="btn btn-primary" href="https://wa.me/${esc(sp.whatsapp)}" target="_blank" rel="noopener">تواصل عبر واتساب</a>` : '') +
    (sp.email ? `<a class="btn" href="mailto:${esc(sp.email)}">${esc(sp.email)}</a>` : '');
}
function renderSubscription() {
  const sub = me.subscription || {};
  const info = [sub.plan ? `الباقة: ${esc(sub.plan)}` : '', sub.end ? `ينتهي الاشتراك في <bdi>${esc(sub.end)}</bdi>` : 'اشتراك مفتوح بدون تاريخ انتهاء']
    .filter(Boolean).join(' · ');
  $('#sub-info').innerHTML = info;
  const b = $('#sub-banner');
  if (sub.days_left !== null && sub.days_left !== undefined && sub.days_left <= 14) {
    b.className = 'alert alert-error';
    b.innerHTML = `${sub.days_left <= 0 ? 'ينتهي اشتراك المدرسة اليوم' : `يتبقى ${sub.days_left} يوماً على انتهاء اشتراك المدرسة`} (<bdi>${esc(sub.end)}</bdi>). تواصل مع إدارة المنصة للتجديد حتى لا يتوقف الرصد. ${supportButtons(me.support)}`;
  } else {
    b.className = 'alert hidden';
  }
}

function showBlocked(e) {
  $$('[data-panel], nav, #setup-hint, #sub-banner').forEach((el) => el.classList.add('hidden'));
  $('#blocked-msg').textContent = e.message;
  $('#blocked-support').innerHTML = supportButtons(e.data && e.data.support);
  $('#blocked').classList.remove('hidden');
}

function forcePasswordChange() {
  return new Promise((resolve) => {
    const dlg = $('#pw-dialog');
    dlg.addEventListener('cancel', (ev) => ev.preventDefault()); // لا يُغلق قبل التغيير
    $('#pw-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api(`${A}/password`, { method: 'PUT', body: Object.fromEntries(new FormData(ev.target)) });
        dlg.close();
        toast('تم تغيير كلمة المرور');
        resolve();
      } catch (ex) {
        $('#pw-error').textContent = ex.message;
        $('#pw-error').classList.remove('hidden');
      }
    });
    dlg.showModal();
  });
}

async function loadSections() {
  sections = await api(`${A}/sections`);
  const grades = [...new Set(sections.map((s) => s.grade))];
  const gSel = $('#r-grade');
  const cur = gSel.value;
  gSel.innerHTML = '<option value="">الكل</option>' + grades.map((g) => `<option value="${esc(g)}">${esc(gradeLabel(g))}</option>`).join('');
  gSel.value = cur;
  fillSectionSelect();
  $('#grades-list').innerHTML = grades.map((g) => `<option value="${esc(g)}">`).join('');
  const fSel = $('#s-filter-section');
  const fc = fSel.value;
  fSel.innerHTML = '<option value="">كل الشعب</option>' + sections.map((s) => `<option value="${s.id}">${esc(gradeLabel(s.grade))} / ${esc(s.section)}</option>`).join('');
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
  bars($('#o-sections'), d.bySection.slice(0, 15), (r) => `${esc(gradeLabel(r.grade))} / ${esc(r.section)}`);
  bars($('#o-periods'), d.byPeriod, (r) => `الحصة ${r.period}`);

  const topCard = (k, title) => `<div class="card"><h3 class="card-title">${title}</h3>${
    d.top[k].length ? `<div class="stack">${d.top[k].map((s, i) => `<div class="row between"><span><span class="muted num">${i + 1}.</span> ${esc(s.name)} <span class="muted small">${esc(gradeLabel(s.grade))} / ${esc(s.section)}</span></span><span class="badge ${k}">${s[k]}</span></div>`).join('')}</div>` : '<p class="muted small">لا يوجد</p>'
  }</div>`;
  $('#o-top').innerHTML = topCard('absent', 'الأكثر غياباً') + topCard('late', 'الأكثر تأخراً') + topCard('escape', 'الأكثر هروباً');

  $('#o-students').innerHTML = d.students.length ? d.students.map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.name)}${s.status && s.status !== 'active' ? ` <span class="badge ${s.status}">${STATUS_LABEL[s.status]}</span>` : ''}</td><td>${esc(gradeLabel(s.grade))}</td><td>${esc(s.section)}</td><td class="num">${s.absent}</td><td class="num">${s.late}</td><td class="num">${s.escape}</td><td class="num"><strong>${s.total}</strong></td>
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
      <td class="num">${r.date}</td><td class="num">${r.period_number}</td><td>${esc(r.student_name)}</td><td>${esc(gradeLabel(r.grade))}</td><td>${esc(r.section)}</td>
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
const STATUS_LABEL = { active: 'نشط', withdrawn: 'منقطع', transferred: 'منتقل من المدرسة' };
const EVENT_LABEL = { move: 'نقل', withdrawn: 'انقطاع', transferred: 'انتقال من المدرسة', reactivated: 'إعادة تفعيل', created: 'إضافة' };
const selected = new Set();
let studentRows = [];
const secOptions = () => sections.map((s) => `<option value="${s.id}">${esc(gradeLabel(s.grade))} / شعبة ${esc(s.section)}</option>`).join('');

async function loadStudentsTab() {
  await loadSections();
  $('#s-sections').innerHTML = sections.length ? sections.map((s) => `<tr><td>${esc(gradeLabel(s.grade))}</td><td>${esc(s.section)}</td><td class="num">${s.students}</td>
    <td class="num muted">${s.inactive || ''}</td>
    <td><div class="row" style="flex-wrap:nowrap;gap:4px">
      <button class="btn btn-ghost btn-sm" data-edit-section="${s.id}" type="button">تعديل</button>
      <button class="btn btn-ghost btn-sm btn-danger" data-del-section="${s.id}" type="button">حذف</button></div></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">لم يتم رفع أي قائمة بعد</td></tr>';
  $('#s-bulk-section').innerHTML = '<option value="">نقل إلى شعبة…</option>' + secOptions();
  const counts = await api(`${A}/students/counts`);
  const sel = $('#s-status');
  for (const o of sel.options) {
    const base = { active: 'النشطون', withdrawn: 'المنقطعون', transferred: 'المنتقلون من المدرسة', all: 'الكل' }[o.value];
    const n = o.value === 'all' ? counts.active + counts.withdrawn + counts.transferred : counts[o.value];
    o.textContent = `${base} (${n})`;
  }
  await loadStudentList();
}

async function loadStudentList() {
  studentRows = await api(`${A}/students?${qs({ section_id: $('#s-filter-section').value, q: $('#s-q').value.trim(), status: $('#s-status').value })}`);
  for (const id of [...selected]) if (!studentRows.some((s) => s.id === id)) selected.delete(id);
  const from = me.today.slice(0, 8) + '01';
  $('#s-list').innerHTML = studentRows.length ? studentRows.map((s, i) => `<tr class="${s.status !== 'active' ? 'inactive' : ''} ${selected.has(s.id) ? 'selected' : ''}" data-sid="${s.id}">
    <td><input type="checkbox" class="check" data-pick="${s.id}" ${selected.has(s.id) ? 'checked' : ''} aria-label="تحديد ${esc(s.name)}"></td>
    <td class="num">${i + 1}</td>
    <td>${esc(s.name)} ${s.status !== 'active' ? `<span class="badge ${s.status}" title="${esc(s.status_note || '')}">${STATUS_LABEL[s.status]}${s.status_date ? ` · <bdi>${esc(s.status_date)}</bdi>` : ''}</span>` : ''}</td>
    <td>${esc(gradeLabel(s.grade))}</td><td>${esc(s.section)}</td>
    <td class="num">${esc(s.student_no || '')}</td><td class="num"><bdi>${esc(s.guardian_phone || '')}</bdi></td>
    <td><div class="row" style="flex-wrap:nowrap;gap:4px">
      <button class="btn btn-sm" data-edit-student="${s.id}" type="button">تعديل / نقل</button>
      <a class="btn btn-ghost btn-sm" href="/student-report?${qs({ student_id: s.id, from, to: me.today })}" target="_blank" rel="noopener">كشف</a>
      <button class="btn btn-ghost btn-sm btn-danger" data-del-student="${s.id}" type="button">حذف</button></div></td></tr>`).join('')
    : '<tr><td colspan="8" class="empty">لا يوجد طلاب</td></tr>';
  updateBulk();
}

function updateBulk() {
  $('#s-bulk').classList.toggle('hidden', !selected.size);
  $('#s-bulk-count').textContent = `${selected.size} طالب محدد`;
  $('#s-all').checked = studentRows.length > 0 && studentRows.every((s) => selected.has(s.id));
}

loaders.students = () => loadStudentsTab().catch((e) => toast(e.message));
$('#s-filter-section').addEventListener('change', () => loadStudentList());
$('#s-status').addEventListener('change', () => { selected.clear(); loadStudentList(); });
let sqTimer;
$('#s-q').addEventListener('input', () => { clearTimeout(sqTimer); sqTimer = setTimeout(loadStudentList, 250); });

$('#s-list').addEventListener('change', (e) => {
  const id = Number(e.target.dataset.pick);
  if (!id) return;
  e.target.checked ? selected.add(id) : selected.delete(id);
  e.target.closest('tr').classList.toggle('selected', e.target.checked);
  updateBulk();
});
$('#s-all').addEventListener('change', (e) => {
  studentRows.forEach((s) => (e.target.checked ? selected.add(s.id) : selected.delete(s.id)));
  loadStudentList();
});
$('#s-bulk-clear').addEventListener('click', () => { selected.clear(); loadStudentList(); });
$$('[data-bulk]').forEach((b) => b.addEventListener('click', async () => {
  const action = b.dataset.bulk;
  const body = { ids: [...selected] };
  if (action === 'move') {
    body.action = 'move';
    body.section_id = $('#s-bulk-section').value;
    if (!body.section_id) return toast('اختر الشعبة المراد النقل إليها');
  } else {
    body.action = 'status';
    body.status = action;
    const note = prompt(`${STATUS_LABEL[action]} — السبب أو ملاحظة (اختياري):`, '');
    if (note === null) return;
    body.note = note;
  }
  try {
    const r = await api(`${A}/students/bulk`, { method: 'POST', body });
    toast(`تم تحديث ${r.changed} طالب`);
    selected.clear();
    await loadMe();
    loaders.students();
  } catch (ex) { toast(ex.message); }
}));

/* --- نافذة تعديل الطالب --- */
let editing = null;
async function openStudentDialog(id) {
  const st = await api(`${A}/students/${id}`);
  editing = st;
  $('#st-title').textContent = st.name;
  $('#st-name').value = st.name;
  $('#st-no').value = st.student_no || '';
  $('#st-phone').value = st.guardian_phone || '';
  $('#st-section').innerHTML = secOptions();
  $('#st-section').value = st.section_id;
  $('#st-status').value = st.status;
  $('#st-date').value = me.today;
  $('#st-note').value = '';
  $('#st-events').innerHTML = st.events.length ? st.events.map((ev) => `<li><bdi class="num">${esc(ev.date)}</bdi> — <strong>${EVENT_LABEL[ev.kind] || esc(ev.kind)}</strong>${
    ev.from_text ? ` من ${esc(ev.from_text)}` : ''}${ev.to_text ? ` إلى ${esc(ev.to_text)}` : ''}${ev.note ? ` <span class="muted">(${esc(ev.note)})</span>` : ''}</li>`).join('')
    : '<li class="muted">لا توجد تغييرات</li>';
  $('#st-dialog').showModal();
}
$('#st-dialog').addEventListener('close', async () => {
  if ($('#st-dialog').returnValue !== 'save' || !editing) return;
  const f = Object.fromEntries(new FormData($('#st-form')));
  const body = { name: f.name, student_no: f.student_no, guardian_phone: f.guardian_phone, date: f.date, note: f.note };
  if (Number(f.section_id) !== editing.section_id) body.section_id = f.section_id;
  if (f.status !== editing.status) body.status = f.status;
  try {
    await api(`${A}/students/${editing.id}`, { method: 'PATCH', body });
    toast(body.section_id ? 'تم نقل الطالب' : body.status ? `تم: ${STATUS_LABEL[body.status]}` : 'تم الحفظ');
    await loadMe();
    loaders.students();
  } catch (ex) { toast(ex.message); }
  editing = null;
});

/* --- رفع/تحديث القائمة مع معاينة --- */
let pendingUpload = null;
$('#s-upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const mode = fd.get('mode');
  if (mode === 'replace' && !confirm('سيتم حذف جميع الطلاب الحاليين وسجلاتهم. هل أنت متأكد؟')) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    if (mode === 'sync') {
      pendingUpload = new FormData(e.target); // نفس الملفات والخيارات تُرسل عند التطبيق
      fd.append('dry_run', '1');
      const p = await api(`${A}/students/upload`, { method: 'POST', form: fd });
      renderPreview(p);
    } else {
      const r = await api(`${A}/students/upload`, { method: 'POST', form: fd });
      toast(`تمت إضافة ${r.added} طالب${r.skipped ? ` (تم تجاهل ${r.skipped} مكرر)` : ''} — ${filesText(r.files)}`);
      e.target.reset();
      await loadMe();
      loaders.students();
    }
  } catch (ex) { toast(ex.message); } finally { btn.disabled = false; }
});

function filesText(files) {
  return (files || []).map((f) => `${f.name}: ${f.students} طالب (${f.sections.join('، ')})`).join(' — ');
}

function renderPreview(p) {
  const s = p.summary;
  const list = (title, arr, fmt, open) => arr.length ? `<details class="pv" ${open ? 'open' : ''}><summary>${title} (${arr.length})</summary><ul>${arr.map(fmt).join('')}</ul></details>` : '';
  const box = $('#s-preview');
  box.innerHTML = `
    <h3>معاينة التحديث — لم يُطبق شيء بعد</h3>
    <ul class="muted small" style="margin:8px 0 0;padding-inline-start:20px">${(p.files || []).map((f) => `<li><bdi>${esc(f.name)}</bdi>: ${f.students} طالب — ${f.sections.map(esc).join('، ')}</li>`).join('')}</ul>
    <div class="preview-grid" style="margin-top:12px">
      <div class="stat"><div class="stat-label">بدون تغيير</div><div class="stat-value num">${s.unchanged}</div></div>
      <div class="stat"><div class="stat-label">نقل إلى شعبة أخرى</div><div class="stat-value num">${s.moved}</div></div>
      <div class="stat"><div class="stat-label">طلاب جدد</div><div class="stat-value num">${s.added}</div></div>
      <div class="stat"><div class="stat-label">عائدون (إعادة تفعيل)</div><div class="stat-value num">${s.reactivated}</div></div>
      <div class="stat"><div class="stat-label">غير موجودين في الملف</div><div class="stat-value num">${s.missing}</div></div>
    </div>
    <div class="stack" style="margin-top:16px">
      ${list('سيتم نقلهم', p.moved, (x) => `<li>${esc(x.name)}: ${esc(x.from)} ← ${esc(x.to)}</li>`, true)}
      ${list('طلاب جدد', p.added, (x) => `<li>${esc(x.name)} — ${esc(x.to)}</li>`)}
      ${list('عائدون', p.reactivated, (x) => `<li>${esc(x.name)} — ${esc(x.to)}</li>`)}
      ${list('غير موجودين في الملف الجديد', p.missing, (x) => `<li>${esc(x.name)} — ${esc(x.from)}</li>`, true)}
      ${list('أسماء مكررة لم يمكن تحديدها (تُتجاهل — أضف رقم الطالب لتمييزها)', p.ambiguous, (x) => `<li>${esc(x.name)} — ${esc(x.to)}</li>`)}
    </div>
    ${s.missing ? `<div class="field" style="margin-top:16px;max-width:420px"><label for="pv-missing">ماذا نفعل بالطلاب غير الموجودين في الملف؟</label>
      <select id="pv-missing"><option value="keep">إبقاؤهم كما هم</option><option value="transferred">اعتبارهم منتقلين من المدرسة</option><option value="withdrawn">اعتبارهم منقطعين</option></select></div>` : ''}
    <div class="row" style="margin-top:24px">
      <button class="btn btn-primary" id="pv-apply" type="button">تطبيق التغييرات</button>
      <button class="btn btn-ghost" id="pv-cancel" type="button">إلغاء</button>
    </div>`;
  box.classList.remove('hidden');
  $('#pv-cancel').onclick = () => { box.classList.add('hidden'); pendingUpload = null; };
  $('#pv-apply').onclick = async () => {
    const fd = pendingUpload;
    fd.set('mode', 'sync');
    fd.set('missing_action', $('#pv-missing')?.value || 'keep');
    try {
      const r = await api(`${A}/students/upload`, { method: 'POST', form: fd });
      toast(`تم التحديث: نقل ${r.summary.moved}، جدد ${r.summary.added}، عائدون ${r.summary.reactivated}`);
      box.classList.add('hidden');
      $('#s-upload').reset();
      pendingUpload = null;
      await loadMe();
      loaders.students();
    } catch (ex) { toast(ex.message); }
  };
}

/* --- لصق قائمة أسماء --- */
$('#sp-names').addEventListener('input', (e) => {
  const n = e.target.value.split('\n').filter((l) => l.trim()).length;
  $('#sp-count').textContent = n ? `${n} اسم` : '';
});
$('#s-paste').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`${A}/students/paste`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast(`تمت إضافة ${r.added} طالب إلى ${r.section}${r.skipped ? ` (تم تجاهل ${r.skipped} مكرر أو فارغ)` : ''}`);
    $('#sp-names').value = '';
    $('#sp-count').textContent = '';
    await loadMe();
    loaders.students();
  } catch (ex) { toast(ex.message); }
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
  const d = e.target.dataset || {};
  try {
    if (d.editStudent) return await openStudentDialog(d.editStudent);
    if (d.editSection) {
      const sec = sections.find((s) => s.id === Number(d.editSection));
      const grade = prompt('اسم/رقم الصف:', sec.grade);
      if (grade === null) return;
      const section = prompt('رقم الشعبة:', sec.section);
      if (section === null) return;
      const r = await api(`${A}/sections/${sec.id}`, { method: 'PATCH', body: { grade, section } });
      toast(r.merged ? 'تم دمج الشعبتين' : 'تم التعديل');
      return loaders.students();
    }
    if (d.delStudent && confirm('حذف الطالب نهائياً مع جميع سجلاته؟\nإن كان الطالب انقطع أو انتقل فالأفضل استخدام «تعديل / نقل» وتغيير حالته للحفاظ على سجلاته.')) {
      await api(`${A}/students/${d.delStudent}`, { method: 'DELETE' });
      toast('تم الحذف');
      loaders.students();
    }
    if (d.delSection && confirm('حذف الشعبة وجميع طلابها وسجلاتهم نهائياً؟')) {
      await api(`${A}/sections/${d.delSection}`, { method: 'DELETE' });
      toast('تم الحذف');
      loaders.students();
    }
  } catch (ex) { toast(ex.message); }
});

/* ---------- المعلمون ---------- */
const DEFAULT_SUBJECTS = ['لغة عربية', 'لغة إنجليزية', 'رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'علوم', 'تربية إسلامية', 'تاريخ', 'جغرافيا',
  'دراسات اجتماعية', 'تقنية المعلومات', 'رياضة مدرسية', 'فنون تشكيلية', 'مهارات موسيقية', 'مهارات حياتية'];
let teachers = [];
const tSelected = new Set();

async function loadTeachers() {
  teachers = await api(`${A}/teachers`);
  for (const id of [...tSelected]) if (!teachers.some((t) => t.id === id)) tSelected.delete(id);
  const subjects = [...new Set([...teachers.map((t) => t.subject).filter(Boolean), ...DEFAULT_SUBJECTS])];
  $('#subjects-list').innerHTML = subjects.map((x) => `<option value="${esc(x)}">`).join('');
  const f = $('#t-filter');
  const cur = f.value;
  const counts = {};
  teachers.forEach((t) => { const k = t.subject || ''; counts[k] = (counts[k] || 0) + 1; });
  f.innerHTML = '<option value="">كل المواد</option>' + Object.keys(counts).sort((a, b) => a.localeCompare(b, 'ar'))
    .map((k) => `<option value="${esc(k || '__none')}">${esc(k || 'بدون مادة')} (${counts[k]})</option>`).join('');
  f.value = cur;
  renderTeachers();
}

function renderTeachers() {
  const q = $('#t-q').value.trim();
  const sub = $('#t-filter').value;
  const list = teachers.filter((t) => (!q || nameMatch(t.name, q)) && (!sub || (sub === '__none' ? !t.subject : t.subject === sub)));
  $('#t-count').textContent = `(${list.length})`;
  $('#t-list').innerHTML = list.length ? list.map((t, i) => `<tr class="${tSelected.has(t.id) ? 'selected' : ''}">
    <td><input type="checkbox" class="check" data-tpick="${t.id}" ${tSelected.has(t.id) ? 'checked' : ''} aria-label="تحديد ${esc(t.name)}"></td>
    <td class="num">${i + 1}</td><td>${esc(t.name)}</td>
    <td>${t.subject ? esc(t.subject) : '<span class="badge late">بدون مادة</span>'}</td>
    <td class="small muted">${esc(t.job || '')}</td>
    <td class="num"><bdi>${esc(t.phone || '')}</bdi></td><td class="num">${t.records}</td>
    <td><div class="row" style="flex-wrap:nowrap;gap:4px">
      <button class="btn btn-sm" data-edit-teacher="${t.id}" type="button">تعديل</button>
      <button class="btn btn-ghost btn-sm btn-danger" data-del-teacher="${t.id}" type="button">حذف</button></div></td></tr>`).join('')
    : '<tr><td colspan="8" class="empty">لا يوجد معلمون</td></tr>';
  $('#t-bulk').classList.toggle('hidden', !tSelected.size);
  $('#t-bulk-count').textContent = `${tSelected.size} معلم محدد`;
  $('#t-all').checked = list.length > 0 && list.every((t) => tSelected.has(t.id));
}

loaders.teachers = () => loadTeachers().catch((e) => toast(e.message));
$('#t-q').addEventListener('input', renderTeachers);
$('#t-filter').addEventListener('change', renderTeachers);
$('#t-list').addEventListener('change', (e) => {
  const id = Number(e.target.dataset.tpick);
  if (!id) return;
  e.target.checked ? tSelected.add(id) : tSelected.delete(id);
  renderTeachers();
});
$('#t-all').addEventListener('change', (e) => {
  const q = $('#t-q').value.trim(), sub = $('#t-filter').value;
  teachers.filter((t) => (!q || nameMatch(t.name, q)) && (!sub || (sub === '__none' ? !t.subject : t.subject === sub)))
    .forEach((t) => (e.target.checked ? tSelected.add(t.id) : tSelected.delete(t.id)));
  renderTeachers();
});
$('#t-bulk-clear').addEventListener('click', () => { tSelected.clear(); renderTeachers(); });
$('#t-bulk-set').addEventListener('click', async () => {
  const subject = $('#t-bulk-subject').value.trim();
  if (!subject) return toast('اكتب المادة أو اخترها');
  try {
    const r = await api(`${A}/teachers/bulk`, { method: 'POST', body: { ids: [...tSelected], action: 'subject', subject } });
    toast(`تم تعيين «${subject}» لـ ${r.changed} معلم`);
    tSelected.clear();
    $('#t-bulk-subject').value = '';
    loaders.teachers();
  } catch (ex) { toast(ex.message); }
});
$('#t-bulk-del').addEventListener('click', async () => {
  if (!confirm(`حذف ${tSelected.size} معلم؟ (تبقى سجلاتهم محفوظة بأسمائهم)`)) return;
  try {
    const r = await api(`${A}/teachers/bulk`, { method: 'POST', body: { ids: [...tSelected], action: 'delete' } });
    toast(`تم حذف ${r.changed} معلم`);
    tSelected.clear();
    await loadMe();
    loaders.teachers();
  } catch (ex) { toast(ex.message); }
});

/* رفع الملف: معاينة ثم تطبيق */
let tPending = null;
$('#t-upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (fd.get('mode') === 'replace' && !confirm('سيتم حذف كل المعلمين الحاليين ثم إضافة من في الملف. متابعة؟')) return;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    tPending = new FormData(e.target);
    fd.append('dry_run', '1');
    renderTeacherPreview(await api(`${A}/teachers/upload`, { method: 'POST', form: fd }));
  } catch (ex) { toast(ex.message); } finally { btn.disabled = false; }
});

function renderTeacherPreview(p) {
  const s = p.summary;
  const box = $('#t-preview');
  const subj = Object.entries(p.subjects).sort((a, b) => b[1] - a[1]);
  box.innerHTML = `
    <h3>معاينة — لم يُحفظ شيء بعد</h3>
    <div class="preview-grid" style="margin-top:12px">
      <div class="stat"><div class="stat-label">سيتم استيرادهم</div><div class="stat-value num">${s.importing}</div></div>
      <div class="stat"><div class="stat-label">معلمون في الملف</div><div class="stat-value num">${s.teachers}</div></div>
      <div class="stat"><div class="stat-label">موظفون آخرون</div><div class="stat-value num">${s.others}</div></div>
      <div class="stat"><div class="stat-label">عدد المواد</div><div class="stat-value num">${subj.length}</div></div>
    </div>
    <div class="chips" style="margin-top:16px">${subj.map(([k, n]) => `<span class="badge">${esc(k)} · ${n}</span>`).join('')}</div>
    <div class="stack" style="margin-top:16px">
      <details class="pv"><summary>القائمة (${p.sample.length})</summary><ul>${p.sample.map((t) => `<li>${esc(t.name)} — <strong>${esc(t.subject || 'بدون مادة')}</strong></li>`).join('')}</ul></details>
      ${p.others.length && s.importing === s.teachers ? `<details class="pv"><summary>لن يُستورد: موظفون ليسوا معلمين (${p.others.length})</summary><ul>${p.others.map((t) => `<li>${esc(t.name)} — ${esc(t.job || '')}</li>`).join('')}</ul></details>` : ''}
    </div>
    <div class="row" style="margin-top:24px">
      <button class="btn btn-primary" id="tpv-apply" type="button">استيراد ${s.importing}</button>
      <button class="btn btn-ghost" id="tpv-cancel" type="button">إلغاء</button>
    </div>`;
  box.classList.remove('hidden');
  $('#tpv-cancel').onclick = () => { box.classList.add('hidden'); tPending = null; };
  $('#tpv-apply').onclick = async () => {
    try {
      const r = await api(`${A}/teachers/upload`, { method: 'POST', form: tPending });
      toast(`تمت إضافة ${r.added} معلم${r.updated ? `، وتحديث ${r.updated}` : ''}`);
      box.classList.add('hidden');
      $('#t-upload').reset();
      tPending = null;
      await loadMe();
      loaders.teachers();
    } catch (ex) { toast(ex.message); }
  };
}

/* إدخال جماعي */
$('#tp-names').addEventListener('input', (e) => {
  const n = e.target.value.split('\n').filter((l) => l.trim()).length;
  $('#tp-count').textContent = n ? `${n} اسم` : '';
});
$('#t-paste').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`${A}/teachers/paste`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast(`تمت إضافة ${r.added} معلم${r.updated ? `، وتحديث ${r.updated}` : ''}`);
    e.target.reset();
    $('#tp-count').textContent = '';
    await loadMe();
    loaders.teachers();
  } catch (ex) { toast(ex.message); }
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
  const ed = e.target.closest('[data-edit-teacher]');
  const del = e.target.closest('[data-del-teacher]');
  try {
    if (ed) {
      const t = teachers.find((x) => x.id === Number(ed.dataset.editTeacher));
      const subject = prompt(`مادة ${t.name}:`, t.subject || '');
      if (subject === null) return;
      const phone = prompt(`جوال ${t.name}:`, t.phone || '');
      if (phone === null) return;
      await api(`${A}/teachers/${t.id}`, { method: 'PATCH', body: { subject, phone } });
      toast('تم الحفظ');
      loaders.teachers();
    }
    if (del && confirm('حذف المعلم؟ (تبقى سجلاته محفوظة باسمه)')) {
      await api(`${A}/teachers/${del.dataset.delTeacher}`, { method: 'DELETE' });
      toast('تم الحذف');
      await loadMe();
      loaders.teachers();
    }
  } catch (ex) { toast(ex.message); }
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
    if (e.status === 403) return showBlocked(e);
    return toast(e.message);
  }
  if (me.school.must_change_password) await forcePasswordChange();
  const [f, t] = rangeOf('month');
  $('#o-from').value = f; $('#o-to').value = t;
  $('#r-from').value = me.today; $('#r-to').value = me.today;
  await loadSections().catch(() => {});
  let tab = 'overview';
  try { tab = sessionStorage.getItem('tab') || tab; } catch { /* لا شيء */ }
  openTab(tab);
})();
