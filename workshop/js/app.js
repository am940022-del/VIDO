/* نواة التطبيق: الإعدادات، المستخدم الحالي، التنقل بين الشاشات */
'use strict';

const Views = {};

const App = {
  user: null,
  settings: null,
  workers: [],

  async loadSettings() {
    const s = await DB.get('kv', 'settings');
    this.settings = Object.assign(
      {
        ...DEFAULTS.settings,
        categories: JSON.parse(JSON.stringify(DEFAULTS.categories)),
        terms: [...DEFAULTS.terms],
        serviceTypes: [...DEFAULTS.serviceTypes],
      },
      s || {}
    );
    this.workers = (await DB.all('workers')).filter((w) => w.active !== false);
  },

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await DB.put('kv', { ...this.settings, id: 'settings' });
  },

  isManager() { return this.user && this.user.role === 'manager'; },

  workerName(id) {
    const w = this.workers.find((x) => x.id === id);
    return w ? w.name : '—';
  },

  workerOptions(selected, roles) {
    return this.workers
      .filter((w) => !roles || roles.includes(w.role))
      .map((w) => `<option value="${U.esc(w.id)}" ${w.id === selected ? 'selected' : ''}>${U.esc(w.name)} — ${DEFAULTS.roles[w.role] || ''}</option>`)
      .join('');
  },

  /* الشروط بعد تعويض الأرقام من الإعدادات */
  resolvedTerms() {
    const s = this.settings;
    return s.terms.map((t) =>
      t
        .replace(/\{أيام_الاستلام\}/g, s.storageDays)
        .replace(/\{أجرة_الأرضية\}/g, U.fmtMoney(s.storageFee, s.currency))
        .replace(/\{أيام_الضمان\}/g, s.warrantyDays)
    );
  },

  go(hash) { location.hash = hash; },

  async route() {
    const view = document.getElementById('view');
    const hash = location.hash.replace(/^#\/?/, '');
    const [name, ...params] = hash.split('/');

    if (!this.settings.name || !this.workers.length) return this.show('setup', view, []);
    if (!this.user) return this.show('login', view, []);

    const map = { '': 'home', new: 'intake', order: 'order', deliver: 'deliver', settings: 'settings', audit: 'audit' };
    let v = map[name] || 'home';
    if ((v === 'settings' || v === 'audit') && !this.isManager()) {
      U.toast('هذه الصفحة للمدير فقط', 'err');
      v = 'home';
    }
    this.show(v, view, params.map(decodeURIComponent));
  },

  async show(v, view, params) {
    this.renderHeader(v);
    view.innerHTML = '<div class="loading">جاري التحميل…</div>';
    window.scrollTo(0, 0);
    try {
      await Views[v](view, ...params);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="card"><h2>حدث خطأ</h2><p class="muted">${U.esc(e.message || e)}</p><a class="btn btn-ghost" href="#/">الرجوع للرئيسية</a></div>`;
    }
  },

  renderHeader(active) {
    const h = document.getElementById('header');
    const s = this.settings;
    if (!this.user) {
      h.innerHTML = `<div class="hdr-inner"><div class="brand">${s.logo ? `<img src="${s.logo}" alt="">` : ''}<span>${U.esc(s.name || 'نظام الورشة')}</span></div></div>`;
      return;
    }
    const link = (href, key, text) => `<a href="${href}" class="nav-link ${active === key ? 'active' : ''}">${text}</a>`;
    h.innerHTML = `
      <div class="hdr-inner">
        <a href="#/" class="brand">${s.logo ? `<img src="${s.logo}" alt="">` : ''}<span>${U.esc(s.name)}</span></a>
        <nav class="nav">
          ${link('#/', 'home', 'السيارات')}
          ${link('#/new', 'intake', 'استلام جديد')}
          ${this.isManager() ? link('#/settings', 'settings', 'الإعدادات') + link('#/audit', 'audit', 'السجل') : ''}
        </nav>
        <div class="user-chip">
          <span>${U.esc(this.user.name)}</span>
          <button class="btn btn-ghost btn-sm" id="logout">خروج</button>
        </div>
      </div>`;
    h.querySelector('#logout').onclick = () => {
      DB.audit('تسجيل خروج');
      this.user = null;
      U.ss.del('user');
      this.route();
    };
  },

  async init() {
    await DB.open();
    await this.loadSettings();
    const saved = U.ss.get('user');
    if (saved) this.user = this.workers.find((w) => w.id === saved) || null;
    window.addEventListener('hashchange', () => this.route());
    this.route();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },
};

/* ---------- الإعداد الأول ---------- */
Views.setup = async (el) => {
  el.innerHTML = `
    <section class="card narrow">
      <h1>أهلاً بك في نظام الورشة</h1>
      <p class="muted">خطوة واحدة قبل البدء: معلومات الورشة وحساب المدير.</p>
      <form id="f" class="stack mt-5">
        <label class="field"><span>اسم الورشة *</span><input name="name" required></label>
        <label class="field"><span>رقم الهاتف</span><input name="phone" inputmode="tel" dir="ltr"></label>
        <label class="field"><span>العنوان</span><input name="address"></label>
        <hr>
        <label class="field"><span>اسم المدير *</span><input name="manager" required></label>
        <label class="field"><span>رمز الدخول (اختياري، 4 أرقام أو أكثر)</span><input name="pin" inputmode="numeric" type="password" dir="ltr" autocomplete="new-password"></label>
        <button class="btn btn-primary btn-lg">ابدأ</button>
      </form>
    </section>`;
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await App.saveSettings({ name: f.get('name').trim(), phone: f.get('phone').trim(), address: f.get('address').trim() });
    const w = { id: U.uid(), name: f.get('manager').trim(), role: 'manager', pin: f.get('pin').trim(), active: true };
    await DB.put('workers', w);
    App.workers = [w];
    App.user = w;
    U.ss.set('user', w.id);
    await DB.audit('إعداد الورشة', { name: App.settings.name });
    location.hash = '#/';
    App.route();
  };
};

/* ---------- تسجيل الدخول ---------- */
Views.login = async (el) => {
  el.innerHTML = `
    <section class="card narrow">
      <h1>منو يشتغل هسه؟</h1>
      <p class="muted">اختر اسمك حتى تنسجل كل عملية باسمك.</p>
      <div class="worker-grid mt-5">
        ${App.workers.map((w) => `<button class="worker-btn" data-id="${U.esc(w.id)}"><strong>${U.esc(w.name)}</strong><span>${DEFAULTS.roles[w.role] || ''}</span></button>`).join('')}
      </div>
    </section>`;
  el.querySelectorAll('.worker-btn').forEach((b) => {
    b.onclick = async () => {
      const w = App.workers.find((x) => x.id === b.dataset.id);
      if (w.pin) {
        const d = await C.modal(`رمز الدخول — ${w.name}`, `<label class="field"><span>الرمز</span><input name="pin" type="password" inputmode="numeric" dir="ltr" autofocus></label>`, { okText: 'دخول' });
        if (!d) return;
        if (d.querySelector('[name=pin]').value !== w.pin) return U.toast('الرمز غير صحيح', 'err');
      }
      App.user = w;
      U.ss.set('user', w.id);
      DB.audit('تسجيل دخول');
      App.route();
    };
  });
};

document.addEventListener('DOMContentLoaded', () => App.init().catch((e) => {
  document.getElementById('view').innerHTML = `<div class="card"><h2>تعذّر تشغيل النظام</h2><p>${U.esc(e.message || e)}</p></div>`;
}));
