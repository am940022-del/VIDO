/* الطباعة: عقد استلام السيارة ووصل التسليم (A4) */
'use strict';

const Print = (() => {
  function header(title, o) {
    const s = App.settings;
    return `
      <header class="p-head">
        <div class="p-brand">
          ${s.logo ? `<img src="${s.logo}" alt="" class="p-logo">` : ''}
          <div>
            <div class="p-name">${U.esc(s.name)}</div>
            <div class="p-contact">${U.esc(s.address)}${s.phone ? ` · <bdi>${U.esc(s.phone)}</bdi>` : ''}</div>
          </div>
        </div>
        <div class="p-doc">
          <div class="p-title">${title}</div>
          <div>رقم الأمر: <bdi><strong>${U.esc(o.no)}</strong></bdi></div>
          <div>${U.fmtDate(o.createdAt)}</div>
        </div>
      </header>`;
  }

  const row = (k, v) => (v === '' || v === undefined || v === null ? '' : `<tr><th>${k}</th><td>${v}</td></tr>`);

  function vehicleTable(o) {
    const v = o.vehicle;
    return `<table class="p-table p-2col">
      ${row('اسم الزبون', U.esc(o.customer.name))}
      ${row('الهاتف', `<bdi>${U.esc(o.customer.phone)}</bdi>`)}
      ${row('رقم اللوحة', `<strong>${U.esc(v.plate)}</strong>`)}
      ${row('السيارة', U.esc([v.make, v.model, v.year].filter(Boolean).join(' ')) || '—')}
      ${row('اللون', U.esc(v.color))}
      ${row('رقم الشاصي', v.vin ? `<bdi>${U.esc(v.vin)}</bdi>` : '')}
      ${row('العداد عند الاستلام', `<bdi>${Number(v.odometer).toLocaleString('en-US')} كم</bdi>`)}
      ${row('مستوى البنزين', C.fuelText(v.fuel))}
    </table>`;
  }

  function sigBox(label, img, name) {
    return `<div class="p-sig">
      <div class="p-sig-label">${label}</div>
      ${img ? `<img src="${img}" alt="">` : '<div class="p-sig-empty"></div>'}
      ${name ? `<div class="p-sig-name">${U.esc(name)}</div>` : ''}
    </div>`;
  }

  function run(html) {
    const area = document.getElementById('print-area');
    area.innerHTML = html;
    const imgs = [...area.querySelectorAll('img')];
    Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => {
      setTimeout(() => {
        window.print();
      }, 100);
    });
  }

  function intake(o) {
    const s = App.settings;
    const cur = s.currency;
    const types = Object.fromEntries(DEFAULTS.damageTypes.map((t) => [t.id, t]));
    const mainPhotos = o.photos.filter((p) => p.label !== 'إضافية');
    const extra = o.photos.filter((p) => p.label === 'إضافية');
    const dmgPhotos = o.damages.filter((x) => x.photo);

    run(`
      <div class="p-page">
        ${header('عقد استلام سيارة للصيانة', o)}

        <h3 class="p-h">بيانات الزبون والسيارة</h3>
        ${vehicleTable(o)}

        <h3 class="p-h">العمل المطلوب</h3>
        <table class="p-table"><thead><tr><th style="width:28%">القسم</th><th>الأعطال والطلبات</th></tr></thead><tbody>
          ${groupWork(o).map((g) => `<tr><td><strong>${U.esc(g.type)}</strong></td><td>${U.esc(g.items.join('، ') || '—')}</td></tr>`).join('')}
        </tbody></table>
        ${o.complaintNote ? `<p><strong>ملاحظة:</strong> ${U.esc(o.complaintNote)}</p>` : ''}

        <h3 class="p-h">حالة السيارة الخارجية</h3>
        <div class="p-damage">
          <div class="p-car">
            <span class="p-car-lbl t">الأمام</span>
            ${C.carSVG(o.damages)}
            <span class="p-car-lbl b">الخلف</span>
          </div>
          <div class="grow">
            ${o.damages.length ? `<table class="p-table"><thead><tr><th>#</th><th>النوع</th><th>الوصف</th></tr></thead><tbody>
              ${o.damages.map((x, i) => `<tr><td>${i + 1}</td><td>${(types[x.type] || {}).name || ''}</td><td>${U.esc(x.note) || '—'}</td></tr>`).join('')}
            </tbody></table>` : `<p>${o.noDamage ? 'لا توجد أضرار ظاهرة على السيارة بإقرار الزبون.' : '—'}</p>`}
            <p class="mt-2"><strong>محتويات السيارة:</strong> ${U.esc(o.belongings.join('، ') || 'لا شيء')}${o.belongingsNote ? ' — ' + U.esc(o.belongingsNote) : ''}</p>
          </div>
        </div>

        <h3 class="p-h">التقدير والعربون</h3>
        <table class="p-table p-2col">
          ${row('التكلفة التقديرية', o.estimate.cost ? U.fmtMoney(o.estimate.cost, cur) : 'تُحدد بعد الفحص')}
          ${row('موعد التسليم المتوقع', U.esc(o.estimate.date || '—'))}
          ${row('العربون المستلم', `<strong>${U.fmtMoney(o.deposit.amount, cur)}</strong> (${U.esc(o.deposit.method)})`)}
          ${row('القطع القديمة', o.oldParts === 'return' ? 'تُسلَّم للزبون' : 'تُتلف')}
        </table>

        <h3 class="p-h">الشروط والأحكام</h3>
        <ol class="p-terms">${o.terms.map((t) => `<li>${U.esc(t)}</li>`).join('')}</ol>

        <div class="p-sigs">
          ${sigBox('توقيع الزبون', o.intakeSignature, o.customer.name)}
          ${sigBox('العامل المستلم', '', o.receivedByName)}
        </div>
        <div class="p-verify">رمز التحقق: <bdi>${U.shortCode(o.intakeHash)}</bdi> · وُقّع إلكترونيًا بتاريخ ${U.fmtDate(o.createdAt)}</div>
      </div>

      <div class="p-page p-break">
        ${header('ملحق صور السيارة عند الاستلام', o)}
        <div class="p-photos">
          ${mainPhotos.map((p) => `<figure><img src="${p.data}" alt=""><figcaption>${U.esc(p.label)}</figcaption></figure>`).join('')}
          ${dmgPhotos.map((x) => `<figure><img src="${x.photo}" alt=""><figcaption>ضرر رقم ${o.damages.indexOf(x) + 1}: ${(types[x.type] || {}).name || ''}</figcaption></figure>`).join('')}
          ${extra.map((p) => `<figure><img src="${p.data}" alt=""><figcaption>صورة إضافية</figcaption></figure>`).join('')}
        </div>
        <div class="p-verify">رمز التحقق: <bdi>${U.shortCode(o.intakeHash)}</bdi></div>
      </div>`);
    DB.audit('طباعة عقد استلام', { no: o.no });
  }

  function delivery(o) {
    const s = App.settings;
    const cur = s.currency;
    const dl = o.delivery;
    const approvals = o.approvals || [];
    run(`
      <div class="p-page">
        ${header('وصل تسليم سيارة', o)}
        <h3 class="p-h">بيانات الزبون والسيارة</h3>
        ${vehicleTable(o)}

        <h3 class="p-h">العمل المنجز</h3>
        <p>${U.esc(dl.workDone)}</p>
        ${approvals.length ? `<table class="p-table mt-2"><thead><tr><th>عمل إضافي موافق عليه</th><th>المبلغ</th><th>الموافقة</th></tr></thead><tbody>
          ${approvals.map((a) => `<tr><td>${U.esc(a.desc)}</td><td>${U.fmtMoney(a.cost, cur)}</td><td>${a.method === 'signature' ? 'بتوقيع الزبون' : U.esc(a.method)} ${U.fmtDate(a.at)}</td></tr>`).join('')}
        </tbody></table>` : ''}

        <h3 class="p-h">الحساب</h3>
        <table class="p-table p-2col">
          ${row('المبلغ النهائي', `<strong>${U.fmtMoney(dl.total, cur)}</strong>`)}
          ${dl.storageFee ? row('يشمل أجرة أرضية', `${U.fmtMoney(dl.storageFee, cur)} (تأخير ${U.days(dl.storageDays)})`) : ''}
          ${row('العربون', U.fmtMoney(dl.deposit, cur))}
          ${row('المدفوع عند التسليم', `${U.fmtMoney(dl.paid, cur)} (${U.esc(dl.method)})`)}
          ${row('المتبقي على الزبون', `<strong>${U.fmtMoney(dl.remaining, cur)}</strong>`)}
        </table>

        <table class="p-table p-2col mt-2">
          ${row('العداد عند التسليم', `<bdi>${Number(dl.odometer).toLocaleString('en-US')} كم</bdi>`)}
          ${row('تاريخ التسليم', U.fmtDate(dl.at))}
          ${row('القطع القديمة', o.oldParts === 'return' ? (dl.oldPartsReturned ? 'سُلّمت للزبون' : 'لم تُسلَّم') : 'أُتلفت بناءً على طلب الزبون')}
          ${row('ملاحظات الزبون', U.esc(dl.customerNote))}
          ${s.warrantyDays ? row('الضمان على أجور العمل', `${U.days(s.warrantyDays)} (حتى ${U.fmtDate(dl.at + s.warrantyDays * 86400000, false)})`) : ''}
        </table>

        <p class="p-ack">أقرّ أنا الموقّع أدناه باستلام سيارتي رقم <strong>${U.esc(o.vehicle.plate)}</strong> بعد فحصها، وبحالة مطابقة لحالتها عند التسليم للورشة مع الأعمال المذكورة أعلاه، واستلام جميع محتوياتها.</p>

        <div class="p-sigs">
          ${sigBox('توقيع الزبون (استلام السيارة)', dl.signature, o.customer.name)}
          ${sigBox('العامل المسلّم', '', dl.byName)}
        </div>
        <div class="p-verify">رمز التحقق: <bdi>${U.shortCode(dl.hash)}</bdi> · مرتبط بعقد الاستلام <bdi>${U.shortCode(o.intakeHash)}</bdi></div>
      </div>`);
    DB.audit('طباعة وصل تسليم', { no: o.no });
  }

  return { intake, delivery };
})();
