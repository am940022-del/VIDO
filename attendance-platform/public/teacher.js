'use strict';
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const base = `/api/t/${encodeURIComponent(token)}`;
const state = { info: null, grade: null, sectionId: null, period: null, students: [], current: null };
const LS_TEACHER = `teacher:${token}`;

function show(view) {
  for (const v of ['grades', 'pick', 'list']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  window.scrollTo(0, 0);
}

function fail(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* لا شيء */ } }

/* الحصة الحالية حسب الوقت إن حددت الإدارة أوقات الحصص */
function currentPeriod(periods) {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const p = periods.find((x) => x.start_time && x.end_time && hm >= x.start_time && hm <= x.end_time);
  return p ? p.number : null;
}

async function init() {
  try {
    state.info = await api(`${base}/info`);
  } catch (e) {
    fail(e.message);
    return;
  }
  const { info } = state;
  document.title = `رصد الحضور — ${info.school}`;
  $('#school-name').textContent = info.school;
  $('#today').textContent = fmtDate(info.today, true);

  const sel = $('#teacher-select');
  for (const t of info.teachers) sel.add(new Option(t.subject ? `${t.name} — ${t.subject}` : t.name, t.id));
  sel.value = lsGet(LS_TEACHER) || '';
  sel.addEventListener('change', () => lsSet(LS_TEACHER, sel.value));
  if (!info.teachers.length) sel.closest('.teacher-head').classList.add('hidden');

  // تجميع الشعب حسب الصف مع الحفاظ على الترتيب
  const grades = new Map();
  for (const s of info.sections) {
    if (!grades.has(s.grade)) grades.set(s.grade, []);
    grades.get(s.grade).push(s);
  }
  state.grades = grades;
  const tiles = $('#grade-tiles');
  tiles.innerHTML = '';
  for (const [grade, secs] of grades) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.type = 'button';
    const n = secs.reduce((a, s) => a + s.students, 0);
    b.innerHTML = `<strong>${esc(grade)}</strong><span>${secs.length} شعبة · ${n} طالب</span>`;
    b.addEventListener('click', () => openGrade(grade));
    tiles.appendChild(b);
  }
  $('#no-grades').classList.toggle('hidden', grades.size > 0);
  show('grades');
}

function openGrade(grade) {
  state.grade = grade;
  state.sectionId = null;
  $('#pick-grade').textContent = grade;
  const secs = state.grades.get(grade);
  const chips = $('#section-chips');
  chips.innerHTML = '';
  for (const s of secs) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = s.section;
    c.title = `${s.students} طالب`;
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      state.sectionId = s.id;
      $$('.chip', chips).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      updateOpen();
    });
    chips.appendChild(c);
  }
  if (secs.length === 1) chips.firstChild.click();

  const pchips = $('#period-chips');
  pchips.innerHTML = '';
  if (state.period == null) state.period = currentPeriod(state.info.periods);
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
      updateOpen();
    });
    pchips.appendChild(c);
  }
  updateOpen();
  show('pick');
}

function updateOpen() {
  $('#open-list').disabled = !(state.sectionId && state.period);
}

async function openList() {
  try {
    const data = await api(`${base}/sections/${state.sectionId}/students?period=${state.period}`);
    state.students = data.students;
    $('#crumbs').innerHTML = `<strong>${esc(data.section.grade)}</strong><span class="sep">‹</span><span>شعبة ${esc(data.section.section)}</span><span class="sep">‹</span><span>الحصة ${data.period}</span>`;
    $('#search').value = '';
    renderList();
    show('list');
  } catch (e) {
    toast(e.message);
  }
}

function renderList() {
  const q = normAr($('#search').value);
  const box = $('#students');
  box.innerHTML = '';
  const list = state.students.filter((s) => !q || normAr(s.name).includes(q));
  list.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `student ${s.status || ''}`;
    const others = (s.other || '').split(',').filter(Boolean).map((x) => {
      const [p, t] = x.split(':');
      return `<span class="badge ${t}" title="الحصة ${p}">ح${esc(p)} ${TYPE_LABEL[t] || ''}</span>`;
    }).join('');
    b.innerHTML = `<span class="idx num">${state.students.indexOf(s) + 1}</span><span class="name">${esc(s.name)}</span><span class="others">${others}</span>${s.status ? `<span class="badge ${s.status}">${TYPE_LABEL[s.status]}</span>` : ''}`;
    b.addEventListener('click', () => openSheet(s));
    box.appendChild(b);
  });
  if (!list.length) box.innerHTML = `<p class="empty">${state.students.length ? 'لا توجد نتائج مطابقة' : 'لا يوجد طلاب في هذه الشعبة'}</p>`;

  const c = { absent: 0, late: 0, escape: 0 };
  state.students.forEach((s) => s.status && c[s.status]++);
  const present = state.students.length - c.absent - c.escape;
  $('#summary').innerHTML = `<span class="badge">العدد ${state.students.length}</span><span class="badge">الحاضرون ${present}</span>` +
    Object.keys(c).map((k) => `<span class="badge ${k}">${TYPE_LABEL[k]} ${c[k]}</span>`).join('');
}

function openSheet(s) {
  state.current = s;
  $('#sheet-name').textContent = s.name;
  $('#sheet-note').value = '';
  $$('.choice').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === s.status)));
  $('#sheet-clear').classList.toggle('hidden', !s.status);
  $('#sheet').classList.remove('hidden');
  $('.choice[data-type=absent]').focus();
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  state.current = null;
}

async function mark(type) {
  const s = state.current;
  if (!s) return;
  try {
    if (type) {
      await api(`${base}/mark`, { method: 'PUT', body: { student_id: s.id, period: state.period, type, teacher_id: $('#teacher-select').value || null, note: $('#sheet-note').value } });
      toast(`تم رصد ${TYPE_LABEL[type]}: ${s.name}`);
    } else {
      await api(`${base}/mark`, { method: 'DELETE', body: { student_id: s.id, period: state.period } });
      toast(`تمت إزالة الرصد: ${s.name}`);
    }
    s.status = type;
    closeSheet();
    renderList();
  } catch (e) {
    toast(e.message);
  }
}

$('#back-grades').addEventListener('click', () => show('grades'));
$('#open-list').addEventListener('click', openList);
$('#change-pick').addEventListener('click', () => openGrade(state.grade));
$('#search').addEventListener('input', renderList);
$$('.choice').forEach((b) => b.addEventListener('click', () => mark(b.dataset.type)));
$('#sheet-clear').addEventListener('click', () => mark(null));
$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

init();
