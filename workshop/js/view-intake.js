/* شاشة استلام سيارة جديدة (أمر عمل + عقد استلام) */
'use strict';

/* الحقول التي تدخل في بصمة الاستلام — أي تغيير عليها بعد الحفظ ينكشف */
const Integrity = {
  intakePayload(o) {
    return {
      no: o.no, createdAt: o.createdAt, customer: o.customer, vehicle: o.vehicle,
      serviceTypes: o.serviceTypes, complaints: o.complaints, complaintNote: o.complaintNote,
      damages: o.damages, noDamage: o.noDamage, photos: o.photos,
      belongings: o.belongings, belongingsNote: o.belongingsNote,
      estimate: o.estimate, deposit: o.deposit, oldParts: o.oldParts,
      receivedBy: o.receivedBy, receivedByName: o.receivedByName,
      terms: o.terms, termsAccepted: o.termsAccepted, intakeSignature: o.intakeSignature,
    };
  },
  async check(o) {
    const r = { intake: null, delivery: null, approvals: [] };
    if (o.intakeHash) r.intake = (await U.hashObj(this.intakePayload(o))) === o.intakeHash;
    if (o.delivery && o.delivery.hash) r.delivery = (await U.hashObj({ ...o.delivery, hash: undefined, intakeHash: o.intakeHash })) === o.delivery.hash;
    for (const a of o.approvals || []) r.approvals.push((await U.hashObj({ ...a, hash: undefined })) === a.hash);
    return r;
  },
};

const plateKey = (p) => String(p || '').replace(/[\s\-_.]/g, '').toLowerCase();

