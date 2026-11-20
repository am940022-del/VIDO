'use strict';
/*
 * واجهة المعلم — مصممة ليكون الرصد في ثوانٍ:
 *  - ضغطة واحدة على زر الحالة بجانب اسم الطالب (بدون نوافذ أو تأكيد).
 *  - التغييرات تُجمع وتُرسل في طلب واحد كل لحظات (أخف على الخادم)، وتُحفظ على الجهاز
 *    إن انقطع الاتصال ثم تُرسل تلقائياً.
 *  - بيانات المدرسة تُعرض فوراً من ذاكرة الجهاز ثم تُحدّث في الخلفية.
 *  - زر «متابعة آخر صف» والحصة الحالية تُختار تلقائياً حسب الوقت.
 */
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const base = `/api/t/${encodeURIComponent(token)}`;
const K = { info: `info:${token}`, teacher: `teacher:${token}`, last: `last:${token}`, queue: `queue:${token}` };
const state = { info: null, grades: new Map(), grade: null, sectionId: null, period: null, students: [], current: null };

function lsGet(k, json) {
  try { const v = localStorage.getItem(k); return json ? (v ? JSON.parse(v) : null) : v; } catch { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* لا شيء */ }
}

/* ---------------- التنقل (يدعم زر الرجوع في الجوال) ---------------- */
function show(view, push = true) {
  for (const v of ['grades', 'pick', 'list']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  window.scrollTo(0, 0);
  if (push && history.state?.view !== view) history.pushState({ view }, '');
}
window.addEventListener('popstate', (e) => {
  const v = e.state?.view || 'grades';
  if (v === 'list' && !state.sectionId) return show('grades', false);
  if (v === 'pick' && !state.grade) return show('grades', false);
  if (v !== 'list') flush();
  show(v, false);
});

function fail(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function currentPeriod(periods) {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const p = periods.find((x) => x.start_time && x.end_time && hm >= x.start_time && hm <= x.end_time);
  return p ? p.number : null;
}

/* ---------------- تحميل بيانات المدرسة ---------------- */
function applyInfo(info) {
  state.info = info;
  document.title = `رصد الحضور — ${info.school}`;
  $('#school-name').textContent = info.school;
  $('#today').textContent = fmtDate(info.today, true);

  const sel = $('#teacher-select');
  const saved = lsGet(K.teacher) || '';
  sel.innerHTML = '<option value="">— اختر اسمك —</option>';
  for (const t of info.teachers) sel.add(new Option(t.subject ? `${t.name} — ${t.subject}` : t.name, t.id));
  sel.value = saved;
  $('#teacher-box').classList.toggle('hidden', !info.teachers.length);

  state.grades = new Map();
  for (const s of info.sections) {
    if (!state.grades.has(s.grade)) state.grades.set(s.grade, []);
    state.grades.get(s.grade).push(s);
  }
  const tiles = $('#grade-tiles');
  tiles.innerHTML = '';
  for (const [grade, secs] of state.grades) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.type = 'button';
    const n = secs.reduce((a, s) => a + s.students, 0);
    b.innerHTML = `<strong>${esc(grade)}</strong><span>${secs.length} شعبة · ${n} طالب</span>`;
    b.addEventListener('click', () => openGrade(grade));
    tiles.appendChild(b);
  }
  $('#no-grades').classList.toggle('hidden', state.grades.size > 0);
  renderResume();
}

function renderResume() {
  const last = lsGet(K.last, true);
  const box = $('#resume');
  const sec = last && state.info.sections.find((s) => s.id === last.sectionId);
  if (!sec) return box.classList.add('hidden');
  const p = currentPeriod(state.info.periods) || last.period;
  box.innerHTML = `<span class="grow"><span class="muted small">متابعة آخر صف</span><br><strong>${esc(sec.grade)} — شعبة ${esc(sec.section)}</strong> · الحصة ${p}</span><span aria-hidden="true">←</span>`;
  box.onclick = () => {
    state.grade = sec.grade;
    state.sectionId = sec.id;
    state.period = p;
    openList();
  };
  box.classList.remove('hidden');
}

async function init() {
  const cached = lsGet(K.info, true);
  if (cached) { applyInfo(cached); show('grades', false); history.replaceState({ view: 'grades' }, ''); }
  try {
    const fresh = await api(`${base}/info`);
    lsSet(K.info, fresh);
    applyInfo(fresh);
    if (!cached) { show('grades', false); history.replaceState({ view: 'grades' }, ''); }
  } catch (e) {
    if (e.status === 404) {
      try { localStorage.removeItem(K.info); } catch { /* لا شيء */ }
      $$('main > section').forEach((s) => s.classList.add('hidden'));
    }
    if (e.status === 404 || !cached) fail(e.message);
  }
  flush();
}

/* ---------------- اختيار الشعبة والحصة ---------------- */
function openGrade(grade) {
  state.grade = grade;
  state.sectionId = null;
  if (state.period == null) state.period = currentPeriod(state.info.periods);
  $('#pick-grade').textContent = grade;
  const secs = state.grades.get(grade);

  const chips = $('#section-chips');
  chips.innerHTML = '';
  for (const s of secs) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = s.section;
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      state.sectionId = s.id;
      $$('.chip', chips).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      maybeOpen();
    });
    chips.appendChild(c);
  }

  const pchips = $('#period-chips');
  pchips.innerHTML = '';
  for (const p of state.info.periods) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = p.number;
    if (p.start_time) c.title = `${p.start_time} - ${p.end_time || ''}`;
    c.setAttribute('aria-pressed', String(p.number === state.period));
    c.addEventListener('click', () => {
      state.period = p.number;
      $$('.chip', pchips).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      maybeOpen();
    });
    pchips.appendChild(c);
  }
  $('#pick-hint').textContent = state.period
    ? `الحصة ${state.period} محددة — اضغط على الشعبة لفتح القائمة مباشرة`
    : 'اختر الشعبة والحصة وستفتح القائمة مباشرة';
  show('pick');
}

