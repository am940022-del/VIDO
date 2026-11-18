/* الشاشة الرئيسية: جرد السيارات داخل الورشة + البحث */
'use strict';

Views.home = async (el) => {
  const s = App.settings;
  const orders = (await DB.all('orders')).sort((a, b) => b.createdAt - a.createdAt);
  const inShop = orders.filter((o) => o.status !== 'delivered');
  const overdue = (o) => o.status === 'ready' && o.readyAt && U.daysBetween(o.readyAt) > s.storageDays;
  const counts = {
    inShop: inShop.length,
    working: inShop.filter((o) => o.status === 'working').length,
    ready: inShop.filter((o) => o.status === 'ready').length,
    overdue: inShop.filter(overdue).length,
  };
  const backupAge = s.backupAt ? U.daysBetween(s.backupAt) : null;
  const needBackup = orders.length && (backupAge === null || backupAge >= 7);

  el.innerHTML = `
    ${needBackup && App.isManager() ? `<div class="banner banner-warn">
      <span>${backupAge === null ? 'لم تُنشأ أي نسخة احتياطية حتى الآن.' : `أُنشئت آخر نسخة احتياطية قبل ${U.days(backupAge)}.`} البيانات محفوظة على هذا الجهاز فقط.</span>
      <a class="btn btn-sm btn-primary" href="#/settings">نسخة احتياطية</a></div>` : ''}
    <div class="page-head">
      <h1>السيارات</h1>
      <a href="#/new" class="btn btn-primary btn-lg">+ استلام سيارة</a>
    </div>
    <div class="stats">
      <div class="stat"><span class="stat-n">${counts.inShop}</span><span class="stat-l">داخل الورشة</span></div>
      <div class="stat"><span class="stat-n">${counts.working}</span><span class="stat-l">قيد العمل</span></div>
      <div class="stat"><span class="stat-n">${counts.ready}</span><span class="stat-l">جاهزة للتسليم</span></div>
      <div class="stat ${counts.overdue ? 'stat-alert' : ''}"><span class="stat-n">${counts.overdue}</span><span class="stat-l">متأخرة عن الاستلام</span></div>
    </div>
    <div class="toolbar">
      <input id="q" type="search" placeholder="ابحث برقم اللوحة أو اسم الزبون أو الهاتف أو رقم الأمر" aria-label="بحث">
      <select id="flt" aria-label="الحالة">
        <option value="shop">داخل الورشة</option>
        <option value="all">الكل</option>
        ${Object.entries(DEFAULTS.statuses).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
      </select>
    </div>
    <div id="list" class="order-list"></div>`;

  const list = el.querySelector('#list');
  const q = el.querySelector('#q');
  const flt = el.querySelector('#flt');

  function draw() {
    const term = q.value.trim().toLowerCase().replace(/\s+/g, '');
    const f = flt.value;
    const rows = orders.filter((o) => {
      if (f === 'shop' && o.status === 'delivered') return false;
      if (f !== 'shop' && f !== 'all' && o.status !== f) return false;
      if (!term) return true;
      const hay = [o.no, o.vehicle.plate, o.customer.name, o.customer.phone, o.vehicle.make, o.vehicle.model].join(' ').toLowerCase().replace(/\s+/g, '');
      return hay.includes(term);
    });
    if (!rows.length) {
      list.innerHTML = `<div class="empty">${orders.length ? 'لا توجد نتائج.' : 'لم تُستلم أي سيارة بعد. اضغط «استلام سيارة» للبدء.'}</div>`;
      return;
    }
    list.innerHTML = rows
      .map((o) => {
        const st = DEFAULTS.statuses[o.status];
        const days = U.daysBetween(o.createdAt);
        const late = overdue(o);
        const lateDays = late ? U.daysBetween(o.readyAt) - s.storageDays : 0;
        return `<a class="order-row ${late ? 'late' : ''}" href="#/order/${encodeURIComponent(o.id)}">
          <div class="or-main">
            <div class="or-title"><span class="plate">${U.esc(o.vehicle.plate)}</span> <span>${U.esc([o.vehicle.make, o.vehicle.model].filter(Boolean).join(' '))}</span></div>
            <div class="or-sub muted">${U.esc(o.customer.name)} · <bdi>${U.esc(o.customer.phone)}</bdi> · أمر <bdi>${U.esc(o.no)}</bdi></div>
            <div class="chips-inline">${(o.serviceTypes || []).map((t) => `<span class="tag">${U.esc(t)}</span>`).join('')}</div>
          </div>
          <div class="or-side">
            <span class="status ${st.cls}">${st.name}</span>
            <span class="muted sm">${o.status === 'delivered' ? 'سُلّمت ' + U.fmtDate(o.delivery && o.delivery.at, false) : days === 0 ? 'دخلت اليوم' : `منذ ${U.days(days)}`}</span>
            ${late ? `<span class="late-note">متأخرة ${U.days(lateDays)} · أجرة الأرضية ${U.fmtMoney(lateDays * s.storageFee, s.currency)}</span>` : ''}
          </div>
        </a>`;
      })
      .join('');
  }
  q.oninput = draw;
  flt.onchange = draw;
  draw();
};
