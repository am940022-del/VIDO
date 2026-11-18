/* أدوات عامة: الهروب من HTML، التنسيق، البصمة (SHA-256)، معالجة الصور */
'use strict';

const U = (() => {
  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const pad = (n, l = 2) => String(n).padStart(l, '0');

  function fmtDate(ts, withTime = true) {
    if (!ts) return '—';
    const d = new Date(ts);
    const s = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
  }

  function fmtMoney(n, currency) {
    const v = Number(n) || 0;
    return `${v.toLocaleString('en-US')} ${currency || ''}`.trim();
  }

  /* صيغ العدد الصحيحة: يوم واحد، يومان، 3 أيام، 11 يومًا */
  function countWord(n, one, two, few, many) {
    n = Number(n) || 0;
    if (n === 1) return one;
    if (n === 2) return two;
    const r = n % 100;
    if (r >= 3 && r <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }
  const days = (n) => (Number(n) === 0 ? 'صفر يوم' : countWord(n, 'يوم واحد', 'يومان', 'أيام', 'يومًا'));
  const times = (n) => countWord(n, 'مرة واحدة', 'مرتين', 'مرات', 'مرة');

  function daysBetween(a, b = Date.now()) {
    return Math.floor((b - a) / 86400000);
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /* JSON مرتّب المفاتيح حتى تكون البصمة ثابتة لنفس البيانات */
  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return (
      '{' +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
        .join(',') +
      '}'
    );
  }

  /* SHA-256: نستخدم WebCrypto إن توفّر، وإلا تطبيق JS احتياطي */
  function sha256Fallback(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length;
    const total = Math.ceil((l + 9) / 64) * 64;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[l] = 0x80;
    const bitLen = l * 8;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
    dv.setUint32(total - 4, bitLen >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  async function sha256(str) {
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* ننتقل للاحتياطي */ }
    return sha256Fallback(str);
  }

  const hashObj = (o) => sha256(canonical(o));

  /* رمز تحقق قصير للطباعة: 4 مجموعات من 4 */
  const shortCode = (hash) => (hash || '').slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, '$1-');

  /* تحميل صورة من ملف، تصغيرها، وطبع التاريخ والوقت عليها بشكل دائم */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  async function processPhoto(file, stampLines = [], maxSide = 1600) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const lines = stampLines.filter(Boolean);
      if (lines.length) {
        const fs = Math.max(14, Math.round(w / 45));
        const lh = Math.round(fs * 1.5);
        const bar = lh * lines.length + fs;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, h - bar, w, bar);
        ctx.fillStyle = '#fff';
        ctx.font = `600 ${fs}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        lines.forEach((t, i) => ctx.fillText(t, w - fs, h - bar + fs * 1.5 + lh * i));
      }
      return c.toDataURL('image/jpeg', 0.72);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function download(filename, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2800);
  }

  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* لا شيء */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* لا شيء */ } },
  };

  return {
    esc, pad, fmtDate, days, times, fmtMoney, daysBetween, uid, canonical, sha256, hashObj, shortCode,
    processPhoto, readFileAsDataURL, loadImage, download, toast, ss,
  };
})();