// تُفتح القائمة بمجرد اكتمال الاختيار، دون زر إضافي
function maybeOpen() {
  if (state.sectionId && state.period) openList();
}

/* ---------------- قائمة الطلاب ---------------- */
async function openList() {
  try {
    await flush();
    const data = await api(`${base}/sections/${state.sectionId}/students?period=${state.period}`);
    state.students = data.students;
    // إظهار التغييرات التي لم تُرسل بعد (عند انقطاع الاتصال)
    for (const q of getQueue()) {
      if (q.period !== state.period) continue;
      const s = state.students.find((x) => x.id === q.student_id);
      if (s) s.status = q.type;
    }
    lsSet(K.last, { sectionId: state.sectionId, period: state.period });
    $('#crumbs').innerHTML = `<strong>${esc(data.section.grade)}</strong><span class="sep">‹</span><span>شعبة ${esc(data.section.section)}</span><span class="sep">‹</span><span>الحصة ${data.period}</span>`;
    $('#search').value = '';
    renderList();
    show('list');
  } catch (e) {
    toast(e.message);
  }
}

const TYPES = ['absent', 'late', 'escape'];
const SHORT = { absent: 'غائب', late: 'متأخر', escape: 'هارب' };

function rowHtml(s, i) {
  const others = (s.other || '').split(',').filter(Boolean).map((x) => {
    const [p, t] = x.split(':');
    return `<span class="badge ${esc(t)}" title="${TYPE_LABEL[t] || ''} في الحصة ${esc(p)}">ح${esc(p)}</span>`;
  }).join('');
  const btns = TYPES.map((t) => `<button type="button" class="mark ${t}" data-id="${s.id}" data-type="${t}" aria-pressed="${s.status === t}">${SHORT[t]}</button>`).join('');
  return `<div class="srow ${s.status || ''}" data-row="${s.id}">
    <button type="button" class="sname" data-note="${s.id}" title="إضافة ملاحظة"><span class="idx num">${i + 1}</span><span class="name">${esc(s.name)}</span>${others ? `<span class="others">${others}</span>` : ''}</button>
    <div class="marks" role="group" aria-label="حالة ${esc(s.name)}">${btns}</div>
  </div>`;
}

function renderList() {
  const q = normAr($('#search').value);
  const list = state.students.filter((s) => !q || normAr(s.name).includes(q));
  $('#students').innerHTML = list.length
    ? list.map((s) => rowHtml(s, state.students.indexOf(s))).join('')
    : `<p class="empty">${state.students.length ? 'لا توجد نتائج مطابقة' : 'لا يوجد طلاب في هذه الشعبة'}</p>`;
  renderSummary();
}

