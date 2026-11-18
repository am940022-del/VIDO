/* شاشة أمر العمل: التفاصيل، الحالة، الموافقات الإضافية، الملاحظات، التسليم */
'use strict';

function integrityBadge(ok, label) {
  if (ok === null || ok === undefined) return '';
  return ok
    ? `<span class="badge badge-ok" title="البصمة مطابقة">✓ ${label} سليمة</span>`
    : `<span class="badge badge-bad" title="البيانات لا تطابق البصمة المحفوظة">⚠ ${label} معدَّلة من خارج النظام</span>`;
}

function infoTable(rows) {
  return `<dl class="info">${rows.filter((r) => r[1] !== '' && r[1] !== undefined && r[1] !== null).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

async function loadOrder(id) {
  const o = await DB.get('orders', id);
  if (!o) throw new Error('أمر العمل غير موجود');
  return o;
}

async function addEvent(o, text, auditAction, detail = {}) {
  o.events = o.events || [];
  o.events.push({ at: Date.now(), by: App.user.name, text });
  await DB.put('orders', o);
  await DB.audit(auditAction || text, { no: o.no, ...detail });
}

Views.order = async (el, id, action) => {
  const s = App.settings;
  const o = await loadOrder(id);
  const chk = await Integrity.check(o);
  const st = DEFAULTS.statuses[o.status];
  const cur = s.currency;
  const typeOf = (id2) => DEFAULTS.damageTypes.find((t) => t.id === id2) || {};
  const approvedTotal = (o.approvals || []).reduce((a, x) => a + (Number(x.cost) || 0), 0);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1><span class="plate plate-lg">${U.esc(o.vehicle.plate)}</span> ${U.esc([o.vehicle.make, o.vehicle.model, o.vehicle.year].filter(Boolean).join(' '))}</h1>
        <div class="row gap-2 wrap mt-2">
          <span class="muted">أمر رقم <bdi>${U.esc(o.no)}</bdi> · ${U.fmtDate(o.createdAt)}</span>
          <span class="status ${st.cls}">${st.name}</span>
          ${integrityBadge(chk.intake, 'بيانات الاستلام')}
          ${integrityBadge(chk.delivery, 'بيانات التسليم')}
          ${chk.approvals.includes(false) ? integrityBadge(false, 'بيانات الموافقات الإضافية') : ''}
        </div>
      </div>
      <a href="#/" class="btn btn-ghost">رجوع</a>
    </div>

    <div class="action-bar">
      ${o.status === 'received' ? '<button class="btn btn-primary" id="aStart">بدء العمل</button>' : ''}
      ${o.status === 'working' ? '<button class="btn btn-primary" id="aReady">السيارة جاهزة</button>' : ''}
      ${o.status === 'ready' ? `<a class="btn btn-primary" href="#/deliver/${encodeURIComponent(o.id)}">تسليم السيارة للزبون</a>` : ''}
      ${o.status === 'delivered' ? '<button class="btn btn-primary" id="aPrintD">طباعة وصل التسليم</button>' : ''}
      <button class="btn btn-ghost" id="aPrint">طباعة عقد الاستلام</button>
      ${o.status !== 'delivered' ? '<button class="btn btn-ghost" id="aApprove">موافقة على عمل إضافي</button>' : ''}
      <button class="btn btn-ghost" id="aNote">إضافة ملاحظة</button>
      ${o.status === 'ready' || o.status === 'working' ? '<button class="btn btn-ghost btn-sm" id="aBack">إرجاع الحالة</button>' : ''}
    </div>

    <div class="order-grid">
      <section class="card">
        <h2>الزبون والسيارة</h2>
        ${infoTable([
          ['الزبون', U.esc(o.customer.name)],
          ['الهاتف', `<bdi><a href="tel:${U.esc(o.customer.phone)}">${U.esc(o.customer.phone)}</a></bdi>`],
          ['اللون', U.esc(o.vehicle.color)],
          ['رقم الشاصي', o.vehicle.vin ? `<bdi>${U.esc(o.vehicle.vin)}</bdi>` : ''],
          ['العداد عند الاستلام', `<bdi>${Number(o.vehicle.odometer).toLocaleString('en-US')} كم</bdi>`],
          ['البنزين', C.fuelBars(o.vehicle.fuel)],
          ['المستلِم', U.esc(o.receivedByName)],
          ['الفني', o.technician ? U.esc(App.workerName(o.technician) !== '—' ? App.workerName(o.technician) : o.technicianName) : ''],
        ])}
      </section>

      <section class="card">
        <h2>العمل المطلوب</h2>
        <div class="work-groups">${groupWork(o).map((g) => `<div class="work-group">
          <span class="tag">${U.esc(g.type)}</span>
          ${g.items.length ? `<ul class="complaints">${g.items.map((t) => `<li>${U.esc(t)}</li>`).join('')}</ul>` : ''}
        </div>`).join('') || '<p class="muted">—</p>'}</div>
        ${o.complaintNote ? `<p class="mt-3"><strong>ملاحظة:</strong> ${U.esc(o.complaintNote)}</p>` : ''}
      </section>

      <section class="card">
        <h2>المبالغ</h2>
        ${infoTable([
          ['التكلفة التقديرية', o.estimate.cost ? U.fmtMoney(o.estimate.cost, cur) : 'غير محددة'],
          ['موعد التسليم المتوقع', U.esc(o.estimate.date || '—')],
          ['العربون', `${U.fmtMoney(o.deposit.amount, cur)} (${U.esc(o.deposit.method)})`],
          ['أعمال إضافية موافق عليها', approvedTotal ? U.fmtMoney(approvedTotal, cur) : ''],
          ['القطع القديمة', o.oldParts === 'return' ? 'تُسلَّم للزبون' : 'تُتلف'],
        ])}
        ${o.delivery ? `<hr>${infoTable([
          ['المبلغ النهائي', U.fmtMoney(o.delivery.total, cur)],
          ['المدفوع عند التسليم', U.fmtMoney(o.delivery.paid, cur)],
          ['المتبقي على الزبون', `<strong class="${o.delivery.remaining > 0 ? 'text-bad' : ''}">${U.fmtMoney(o.delivery.remaining, cur)}</strong>`],
        ])}` : ''}
      </section>

      <section class="card span-2">
        <h2>حالة السيارة عند الاستلام</h2>
        <div class="damage-layout">
          <div class="car-frame">
            <span class="car-label car-front">الأمام</span><span class="car-label car-right">يمين</span><span class="car-label car-left">يسار</span>
            ${C.carSVG(o.damages)}
            <span class="car-label car-back">الخلف</span>
          </div>
          <ol class="dmg-list">
            ${o.damages.length ? o.damages.map((x, i) => `<li><span class="dmg-dot" style="background:${typeOf(x.type).color}">${i + 1}</span>
              <span class="grow"><strong>${typeOf(x.type).name || ''}</strong>${x.note ? ' — ' + U.esc(x.note) : ''}</span>
              ${x.photo ? `<img src="${x.photo}" alt="صورة الضرر ${i + 1}" class="mini zoom">` : ''}</li>`).join('') : `<li class="muted">${o.noDamage ? 'لا توجد أضرار ظاهرة (بإقرار الزبون).' : '—'}</li>`}
          </ol>
        </div>
        <h3 class="mt-5">الصور</h3>
        <div class="gallery">${o.photos.map((p) => `<figure><img src="${p.data}" alt="${U.esc(p.label)}" class="zoom"><figcaption>${U.esc(p.label)}</figcaption></figure>`).join('')}</div>
        <h3 class="mt-5">محتويات السيارة</h3>
        <div class="chips-inline">${o.belongings.map((b) => `<span class="tag">${U.esc(b)}</span>`).join('') || '<span class="muted">لا شيء مسجّل</span>'}</div>
        ${o.belongingsNote ? `<p class="mt-2">${U.esc(o.belongingsNote)}</p>` : ''}
        <h3 class="mt-5">توقيع الزبون عند الاستلام</h3>
        <img src="${o.intakeSignature}" alt="توقيع الزبون" class="sig-img">
        <p class="muted sm mt-2">رمز التحقق: <bdi class="mono">${U.shortCode(o.intakeHash)}</bdi></p>
      </section>

      ${o.approvals && o.approvals.length ? `<section class="card span-2">
        <h2>أعمال إضافية موافق عليها</h2>
        <ul class="approvals">${o.approvals.map((a) => `<li>
          <div class="grow"><strong>${U.esc(a.desc)}</strong> — ${U.fmtMoney(a.cost, cur)}
          <div class="muted sm">${U.fmtDate(a.at)} · ${a.method === 'signature' ? 'بتوقيع الزبون' : 'موافقة ' + U.esc(a.method)} · سجّلها ${U.esc(a.by)}${a.note ? ' · ' + U.esc(a.note) : ''}</div></div>
          ${a.signature ? `<img src="${a.signature}" class="sig-mini" alt="توقيع">` : ''}
          ${a.proof ? `<img src="${a.proof}" class="mini zoom" alt="إثبات">` : ''}
        </li>`).join('')}</ul>
      </section>` : ''}

      ${o.delivery ? `<section class="card span-2">
        <h2>التسليم</h2>
        ${infoTable([
          ['تاريخ التسليم', U.fmtDate(o.delivery.at)],
          ['المسلِّم', U.esc(o.delivery.byName)],
          ['العداد عند التسليم', `<bdi>${Number(o.delivery.odometer).toLocaleString('en-US')} كم</bdi>`],
          ['العمل المنجز', U.esc(o.delivery.workDone)],
          ['القطع القديمة', o.oldParts === 'return' ? (o.delivery.oldPartsReturned ? 'سُلّمت للزبون' : 'لم تُسلَّم') : 'أُتلفت'],
          ['ملاحظات الزبون', U.esc(o.delivery.customerNote)],
        ])}
        <img src="${o.delivery.signature}" alt="توقيع الاستلام" class="sig-img">
        <p class="muted sm mt-2">رمز التحقق: <bdi class="mono">${U.shortCode(o.delivery.hash)}</bdi></p>
      </section>` : ''}

      <section class="card span-2">
        <h2>الملاحظات والسجل</h2>
        <ul class="timeline">
          ${[...(o.events || []).map((x) => ({ ...x, kind: 'ev' })), ...(o.notes || []).map((x) => ({ ...x, kind: 'note' }))]
            .sort((a, b) => b.at - a.at)
            .map((x) => `<li class="${x.kind}"><span class="muted sm">${U.fmtDate(x.at)} · ${U.esc(x.by)}</span><div>${U.esc(x.text)}</div></li>`).join('')}
        </ul>
      </section>
    </div>`;

  const $ = (q) => el.querySelector(q);
  const reload = () => Views.order(el, id);

  /* تكبير الصور */
  el.querySelectorAll('.zoom').forEach((img) => {
    img.onclick = () => C.modal(img.alt || 'صورة', `<img src="${img.src}" class="full-img" alt="">`, { okText: 'إغلاق', cancelText: '' });
  });

  $('#aPrint').onclick = () => Print.intake(o);
  if ($('#aPrintD')) $('#aPrintD').onclick = () => Print.delivery(o);

  if ($('#aStart')) $('#aStart').onclick = async () => {
    const dlg = await C.modal('بدء العمل', `<label class="field"><span>الفني المسؤول</span><select name="t">${App.workerOptions(App.user.id)}</select></label>`, { okText: 'ابدأ' });
    if (!dlg) return;
    o.technician = dlg.querySelector('[name=t]').value;
    o.technicianName = App.workerName(o.technician);
    o.status = 'working';
    o.startedAt = Date.now();
    await addEvent(o, `بدء العمل — الفني: ${o.technicianName}`, 'بدء العمل', { tech: o.technicianName });
    reload();
  };

  if ($('#aReady')) $('#aReady').onclick = async () => {
    const dlg = await C.modal('السيارة جاهزة', `<p>سيبدأ احتساب مهلة الاستلام (${U.days(s.storageDays)}) من الآن. يُرجى إبلاغ الزبون.</p>
      <label class="field mt-3"><span>ملاحظة (اختياري)</span><input name="n" placeholder="مثلًا: أُبلغ الزبون هاتفيًا"></label>`, { okText: 'تأكيد' });
    if (!dlg) return;
    const n = dlg.querySelector('[name=n]').value.trim();
    o.status = 'ready';
    o.readyAt = Date.now();
    await addEvent(o, 'السيارة جاهزة للتسليم' + (n ? ` — ${n}` : ''), 'السيارة جاهزة');
    reload();
  };

  if ($('#aBack')) $('#aBack').onclick = async () => {
    const to = o.status === 'ready' ? 'working' : 'received';
    const dlg = await C.modal('إرجاع الحالة', `<p>إرجاع الحالة إلى «${DEFAULTS.statuses[to].name}».</p><label class="field mt-3"><span>السبب *</span><input name="r" required></label>`, { okText: 'إرجاع' });
    if (!dlg) return;
    const r = dlg.querySelector('[name=r]').value.trim();
    if (!r) return U.toast('اكتب السبب', 'err');
    o.status = to;
    if (to !== 'ready') o.readyAt = null;
    await addEvent(o, `إرجاع الحالة إلى ${DEFAULTS.statuses[to].name} — ${r}`, 'إرجاع حالة');
    reload();
  };

  $('#aNote').onclick = async () => {
    const dlg = await C.modal('إضافة ملاحظة', '<label class="field"><span>الملاحظة</span><textarea name="n" rows="3" required></textarea></label><p class="muted sm mt-2">لا يمكن حذف الملاحظات، وتُسجَّل باسمك.</p>', { okText: 'إضافة' });
    if (!dlg) return;
    const n = dlg.querySelector('[name=n]').value.trim();
    if (!n) return;
    o.notes = o.notes || [];
    o.notes.push({ at: Date.now(), by: App.user.name, text: n });
    await DB.put('orders', o);
    await DB.audit('ملاحظة', { no: o.no, text: n });
    reload();
  };

  if ($('#aApprove')) $('#aApprove').onclick = async () => {
    let sig = null;
    let proof = '';
    const dlg = await C.modal('موافقة على عمل إضافي', `
      <p class="muted">أي عمل غير مذكور في الاستلام يتطلب موافقة الزبون قبل تنفيذه.</p>
      <label class="field mt-3"><span>العمل الإضافي *</span><input name="desc" placeholder="مثلًا: تبديل كمبريسر المكيف"></label>
      <label class="field mt-3"><span>التكلفة (${U.esc(cur)})</span><input name="cost" inputmode="numeric" dir="ltr"></label>
      <fieldset class="field mt-3"><legend>طريقة الموافقة</legend>
        <div class="row gap-4 wrap">
          <label class="check"><input type="radio" name="m" value="signature" checked> <span>توقيع الزبون (حضوريًا)</span></label>
          <label class="check"><input type="radio" name="m" value="هاتفية"> <span>بالهاتف</span></label>
          <label class="check"><input type="radio" name="m" value="واتساب"> <span>واتساب</span></label>
        </div>
      </fieldset>
      <div id="apSig" class="mt-3"></div>
      <div id="apRemote" class="mt-3" hidden>
        <label class="field"><span>تفاصيل الموافقة *</span><input name="note" placeholder="مثلًا: اتصلتُ به الساعة 3 ووافق"></label>
        <div class="mt-3">${C.photoInput('apProof', 'لقطة شاشة للمحادثة (يُفضَّل إرفاقها)')}</div>
      </div>`,
    {
      okText: 'تسجيل الموافقة',
      onOpen: ({ dlg: m, setValidator }) => {
        sig = C.signaturePad(m.querySelector('#apSig'));
        m.querySelectorAll('[name=m]').forEach((r) => {
          r.onchange = () => {
            const isSig = m.querySelector('[name=m]:checked').value === 'signature';
            m.querySelector('#apSig').hidden = !isSig;
            m.querySelector('#apRemote').hidden = isSig;
          };
        });
        const inp = m.querySelector('#apProof');
        inp.onchange = async () => {
          if (!inp.files[0]) return;
          proof = await U.processPhoto(inp.files[0], [`${s.name} — إثبات موافقة`, U.fmtDate(Date.now())]);
          m.querySelector('#apRemote .photo-preview').innerHTML = `<img src="${proof}" alt="">`;
        };
        setValidator((mm) => {
          if (!mm.querySelector('[name=desc]').value.trim()) return 'اكتب العمل الإضافي';
          const meth = mm.querySelector('[name=m]:checked').value;
          if (meth === 'signature' && sig.isEmpty()) return 'توقيع الزبون مطلوب';
          if (meth !== 'signature' && !mm.querySelector('[name=note]').value.trim()) return 'اكتب تفاصيل الموافقة';
          return null;
        });
      },
    });
    if (!dlg) return;
    const method = dlg.querySelector('[name=m]:checked').value;
    const a = {
      at: Date.now(),
      by: App.user.name,
      desc: dlg.querySelector('[name=desc]').value.trim(),
      cost: Number(dlg.querySelector('[name=cost]').value.replace(/[^\d.]/g, '')) || 0,
      method,
      signature: method === 'signature' ? sig.toDataURL() : '',
      note: method === 'signature' ? '' : dlg.querySelector('[name=note]').value.trim(),
      proof: method === 'signature' ? '' : proof,
    };
    a.hash = await U.hashObj(a);
    o.approvals = o.approvals || [];
    o.approvals.push(a);
    await addEvent(o, `موافقة على عمل إضافي: ${a.desc} (${U.fmtMoney(a.cost, cur)})`, 'موافقة عمل إضافي', { desc: a.desc, cost: a.cost, hash: a.hash });
    reload();
  };

  if (action === 'print') {
    history.replaceState(null, '', `#/order/${encodeURIComponent(o.id)}`);
    const p = await C.confirm('تم حفظ الاستلام', `رقم أمر العمل ${o.no}. هل تريد طباعة عقد الاستلام الآن؟`, 'طباعة');
    if (p) Print.intake(o);
  }
};

