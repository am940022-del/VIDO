'use strict';
(async () => {
  const params = new URLSearchParams(location.search);
  let d;
  try {
    d = await api(`/api/admin/student-reports?${params}`);
  } catch (e) {
    if (e.status === 401) return location.replace('/');
    document.body.textContent = e.message;
    return;
  }
  const single = params.has('student_id');
  document.title = single && d.students[0] ? `كشف ${d.students[0].name}` : `كشوف أولياء الأمور ${d.from} - ${d.to}`;
  $('#count').textContent = single ? '' : `${d.students.length} كشف — كل طالب في صفحة مستقلة`;
  const period = d.from === d.to ? `بتاريخ <bdi>${esc(d.from)}</bdi>` : `من <bdi>${esc(d.from)}</bdi> إلى <bdi>${esc(d.to)}</bdi>`;

  $('#letters').innerHTML = d.students.map((st) => `
    <article class="letter">
      <header>
        <div class="row" style="gap:16px;align-items:center;flex-wrap:nowrap">${d.logo_url ? `<img class="report-logo" src="${esc(d.logo_url)}" alt="">` : ''}<div><h1>${esc(d.school)}</h1><p class="muted">إشعار ولي أمر — كشف حضور الطالب</p></div></div>
        <p class="muted small">الفترة ${period}</p>
      </header>
      <div class="info">
        <div><span>اسم الطالب</span><b>${esc(st.name)}</b></div>
        <div><span>الصف / الشعبة</span><b>${esc(gradeLabel(st.grade))} / ${esc(st.section)}</b></div>
        ${st.student_no ? `<div><span>رقم الطالب</span><b class="num">${esc(st.student_no)}</b></div>` : ''}
      </div>
      <p style="margin-top:24px">المكرم ولي أمر الطالب، السلام عليكم ورحمة الله وبركاته. نفيدكم بملخص حضور ابنكم خلال الفترة المذكورة، ونأمل منكم المتابعة والتواصل مع إدارة المدرسة.</p>
      <div class="kpis">
        <div class="kpi absent"><span class="muted small">الغياب (حصص)</span><b class="num">${st.totals.absent}</b></div>
        <div class="kpi"><span class="muted small">أيام الغياب</span><b class="num">${st.absentDays}</b></div>
        <div class="kpi late"><span class="muted small">التأخير</span><b class="num">${st.totals.late}</b></div>
        <div class="kpi escape"><span class="muted small">الهروب</span><b class="num">${st.totals.escape}</b></div>
      </div>
      <h2>التفاصيل</h2>
      <table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الحصة</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>
        ${st.records.map((r) => `<tr><td class="num">${r.date}</td><td>${dayName(r.date)}</td><td class="num">${r.period_number}</td><td><span class="badge ${r.type}">${TYPE_LABEL[r.type]}</span></td><td>${esc(r.note || '')}</td></tr>`).join('')
          || '<tr><td colspan="5" class="empty">لا توجد حالات في هذه الفترة</td></tr>'}
      </tbody></table>
      <div class="sign"><span>توقيع ولي الأمر: ..................</span><span>إدارة المدرسة: ..................</span></div>
      <div class="actions">
        ${st.guardian_phone
          ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${esc(whatsappUrl(st.guardian_phone, d.country_code, guardianMessage(d.school, d.from, d.to, st)))}">إرسال لولي الأمر عبر واتساب</a>
             <a class="btn" href="${esc(smsUrl(st.guardian_phone, d.country_code, guardianMessage(d.school, d.from, d.to, st)))}">رسالة نصية SMS</a>`
          : '<span class="muted small">لا يوجد رقم جوال لولي الأمر — أضفه من تبويب الطلاب</span>'}
        <a class="btn" href="/api/admin/students/${st.id}/export.xlsx?${new URLSearchParams({ from: d.from, to: d.to })}">تحميل Excel</a>
      </div>
    </article>`).join('') || '<p class="empty">لا يوجد طلاب لديهم حالات في هذه الفترة</p>';

  $('#print').addEventListener('click', () => window.print());
})();

function dayName(d) {
  try { return new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(new Date(d + 'T12:00:00')); } catch { return ''; }
}