function renderRow(s) {
  const el = $(`[data-row="${s.id}"]`);
  if (el) el.outerHTML = rowHtml(s, state.students.indexOf(s));
  renderSummary();
}

function renderSummary() {
  const c = { absent: 0, late: 0, escape: 0 };
  state.students.forEach((s) => s.status && c[s.status]++);
  const present = state.students.length - c.absent - c.escape;
  $('#summary').innerHTML = `<span class="badge">العدد ${state.students.length}</span><span class="badge">الحاضرون ${present}</span>` +
    TYPES.map((k) => `<span class="badge ${k}">${TYPE_LABEL[k]} ${c[k]}</span>`).join('');
}

/* ضغطة واحدة تحدد الحالة، والضغط مرة أخرى على نفس الزر يلغيها */
$('#students').addEventListener('click', (e) => {
  const m = e.target.closest('.mark');
  if (m) {
    const s = state.students.find((x) => x.id === Number(m.dataset.id));
    setStatus(s, s.status === m.dataset.type ? null : m.dataset.type);
    if (navigator.vibrate) navigator.vibrate(12);
    return;
  }
  const n = e.target.closest('[data-note]');
  if (n) openSheet(state.students.find((x) => x.id === Number(n.dataset.note)));
});

function setStatus(s, type, note) {
  s.status = type;
  enqueue({ student_id: s.id, period: state.period, type, note: note || undefined, date: state.info.today });
  renderRow(s);
}

/* ---------------- الإرسال المجمّع ---------------- */
function getQueue() { return lsGet(K.queue, true) || []; }
function setQueue(q) { lsSet(K.queue, q); }

let flushTimer = null;
let flushing = null;
function enqueue(item) {
  // آخر تغيير لنفس الطالب والحصة يلغي ما قبله
  const q = getQueue().filter((x) => !(x.student_id === item.student_id && x.period === item.period));
  q.push(item);
  setQueue(q);
  setSaveState('pending');
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 800);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (flushing) return flushing;
  const q = getQueue();
  if (!q.length) return Promise.resolve();
  setSaveState('saving');
  flushing = (async () => {
    try {
      await api(`${base}/marks`, { method: 'POST', body: { teacher_id: $('#teacher-select').value || null, items: q } });
      const sent = new Set(q.map((x) => JSON.stringify(x)));
      setQueue(getQueue().filter((x) => !sent.has(JSON.stringify(x))));
      setSaveState(getQueue().length ? 'pending' : 'saved');
    } catch (e) {
      if (e.status === 404) { setQueue([]); fail(e.message); return; }
      setSaveState('offline');
      flushTimer = setTimeout(flush, 5000);
    } finally {
      flushing = null;
    }
    if (getQueue().length && !flushTimer) flushTimer = setTimeout(flush, 800);
  })();
  return flushing;
}

function setSaveState(s) {
  const el = $('#save-state');
  const txt = { pending: 'بانتظار الحفظ…', saving: 'جارٍ الحفظ…', saved: '✓ تم الحفظ', offline: 'لا يوجد اتصال — سيُحفظ تلقائياً' };
  el.textContent = txt[s];
  el.dataset.state = s;
}

window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

/* ---------------- نافذة الملاحظة (بالضغط على اسم الطالب) ---------------- */
function openSheet(s) {
  state.current = s;
  $('#sheet-name').textContent = s.name;
  $('#sheet-note').value = '';
  $$('.choice').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === s.status)));
  $('#sheet-clear').classList.toggle('hidden', !s.status);
  $('#sheet').classList.remove('hidden');
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  state.current = null;
}
$$('.choice').forEach((b) => b.addEventListener('click', () => {
  if (!state.current) return;
  setStatus(state.current, b.dataset.type, $('#sheet-note').value.trim());
  closeSheet();
}));
$('#sheet-clear').addEventListener('click', () => { if (state.current) setStatus(state.current, null); closeSheet(); });
$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------------- أحداث عامة ---------------- */
$('#teacher-select').addEventListener('change', (e) => lsSet(K.teacher, e.target.value));
$('#back-grades').addEventListener('click', () => history.back());
$('#change-pick').addEventListener('click', () => { flush(); openGrade(state.grade); });
$('#search').addEventListener('input', renderList);

init();
