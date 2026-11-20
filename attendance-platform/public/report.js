'use strict';
(async () => {
  const q = location.search.slice(1);
  let me, rec, stats;
  try {
    [me, rec, stats] = await Promise.all([api('/api/admin/me'), api(`/api/admin/records?${q}`), api(`/api/admin/stats?${q}`)]);
  } catch (e) {
    if (e.status === 401) return location.replace('/');
    document.body.textContent = e.message;
    return;
  }
  const f = rec.filters;
  const typeTxt = f.type ? ` · الحالة: ${TYPE_LABEL[f.type]}` : '';
  const gradeTxt = f.grade ? ` · الصف: ${f.grade}` : '';
  if (me.school.logo_url) { $('#logo').src = me.school.logo_url; $('#logo').classList.remove('hidden'); }
  $('#title').textContent = `${me.school.name} — تقرير الغياب والتأخير والهروب`;
  $('#meta').innerHTML = `الفترة من <bdi>${esc(f.from)}</bdi> إلى <bdi>${esc(f.to)}</bdi>${esc(gradeTxt)}${esc(typeTxt)}`;
  document.title = `تقرير ${f.from} - ${f.to}`;

  const t = stats.totals;
  $('#kpis').innerHTML = [['إجمالي الحالات', t.total], ['غياب', t.absent], ['غياب بعذر', t.excused], ['تأخير', t.late], ['هروب', t.escape]]
    .map(([l, v]) => `<div class="kpi"><span class="muted small">${l}</span><b class="num">${v || 0}</b></div>`).join('');

  $('#summary').innerHTML = stats.students.map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.name)}</td><td>${esc(gradeLabel(s.grade))}</td><td>${esc(s.section)}</td>
    <td class="num">${s.absent}</td><td class="num">${s.excused || 0}</td><td class="num">${s.late}</td><td class="num">${s.escape}</td><td class="num"><b>${s.total}</b></td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">لا توجد حالات</td></tr>';

  $('#records').innerHTML = rec.records.map((r) => `<tr><td class="num">${r.date}</td><td class="num">${r.period_number}</td><td>${esc(r.student_name)}</td>
    <td>${esc(gradeLabel(r.grade))}</td><td>${esc(r.section)}</td><td><span class="badge ${recClass(r)}">${recLabel(r)}</span></td><td>${esc(r.teacher_name || '')}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">لا توجد سجلات</td></tr>';

  $('#print').addEventListener('click', () => window.print());
  await document.fonts.ready;
  if (me.school.logo_url) await new Promise((r) => { const i = $('#logo'); if (i.complete) r(); else { i.onload = r; i.onerror = r; } });
  setTimeout(() => window.print(), 300);
})();
