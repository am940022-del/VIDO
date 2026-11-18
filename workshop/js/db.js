/* قاعدة البيانات المحلية (IndexedDB) — تعمل بدون إنترنت */
'use strict';

const DB = (() => {
  const NAME = 'workshop-db';
  const VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('kv', { keyPath: 'id' });
        d.createObjectStore('workers', { keyPath: 'id' });
        const o = d.createObjectStore('orders', { keyPath: 'id' });
        o.createIndex('no', 'no', { unique: true });
        o.createIndex('plate', 'vehicle.plateKey');
        o.createIndex('phone', 'customer.phone');
        d.createObjectStore('audit', { keyPath: 'seq' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

  async function get(store, key) {
    const d = await open();
    return req(d.transaction(store).objectStore(store).get(key));
  }
  async function all(store) {
    const d = await open();
    return req(d.transaction(store).objectStore(store).getAll());
  }
  async function byIndex(store, index, value) {
    const d = await open();
    return req(d.transaction(store).objectStore(store).index(index).getAll(value));
  }
  async function put(store, val) {
    const d = await open();
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).put(val);
    return done(t);
  }
  async function del(store, key) {
    const d = await open();
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    return done(t);
  }

  /* إنشاء أمر عمل مع رقم تسلسلي في نفس العملية حتى لا تظهر فجوات في الترقيم */
  async function createOrder(order) {
    const d = await open();
    const year = new Date(order.createdAt).getFullYear();
    const key = 'counter:' + year;
    return new Promise((res, rej) => {
      const t = d.transaction(['kv', 'orders'], 'readwrite');
      const kv = t.objectStore('kv');
      const g = kv.get(key);
      g.onsuccess = () => {
        const n = ((g.result && g.result.value) || 0) + 1;
        kv.put({ id: key, value: n });
        order.no = `${year}-${String(n).padStart(4, '0')}`;
        t.objectStore('orders').add(order);
      };
      t.oncomplete = () => res(order);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }

  /* سجل التدقيق: كل قيد مربوط ببصمة القيد الذي قبله (سلسلة لا يمكن التلاعب بها دون أن تنكشف) */
  let auditQueue = Promise.resolve();
  function audit(action, detail = {}) {
    auditQueue = auditQueue.then(async () => {
      const d = await open();
      const last = await new Promise((res, rej) => {
        const c = d.transaction('audit').objectStore('audit').openCursor(null, 'prev');
        c.onsuccess = () => res(c.result ? c.result.value : null);
        c.onerror = () => rej(c.error);
      });
      const user = (window.App && App.user) || null;
      const entry = {
        seq: last ? last.seq + 1 : 1,
        at: Date.now(),
        user: user ? user.name : '—',
        action,
        detail,
        prev: last ? last.hash : '',
      };
      entry.hash = await U.hashObj({ ...entry, hash: undefined });
      await put('audit', entry);
      return entry;
    }).catch((e) => console.error('audit', e));
    return auditQueue;
  }

  async function verifyAudit() {
    const list = (await all('audit')).sort((a, b) => a.seq - b.seq);
    let prev = '';
    const broken = [];
    for (const e of list) {
      const h = await U.hashObj({ ...e, hash: undefined });
      if (h !== e.hash || e.prev !== prev) broken.push(e.seq);
      prev = e.hash;
    }
    return { count: list.length, broken };
  }

  async function exportAll() {
    const [kv, workers, orders, auditList] = await Promise.all([all('kv'), all('workers'), all('orders'), all('audit')]);
    return { app: 'workshop', version: 1, exportedAt: Date.now(), kv, workers, orders, audit: auditList };
  }

  async function importAll(data) {
    if (!data || data.app !== 'workshop' || !Array.isArray(data.orders)) throw new Error('ملف غير صالح');
    const d = await open();
    const stores = ['kv', 'workers', 'orders', 'audit'];
    const t = d.transaction(stores, 'readwrite');
    stores.forEach((s) => t.objectStore(s).clear());
    (data.kv || []).forEach((v) => t.objectStore('kv').put(v));
    (data.workers || []).forEach((v) => t.objectStore('workers').put(v));
    data.orders.forEach((v) => t.objectStore('orders').put(v));
    (data.audit || []).forEach((v) => t.objectStore('audit').put(v));
    return done(t);
  }

  return { open, get, all, byIndex, put, del, createOrder, audit, verifyAudit, exportAll, importAll };
})();
