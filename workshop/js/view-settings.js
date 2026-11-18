/* الإعدادات (للمدير): الورشة، العمال، الأعطال الجاهزة، الشروط، النسخ الاحتياطي + سجل التدقيق */
'use strict';

Views.settings = async (el) => {
  const s = App.settings;
  const allWorkers = await DB.all('workers');

  el.innerHTML = `
    <div class="page-head"><h1>الإعدادات</h1></div>
    <div class="stack-lg">

      <section class="card">
        <h2>معلومات الورشة</h2>
        <form id="fShop" class="stack">
          <div class="grid-2">
            <label class="field"><span>اسم الورشة *</span><input name="name" value="${U.esc(s.name)}" required></label>
            <label class="field"><span>الهاتف</span><input name="phone" value="${U.esc(s.phone)}" dir="ltr"></label>
            <label class="field"><span>العنوان</span><input name="address" value="${U.esc(s.address)}"></label>
            <label class="field"><span>العملة</span><input name="currency" value="${U.esc(s.currency)}"></label>
            <label class="field"><span>مدة الاستلام بعد الجاهزية (أيام)</span><input name="storageDays" inputmode="numeric" dir="ltr" value="${s.storageDays}"></label>
            <label class="field"><span>أجرة الأرضية لكل يوم تأخير</span><input name="storageFee" inputmode="numeric" dir="ltr" value="${s.storageFee}"></label>
            <label class="field"><span>مدة الضمان على أجور العمل (أيام)</span><input name="warrantyDays" inputmode="numeric" dir="ltr" value="${s.warrantyDays}"></label>
            <div class="field"><span>الشعار</span>
              <div class="row gap-3">
                <span class="logo-prev">${s.logo ? `<img src="${s.logo}" alt="الشعار">` : '<span class="muted sm">بدون</span>'}</span>
                <label class="btn btn-ghost btn-sm" for="logo">اختيار صورة<input type="file" id="logo" accept="image/*" hidden></label>
                ${s.logo ? '<button type="button" class="btn btn-ghost btn-sm" id="rmLogo">إزالة</button>' : ''}
              </div>
            </div>
          </div>
          <div><button class="btn btn-primary">حفظ</button></div>
        </form>
      </section>

      <section class="card">
        <h2>العمال</h2>
        <table class="table">
          <thead><tr><th>الاسم</th><th>الدور</th><th>رمز الدخول</th><th></th></tr></thead>
          <tbody>${allWorkers.map((w) => `<tr class="${w.active === false ? 'inactive' : ''}">
            <td>${U.esc(w.name)}</td><td>${DEFAULTS.roles[w.role]}</td><td>${w.pin ? 'مفعّل' : '—'}</td>
            <td><button class="btn btn-ghost btn-sm" data-w="${U.esc(w.id)}">تعديل</button></td></tr>`).join('')}</tbody>
        </table>
        <button class="btn btn-ghost mt-4" id="addW">+ إضافة عامل</button>
      </section>

      <section class="card">
        <h2>الأعطال الجاهزة</h2>
        <p class="muted">كل سطر = كلمة. تقدر تضيف أقسام جديدة.</p>
        <div id="cats" class="cat-edit"></div>
        <div class="row gap-3 mt-4">
          <button class="btn btn-ghost" id="addCat">+ قسم جديد</button>
          <button class="btn btn-primary" id="saveCats">حفظ الأعطال</button>
        </div>
        <h3 class="mt-5">أنواع العمل</h3>
        <textarea id="stypes" rows="4" class="mt-2">${U.esc(s.serviceTypes.join('\n'))}</textarea>
        <button class="btn btn-primary mt-3" id="saveTypes">حفظ أنواع العمل</button>
      </section>

      <section class="card">
        <h2>الشروط والأحكام</h2>
        <p class="muted">كل سطر = بند. تقدر تستخدم: <bdi>{أيام_الاستلام}</bdi> و<bdi>{أجرة_الأرضية}</bdi> و<bdi>{أيام_الضمان}</bdi>. التعديل يطبّق على الاستلامات الجديدة فقط؛ القديمة محفوظة بنصّها الأصلي.</p>
        <textarea id="terms" rows="10" class="mt-3">${U.esc(s.terms.join('\n'))}</textarea>
        <div class="row gap-3 mt-3">
          <button class="btn btn-primary" id="saveTerms">حفظ الشروط</button>
          <button class="btn btn-ghost" id="resetTerms">استرجاع الافتراضي</button>
        </div>
        <p class="muted sm mt-3">ننصح بعرض الشروط على محامٍ محلي حتى تكون ملزمة قانونياً ببلدك.</p>
      </section>

      <section class="card">
        <h2>النسخ الاحتياطي</h2>
        <p class="muted">كل البيانات محفوظة على هذا الجهاز. سوّي نسخة احتياطية أسبوعياً على الأقل واحفظها بمكان ثاني (فلاش، إيميل، درايف).</p>
        <p>آخر نسخة: <strong>${s.backupAt ? U.fmtDate(s.backupAt) : 'لا يوجد'}</strong></p>
        <div class="row gap-3 wrap mt-3">
          <button class="btn btn-primary" id="exp">تنزيل نسخة احتياطية</button>
          <label class="btn btn-ghost" for="imp">استرجاع من نسخة<input type="file" id="imp" accept=".json,application/json" hidden></label>
        </div>
      </section>
    </div>`;

  const $ = (q) => el.querySelector(q);
  const nonNeg = (v) => Math.max(0, Number(String(v).replace(/[^\d.]/g, '')) || 0);

  /* الورشة */
  let logo = s.logo;
  $('#logo').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    logo = await U.processPhoto(file, [], 400);
    $('.logo-prev').innerHTML = `<img src="${logo}" alt="الشعار">`;
  };
  if ($('#rmLogo')) $('#rmLogo').onclick = () => { logo = ''; $('.logo-prev').innerHTML = '<span class="muted sm">بدون</span>'; };
  $('#fShop').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!f.get('name').trim()) return U.toast('اسم الورشة مطلوب', 'err');
    await App.saveSettings({
      name: f.get('name').trim(), phone: f.get('phone').trim(), address: f.get('address').trim(),
      currency: f.get('currency').trim() || 'د.ع',
      storageDays: nonNeg(f.get('storageDays')), storageFee: nonNeg(f.get('storageFee')), warrantyDays: nonNeg(f.get('warrantyDays')),
      logo,
    });
    await DB.audit('تعديل إعدادات الورشة');
    U.toast('تم الحفظ');
    App.renderHeader('settings');
  };

  /* العمال */
  async function editWorker(w) {
    const isNew = !w;
    w = w || { id: U.uid(), name: '', role: 'tech', pin: '', active: true };
    const isSelf = w.id === App.user.id;
    const dlg = await C.modal(isNew ? 'إضافة عامل' : 'تعديل عامل', `
      <label class="field"><span>الاسم *</span><input name="n" value="${U.esc(w.name)}"></label>
      <label class="field mt-3"><span>الدور</span><select name="r" ${isSelf ? 'disabled' : ''}>${Object.entries(DEFAULTS.roles).map(([k, v]) => `<option value="${k}" ${w.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field mt-3"><span>رمز الدخول (اتركه فارغاً بدون رمز)</span><input name="p" type="password" inputmode="numeric" dir="ltr" value="${U.esc(w.pin)}" autocomplete="new-password"></label>
      ${isNew || isSelf ? '' : `<label class="check mt-3"><input type="checkbox" name="a" ${w.active === false ? '' : 'checked'}> <span>فعّال (العامل المتوقف يبقى اسمه بالسجلات القديمة)</span></label>`}`,
    { onOpen: ({ setValidator }) => setValidator((m) => (m.querySelector('[name=n]').value.trim() ? null : 'الاسم مطلوب')) });
    if (!dlg) return;
    w.name = dlg.querySelector('[name=n]').value.trim();
    if (!isSelf) w.role = dlg.querySelector('[name=r]').value;
    w.pin = dlg.querySelector('[name=p]').value.trim();
    const a = dlg.querySelector('[name=a]');
    if (a) w.active = a.checked;
    await DB.put('workers', w);
    await DB.audit(isNew ? 'إضافة عامل' : 'تعديل عامل', { name: w.name, role: w.role, active: w.active });
    await App.loadSettings();
    if (isSelf) App.user = w;
    Views.settings(el);
  }
  $('#addW').onclick = () => editWorker(null);
  el.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => editWorker(allWorkers.find((w) => w.id === b.dataset.w)); });

  /* الأعطال */
  const cats = JSON.parse(JSON.stringify(s.categories));
  function drawCats() {
    $('#cats').innerHTML = cats.map((c, i) => `<div class="cat-box">
      <div class="row gap-2"><input value="${U.esc(c.name)}" data-cn="${i}" class="grow" aria-label="اسم القسم"><button type="button" class="btn btn-ghost btn-sm" data-rm="${i}">حذف القسم</button></div>
      <textarea rows="5" data-ci="${i}" class="mt-2" aria-label="أعطال ${U.esc(c.name)}">${U.esc(c.items.join('\n'))}</textarea>
    </div>`).join('');
  }
  function collectCats() {
    el.querySelectorAll('[data-cn]').forEach((inp) => { cats[inp.dataset.cn].name = inp.value.trim(); });
    el.querySelectorAll('[data-ci]').forEach((t) => { cats[t.dataset.ci].items = t.value.split('\n').map((x) => x.trim()).filter(Boolean); });
  }
  drawCats();
  $('#cats').onclick = async (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    collectCats();
    if (await C.confirm('حذف قسم', `حذف قسم «${cats[b.dataset.rm].name}»؟`, 'حذف', true)) { cats.splice(Number(b.dataset.rm), 1); drawCats(); }
  };
  $('#addCat').onclick = () => { collectCats(); cats.push({ name: 'قسم جديد', items: [] }); drawCats(); };
  $('#saveCats').onclick = async () => {
    collectCats();
    await App.saveSettings({ categories: cats.filter((c) => c.name) });
    await DB.audit('تعديل الأعطال الجاهزة');
    U.toast('تم حفظ الأعطال');
  };
  $('#saveTypes').onclick = async () => {
    const t = $('#stypes').value.split('\n').map((x) => x.trim()).filter(Boolean);
    await App.saveSettings({ serviceTypes: t });
    await DB.audit('تعديل أنواع العمل');
    U.toast('تم الحفظ');
  };

  /* الشروط */
  $('#saveTerms').onclick = async () => {
    const t = $('#terms').value.split('\n').map((x) => x.trim()).filter(Boolean);
    await App.saveSettings({ terms: t });
    await DB.audit('تعديل الشروط والأحكام', { count: t.length });
    U.toast('تم حفظ الشروط');
  };
  $('#resetTerms').onclick = () => { $('#terms').value = DEFAULTS.terms.join('\n'); };

  /* النسخ الاحتياطي */
  $('#exp').onclick = async () => {
    const data = await DB.exportAll();
    const d = new Date();
    U.download(`ورشة-نسخة-${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}.json`, JSON.stringify(data));
    await App.saveSettings({ backupAt: Date.now() });
    await DB.audit('نسخة احتياطية', { orders: data.orders.length });
    U.toast('تم تنزيل النسخة');
    Views.settings(el);
  };
  $('#imp').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(await C.confirm('استرجاع نسخة', `راح تنمسح كل البيانات الحالية وتنستبدل بالنسخة (${(data.orders || []).length} أمر عمل). متأكد؟`, 'استرجاع', true))) return;
      await DB.importAll(data);
      await App.loadSettings();
      App.user = App.workers.find((w) => w.id === App.user.id) || null;
      await DB.audit('استرجاع نسخة احتياطية', { orders: data.orders.length });
      U.toast('تم الاسترجاع');
      App.route();
    } catch (err) {
      U.toast('الملف غير صالح: ' + err.message, 'err');
    }
  };
};

const AUDIT_KEYS = {
  no: 'أمر', plate: 'اللوحة', deposit: 'العربون', tech: 'الفني', desc: 'الوصف', cost: 'المبلغ',
  total: 'المبلغ', paid: 'المدفوع', remaining: 'المتبقي', text: 'النص', name: 'الاسم',
  role: 'الدور', active: 'فعّال', count: 'العدد', orders: 'الأوامر',
};

Views.audit = async (el) => {
  const list = (await DB.all('audit')).sort((a, b) => b.seq - a.seq);
  const v = await DB.verifyAudit();
  el.innerHTML = `
    <div class="page-head"><h1>سجل العمليات</h1></div>
    <div class="banner ${v.broken.length ? 'banner-bad' : 'banner-info'}">
      ${v.broken.length ? `⚠ السجل فيه ${v.broken.length} قيد ما يطابق البصمة (أرقام: ${v.broken.slice(0, 10).join('، ')}). يعني تم التلاعب بالبيانات خارج النظام.` : `✓ السجل سليم — ${v.count} عملية، كل وحدة مربوطة بالي قبلها.`}
    </div>
    <div class="card mt-4">
      <table class="table">
        <thead><tr><th>#</th><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th></tr></thead>
        <tbody>${list.slice(0, 500).map((e) => `<tr class="${v.broken.includes(e.seq) ? 'row-bad' : ''}">
          <td><bdi>${e.seq}</bdi></td><td class="nowrap">${U.fmtDate(e.at)}</td><td>${U.esc(e.user)}</td><td>${U.esc(e.action)}</td>
          <td class="sm">${U.esc(Object.entries(e.detail || {}).filter(([k]) => k !== 'hash').map(([k, x]) => `${AUDIT_KEYS[k] || k}: ${x === true ? 'نعم' : x === false ? 'لا' : x}`).join(' · '))}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
};