/* ---------- تسليم السيارة ---------- */
Views.deliver = async (el, id) => {
  const s = App.settings;
  const cur = s.currency;
  const o = await loadOrder(id);
  if (o.status === 'delivered') { location.hash = `#/order/${encodeURIComponent(id)}`; return; }

  const approvedTotal = (o.approvals || []).reduce((a, x) => a + (Number(x.cost) || 0), 0);
  const lateDays = o.readyAt ? Math.max(0, U.daysBetween(o.readyAt) - s.storageDays) : 0;
  const storage = lateDays * s.storageFee;
  const suggested = (o.estimate.cost || 0) + approvedTotal + storage;

  el.innerHTML = `
    <div class="page-head">
      <h1>تسليم السيارة <span class="plate">${U.esc(o.vehicle.plate)}</span></h1>
      <a href="#/order/${encodeURIComponent(o.id)}" class="btn btn-ghost">رجوع</a>
    </div>
    <form id="f" class="stack-lg" novalidate>
      <section class="card">
        <h2>العمل المنجز</h2>
        <label class="field"><span>وصف مختصر *</span><textarea name="work" rows="3">${U.esc([...o.complaints.map((c) => c.text), ...(o.approvals || []).map((a) => a.desc)].join('، '))}</textarea></label>
        <div class="grid-2 mt-4">
          <label class="field"><span>العداد عند التسليم (كم) *</span><input name="odo" inputmode="numeric" dir="ltr" value="${U.esc(o.vehicle.odometer)}"></label>
          <label class="field"><span>العامل المسلِّم</span><select name="by">${App.workerOptions(App.user.id)}</select></label>
        </div>
        ${o.oldParts === 'return' ? '<label class="check mt-4"><input type="checkbox" name="oldParts" checked> <span>تم تسليم القطع القديمة للزبون</span></label>' : ''}
      </section>

      <section class="card">
        <h2>الحساب</h2>
        ${infoTable([
          ['التكلفة التقديرية', U.fmtMoney(o.estimate.cost, cur)],
          ['أعمال إضافية موافق عليها', U.fmtMoney(approvedTotal, cur)],
          ['أجرة أرضية', lateDays ? `${U.fmtMoney(storage, cur)} (تأخير ${U.days(lateDays)})` : 'لا يوجد'],
          ['العربون المدفوع', U.fmtMoney(o.deposit.amount, cur)],
        ])}
        <div class="grid-2 mt-4">
          <label class="field"><span>المبلغ النهائي (${U.esc(cur)}) *</span><input name="total" inputmode="numeric" dir="ltr" value="${suggested}"></label>
          <label class="field"><span>المدفوع الآن (${U.esc(cur)})</span><input name="paid" inputmode="numeric" dir="ltr" value="${Math.max(0, suggested - o.deposit.amount)}"></label>
          <label class="field"><span>طريقة الدفع</span><select name="method"><option>نقدًا</option><option>تحويل</option><option>بطاقة</option></select></label>
          <div class="field"><span>المتبقي على الزبون</span><output id="rem" class="big-num"></output></div>
        </div>
      </section>

      <section class="card">
        <h2>إقرار وتوقيع الزبون</h2>
        <p class="ack">أقرّ أنا الموقّع أدناه باستلام سيارتي رقم <strong>${U.esc(o.vehicle.plate)}</strong> بعد فحصها، وبحالة مطابقة لحالتها عند التسليم للورشة مع الأعمال المذكورة أعلاه، واستلام جميع محتوياتها.</p>
        <label class="field mt-4"><span>ملاحظات الزبون (اختياري)</span><input name="cnote"></label>
        <div class="mt-4"><span class="field-label">توقيع الزبون *</span><div id="sig"></div></div>
      </section>

      <div class="sticky-actions"><button class="btn btn-primary btn-lg" id="save">تأكيد التسليم وقفل الأمر</button></div>
    </form>`;

  const f = el.querySelector('#f');
  const num = (n) => Number(String(f[n].value).replace(/[^\d.]/g, '')) || 0;
  const rem = () => num('total') - o.deposit.amount - num('paid');
  const drawRem = () => {
    const r = rem();
    const out = el.querySelector('#rem');
    out.textContent = U.fmtMoney(r, cur);
    out.className = 'big-num ' + (r > 0 ? 'text-bad' : r < 0 ? 'text-warn' : 'text-ok');
  };
  f.total.oninput = drawRem;
  f.paid.oninput = drawRem;
  drawRem();
  const sig = C.signaturePad(el.querySelector('#sig'));

  f.onsubmit = async (e) => {
    e.preventDefault();
    const errs = [];
    if (!f.work.value.trim()) errs.push('وصف العمل المنجز');
    if (!f.odo.value.trim()) errs.push('قراءة العداد');
    if (!num('total') && num('total') !== 0) errs.push('المبلغ النهائي');
    if (sig.isEmpty()) errs.push('توقيع الزبون');
    if (errs.length) return C.modal('توجد معلومات ناقصة', `<ul class="err-list">${errs.map((x) => `<li>${x}</li>`).join('')}</ul>`, { okText: 'حسنًا', cancelText: '' });
    if (num('odo') < o.vehicle.odometer && !(await C.confirm('تنبيه', 'قراءة العداد أقل من قراءته عند الاستلام. هل أنت متأكد؟'))) return;
    const r = rem();
    if (r > 0 && !(await C.confirm('مبلغ متبقٍّ', `يتبقى على الزبون ${U.fmtMoney(r, cur)}، وسيُسجَّل دَينًا عليه. هل تريد إكمال التسليم؟`, 'نعم، أكمل التسليم'))) return;
    if (r < 0 && !(await C.confirm('مبلغ زائد', `المبلغ المدفوع يزيد على المطلوب بمقدار ${U.fmtMoney(-r, cur)}. هل تريد المتابعة؟`))) return;

    const by = f.by.value;
    o.delivery = {
      at: Date.now(),
      by,
      byName: App.workerName(by),
      workDone: f.work.value.trim(),
      odometer: num('odo'),
      total: num('total'),
      deposit: o.deposit.amount,
      paid: num('paid'),
      method: f.method.value,
      remaining: r,
      storageDays: lateDays,
      storageFee: storage,
      oldPartsReturned: f.oldParts ? f.oldParts.checked : false,
      customerNote: f.cnote.value.trim(),
      signature: sig.toDataURL(),
    };
    o.delivery.hash = await U.hashObj({ ...o.delivery, intakeHash: o.intakeHash });
    o.status = 'delivered';
    await addEvent(o, `تسليم السيارة للزبون — المبلغ ${U.fmtMoney(o.delivery.total, cur)}${r > 0 ? `، متبقي ${U.fmtMoney(r, cur)}` : ''}`, 'تسليم سيارة', {
      total: o.delivery.total, paid: o.delivery.paid, remaining: r, hash: o.delivery.hash,
    });
    U.toast('تم التسليم');
    location.hash = `#/order/${encodeURIComponent(o.id)}`;
    setTimeout(async () => {
      if (await C.confirm('تم التسليم', 'هل تريد طباعة وصل التسليم؟', 'طباعة')) Print.delivery(o);
    }, 300);
  };
};