Views.intake = async (el) => {
  const s = App.settings;
  const d = {
    serviceTypes: [], complaints: [], damages: [], photos: {}, extraPhotos: [], belongings: [],
  };
  const stamp = (label) => [`${s.name} — صورة استلام: ${label}`, U.fmtDate(Date.now()) + (d.plate ? ` — ${d.plate}` : '')];

  el.innerHTML = `
    <div class="page-head"><h1>استلام سيارة</h1><a href="#/" class="btn btn-ghost">إلغاء</a></div>
    <form id="f" class="stack-lg" novalidate>

      <section class="card">
        <h2>الزبون والسيارة</h2>
        <div class="grid-2">
          <label class="field"><span>رقم الهاتف *</span><input name="phone" inputmode="tel" dir="ltr" required autocomplete="off"></label>
          <label class="field"><span>اسم الزبون *</span><input name="cname" required autocomplete="off"></label>
          <label class="field"><span>رقم اللوحة *</span><input name="plate" required autocomplete="off"></label>
          <label class="field"><span>الشركة</span><input name="make" placeholder="تويوتا، كيا، هيونداي…" autocomplete="off"></label>
          <label class="field"><span>الموديل</span><input name="model" placeholder="كامري، سوناتا…" autocomplete="off"></label>
          <label class="field"><span>سنة الصنع</span><input name="year" inputmode="numeric" dir="ltr" autocomplete="off"></label>
          <label class="field"><span>اللون</span><input name="color" autocomplete="off"></label>
          <label class="field"><span>رقم الشاصي (اختياري)</span><input name="vin" dir="ltr" autocomplete="off"></label>
        </div>
        <div id="history" class="mt-4"></div>
        <div class="grid-2 mt-4">
          <label class="field"><span>قراءة العداد (كم) *</span><input name="odometer" inputmode="numeric" dir="ltr" required></label>
          <div class="field"><span>مستوى البانزين</span>
            <div class="fuel-input"><input type="range" name="fuel" min="0" max="8" value="4" aria-label="مستوى البانزين"><output id="fuelOut">${C.fuelBars(4)}</output></div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>نوع العمل</h2>
        <div class="chips" id="stypes">
          ${s.serviceTypes.map((t) => `<button type="button" class="chip" data-v="${U.esc(t)}">${U.esc(t)}</button>`).join('')}
        </div>
      </section>

      <section class="card">
        <h2>الأعطال والطلبات</h2>
        <p class="muted">اختر من القائمة، أو أضف عطلاً غير موجود.</p>
        <div class="selected-box" id="cSel"></div>
        <div class="cat-tabs" id="catTabs" role="tablist">
          ${s.categories.map((c, i) => `<button type="button" role="tab" class="cat-tab ${i ? '' : 'active'}" data-i="${i}">${U.esc(c.name)}</button>`).join('')}
        </div>
        <div class="chips mt-3" id="catItems"></div>
        <div class="row gap-2 mt-4">
          <input id="customC" placeholder="عطل آخر…" class="grow" autocomplete="off">
          <button type="button" class="btn btn-ghost" id="addC">إضافة</button>
        </div>
        <label class="field mt-4"><span>ملاحظة قصيرة (اختياري)</span><input name="cnote" maxlength="200" placeholder="مثلاً: الصوت يطلع بس بالبرد" autocomplete="off"></label>
      </section>

      <section class="card">
        <h2>حالة السيارة الخارجية</h2>
        <p class="muted">اضغط على مكان الخدش أو الطعجة في الرسم وصوّره.</p>
        <div class="damage-layout">
          <div id="car"></div>
          <div>
            <ol id="dmgList" class="dmg-list"></ol>
            <label class="check mt-4" id="noDmgWrap"><input type="checkbox" name="noDamage"> <span>لا توجد أضرار ظاهرة على السيارة</span></label>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>صور السيارة</h2>
        <p class="muted">الجهات الأربع إلزامية. كل صورة ينطبع عليها التاريخ والوقت.</p>
        <div class="photo-grid" id="photos">
          ${DEFAULTS.photoSlots.map((p, i) => C.photoInput('ph' + i, p + (i < 4 ? ' *' : ''))).join('')}
        </div>
        <div class="mt-4">
          <label class="btn btn-ghost" for="phx">+ صور إضافية<input type="file" id="phx" accept="image/*" capture="environment" multiple hidden></label>
          <div class="thumbs mt-3" id="extra"></div>
        </div>
      </section>

      <section class="card">
        <h2>محتويات السيارة</h2>
        <div class="chips" id="belong">
          ${DEFAULTS.belongings.map((t) => `<button type="button" class="chip" data-v="${U.esc(t)}">${U.esc(t)}</button>`).join('')}
        </div>
        <label class="field mt-4"><span>ملاحظات على المحتويات</span><input name="bnote" placeholder="مثلاً: نظارة شمسية بالدرج" autocomplete="off"></label>
      </section>

      <section class="card">
        <h2>التقدير والعربون</h2>
        <div class="grid-2">
          <label class="field"><span>التكلفة التقديرية (${U.esc(s.currency)})</span><input name="estCost" inputmode="numeric" dir="ltr"></label>
          <label class="field"><span>موعد التسليم المتوقع</span><input name="estDate" type="date"></label>
          <label class="field"><span>العربون (${U.esc(s.currency)})</span><input name="deposit" inputmode="numeric" dir="ltr" value="0"></label>
          <label class="field"><span>طريقة الدفع</span><select name="depMethod"><option>نقداً</option><option>تحويل</option><option>بطاقة</option></select></label>
        </div>
        <fieldset class="field mt-4"><legend>القطع القديمة بعد التبديل</legend>
          <div class="row gap-4">
            <label class="check"><input type="radio" name="oldParts" value="return" checked> <span>تُسلَّم للزبون</span></label>
            <label class="check"><input type="radio" name="oldParts" value="dispose"> <span>تُتلف</span></label>
          </div>
        </fieldset>
        <label class="field mt-4"><span>العامل المستلم *</span><select name="receivedBy">${App.workerOptions(App.user.id)}</select></label>
      </section>

      <section class="card">
        <h2>الشروط وتوقيع الزبون</h2>
        <ol class="terms">${App.resolvedTerms().map((t) => `<li>${U.esc(t)}</li>`).join('')}</ol>
        <label class="check mt-4"><input type="checkbox" name="accept"> <span>قرأ الزبون الشروط أعلاه ووافق عليها، وأقرّ بصحة حالة السيارة المسجلة.</span></label>
        <div class="mt-4"><span class="field-label">توقيع الزبون *</span><div id="sig"></div></div>
      </section>

      <div class="sticky-actions">
        <button class="btn btn-primary btn-lg" id="save">حفظ الاستلام وقفله</button>
      </div>
    </form>`;

  const f = el.querySelector('#f');
  const $ = (sel) => el.querySelector(sel);

  /* البانزين */
  f.fuel.oninput = () => { $('#fuelOut').innerHTML = C.fuelBars(f.fuel.value); };

  /* شرائح قابلة للتبديل */
  function toggleChips(container, arr) {
    container.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const v = b.dataset.v;
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      b.classList.toggle('on', i < 0);
      b.setAttribute('aria-pressed', i < 0);
    });
  }
  toggleChips($('#stypes'), d.serviceTypes);
  toggleChips($('#belong'), d.belongings);

  /* الأعطال */
  let catIdx = 0;
  function drawCat() {
    const c = s.categories[catIdx];
    $('#catItems').innerHTML = c.items
      .map((t) => `<button type="button" class="chip ${d.complaints.some((x) => x.text === t && x.cat === c.name) ? 'on' : ''}" data-v="${U.esc(t)}">${U.esc(t)}</button>`)
      .join('');
  }
  function drawSel() {
    $('#cSel').innerHTML = d.complaints.length
      ? d.complaints.map((c, i) => `<span class="chip on removable" data-i="${i}">${U.esc(c.text)} <small>${U.esc(c.cat)}</small><button type="button" aria-label="حذف">×</button></span>`).join('')
      : '<span class="muted">ما اخترت أي عطل بعد</span>';
  }
  $('#catTabs').onclick = (e) => {
    const b = e.target.closest('.cat-tab');
    if (!b) return;
    catIdx = Number(b.dataset.i);
    el.querySelectorAll('.cat-tab').forEach((t) => t.classList.toggle('active', t === b));
    drawCat();
  };
  $('#catItems').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const cat = s.categories[catIdx].name;
    const i = d.complaints.findIndex((x) => x.text === b.dataset.v && x.cat === cat);
    if (i >= 0) d.complaints.splice(i, 1); else d.complaints.push({ cat, text: b.dataset.v });
    drawCat(); drawSel();
  };
  $('#cSel').onclick = (e) => {
    const x = e.target.closest('button');
    if (!x) return;
    d.complaints.splice(Number(x.parentElement.dataset.i), 1);
    drawCat(); drawSel();
  };
  const addCustom = () => {
    const v = $('#customC').value.trim();
    if (!v) return;
    d.complaints.push({ cat: 'أخرى', text: v });
    $('#customC').value = '';
    drawSel();
  };
  $('#addC').onclick = addCustom;
  $('#customC').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } };
  drawCat(); drawSel();

  /* سجل السيارة والزبون */
  async function lookupPlate() {
    const pk = plateKey(f.plate.value);
    d.plate = f.plate.value.trim();
    if (!pk) { $('#history').innerHTML = ''; return; }
    const prev = (await DB.byIndex('orders', 'plate', pk)).sort((a, b) => b.createdAt - a.createdAt);
    if (!prev.length) { $('#history').innerHTML = ''; return; }
    const last = prev[0];
    ['make', 'model', 'year', 'color', 'vin'].forEach((k) => { if (!f[k].value && last.vehicle[k]) f[k].value = last.vehicle[k]; });
    if (!f.cname.value) f.cname.value = last.customer.name;
    if (!f.phone.value) f.phone.value = last.customer.phone;
    const open = prev.find((o) => o.status !== 'delivered');
    $('#history').innerHTML = `<div class="banner ${open ? 'banner-warn' : 'banner-info'}">
      <span>${open ? `انتبه: هذه السيارة موجودة حالياً داخل الورشة (أمر <bdi>${U.esc(open.no)}</bdi>).` : `هذه السيارة زارت الورشة ${prev.length} مرة، آخرها ${U.fmtDate(last.createdAt, false)}: ${U.esc(last.complaints.map((c) => c.text).slice(0, 3).join('، '))}.`}</span>
      <a class="btn btn-sm btn-ghost" href="#/order/${encodeURIComponent((open || last).id)}" target="_blank">عرض</a></div>`;
  }
  async function lookupPhone() {
    const ph = f.phone.value.trim();
    if (!ph || f.cname.value) return;
    const prev = await DB.byIndex('orders', 'phone', ph);
    if (prev.length) f.cname.value = prev[prev.length - 1].customer.name;
  }
  f.plate.addEventListener('change', lookupPlate);
  f.phone.addEventListener('change', lookupPhone);

  /* الأضرار */
  const typeName = (id) => (DEFAULTS.damageTypes.find((t) => t.id === id) || {}).name || '';
  const typeOptions = (sel) => DEFAULTS.damageTypes.map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.name}</option>`).join('');
  function drawDamages() {
    car.render();
    $('#dmgList').innerHTML = d.damages.length
      ? d.damages.map((x, i) => `<li><span class="dmg-dot" style="background:${(DEFAULTS.damageTypes.find((t) => t.id === x.type) || {}).color}">${i + 1}</span>
          <span class="grow"><strong>${typeName(x.type)}</strong>${x.note ? ' — ' + U.esc(x.note) : ''}</span>
          ${x.photo ? `<img src="${x.photo}" alt="" class="mini">` : '<span class="muted sm">بدون صورة</span>'}
          <button type="button" class="btn btn-ghost btn-sm" data-i="${i}">تعديل</button></li>`).join('')
      : '<li class="muted">ما مسجّل أي ضرر.</li>';
    $('#noDmgWrap').hidden = d.damages.length > 0;
  }
  async function editDamage(i, pos) {
    const isNew = i === null;
    const cur = isNew ? { ...pos, type: 'scratch', note: '', photo: '' } : { ...d.damages[i] };
    let photo = cur.photo;
    const dlg = await C.modal(isNew ? 'تسجيل ضرر' : `الضرر رقم ${i + 1}`, `
      <label class="field"><span>النوع</span><select name="type">${typeOptions(cur.type)}</select></label>
      <label class="field mt-3"><span>وصف (اختياري)</span><input name="note" value="${U.esc(cur.note)}" placeholder="مثلاً: باب السائق، خدش 10 سم"></label>
      <div class="mt-3">${C.photoInput('dmgPh', 'صورة الضرر')}</div>
      ${isNew ? '' : '<label class="check mt-3"><input type="checkbox" name="remove"> <span>حذف هذا الضرر</span></label>'}`,
    {
      onOpen: ({ dlg: m }) => {
        const inp = m.querySelector('#dmgPh');
        const prev = m.querySelector('.photo-preview');
        if (photo) prev.innerHTML = `<img src="${photo}" alt="">`;
        inp.onchange = async () => {
          if (!inp.files[0]) return;
          prev.innerHTML = '<span class="muted sm">جاري المعالجة…</span>';
          photo = await U.processPhoto(inp.files[0], stamp('ضرر'));
          prev.innerHTML = `<img src="${photo}" alt="">`;
        };
      },
    });
    if (!dlg) return;
    if (!isNew && dlg.querySelector('[name=remove]').checked) d.damages.splice(i, 1);
    else {
      const v = { x: cur.x, y: cur.y, type: dlg.querySelector('[name=type]').value, note: dlg.querySelector('[name=note]').value.trim(), photo };
      if (isNew) d.damages.push(v); else d.damages[i] = v;
    }
    drawDamages();
  }
  const car = C.carDiagram($('#car'), d.damages, (pos) => editDamage(null, pos), (i) => editDamage(i));
  $('#dmgList').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) editDamage(Number(b.dataset.i)); };
  drawDamages();

  /* الصور */
  DEFAULTS.photoSlots.forEach((label, i) => {
    const inp = $('#ph' + i);
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      const prev = inp.parentElement.querySelector('.photo-preview');
      prev.innerHTML = '<span class="muted sm">جاري المعالجة…</span>';
      d.photos[label] = await U.processPhoto(inp.files[0], stamp(label));
      prev.innerHTML = `<img src="${d.photos[label]}" alt="">`;
      inp.parentElement.classList.add('has');
    };
  });
  $('#phx').onchange = async (e) => {
    for (const file of e.target.files) d.extraPhotos.push(await U.processPhoto(file, stamp('إضافية')));
    e.target.value = '';
    drawExtra();
  };
  function drawExtra() {
    $('#extra').innerHTML = d.extraPhotos.map((p, i) => `<span class="thumb"><img src="${p}" alt=""><button type="button" data-i="${i}" aria-label="حذف">×</button></span>`).join('');
  }
  $('#extra').onclick = (e) => { const b = e.target.closest('button'); if (b) { d.extraPhotos.splice(Number(b.dataset.i), 1); drawExtra(); } };

  /* التوقيع */
  const sig = C.signaturePad($('#sig'));

  /* الحفظ */
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = (n) => (f[n].value || '').trim();
    const num = (n) => Number(v(n).replace(/[^\d.]/g, '')) || 0;
    const errs = [];
    if (!v('phone')) errs.push('رقم الهاتف');
    if (!v('cname')) errs.push('اسم الزبون');
    if (!v('plate')) errs.push('رقم اللوحة');
    if (!v('odometer')) errs.push('قراءة العداد');
    if (!d.complaints.length && !d.serviceTypes.length) errs.push('نوع العمل أو عطل واحد على الأقل');
    if (!d.damages.length && !f.noDamage.checked) errs.push('سجّل الأضرار أو أشّر «لا توجد أضرار»');
    const missing = DEFAULTS.photoSlots.slice(0, 4).filter((p) => !d.photos[p]);
    if (missing.length) errs.push('صور: ' + missing.join('، '));
    if (!f.accept.checked) errs.push('موافقة الزبون على الشروط');
    if (sig.isEmpty()) errs.push('توقيع الزبون');
    if (errs.length) {
      await C.modal('باقي معلومات ناقصة', `<ul class="err-list">${errs.map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>`, { okText: 'تمام', cancelText: '' });
      return;
    }
    const ok = await C.confirm('قفل الاستلام', 'بعد الحفظ ما يمكن تعديل بيانات الاستلام (الصور والأضرار والتوقيع). أي إضافة لاحقة تنسجل كملاحظة باسمك. متأكد؟', 'احفظ واقفل');
    if (!ok) return;

    const btn = $('#save');
    btn.disabled = true;
    btn.textContent = 'جاري الحفظ…';
    try {
      const receivedBy = f.receivedBy.value;
      const order = {
        id: U.uid(),
        createdAt: Date.now(),
        status: 'received',
        customer: { name: v('cname'), phone: v('phone') },
        vehicle: {
          plate: v('plate'), plateKey: plateKey(v('plate')), make: v('make'), model: v('model'), year: v('year'),
          color: v('color'), vin: v('vin'), odometer: num('odometer'), fuel: Number(f.fuel.value),
        },
        serviceTypes: [...d.serviceTypes],
        complaints: [...d.complaints],
        complaintNote: v('cnote'),
        damages: d.damages.map((x) => ({ ...x })),
        noDamage: !d.damages.length && f.noDamage.checked,
        photos: [
          ...DEFAULTS.photoSlots.filter((p) => d.photos[p]).map((p) => ({ label: p, data: d.photos[p] })),
          ...d.extraPhotos.map((p) => ({ label: 'إضافية', data: p })),
        ],
        belongings: [...d.belongings],
        belongingsNote: v('bnote'),
        estimate: { cost: num('estCost'), date: v('estDate') },
        deposit: { amount: num('deposit'), method: f.depMethod.value },
        oldParts: f.oldParts.value,
        receivedBy,
        receivedByName: App.workerName(receivedBy),
        terms: App.resolvedTerms(),
        termsAccepted: true,
        intakeSignature: sig.toDataURL(),
        approvals: [],
        notes: [],
        events: [{ at: Date.now(), by: App.user.name, text: 'استلام السيارة' }],
      };
      await DB.createOrder(order);
      order.intakeHash = await U.hashObj(Integrity.intakePayload(order));
      await DB.put('orders', order);
      await DB.audit('استلام سيارة', { no: order.no, plate: order.vehicle.plate, hash: order.intakeHash, deposit: order.deposit.amount });
      U.toast(`تم حفظ الاستلام — أمر رقم ${order.no}`);
      location.hash = `#/order/${encodeURIComponent(order.id)}/print`;
    } catch (err) {
      console.error(err);
      U.toast('تعذّر الحفظ: ' + (err.message || err), 'err');
      btn.disabled = false;
      btn.textContent = 'حفظ الاستلام وقفله';
    }
  };
};
