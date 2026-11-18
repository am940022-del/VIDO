/* مكوّنات الواجهة: لوحة التوقيع، رسم السيارة، مؤشر البنزين، النوافذ المنبثقة */
'use strict';

const C = (() => {
  /* ---------- لوحة التوقيع ---------- */
  function signaturePad(container) {
    container.innerHTML = `
      <div class="sig-wrap">
        <canvas class="sig-canvas" aria-label="مساحة التوقيع"></canvas>
        <span class="sig-hint">وقّع هنا بإصبعك أو بالقلم</span>
      </div>
      <div class="row gap-2 mt-2">
        <button type="button" class="btn btn-ghost btn-sm sig-clear">مسح التوقيع</button>
      </div>`;
    const canvas = container.querySelector('canvas');
    const hint = container.querySelector('.sig-hint');
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let empty = true;
    let last = null;

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      const data = empty ? null : canvas.toDataURL();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      if (data) U.loadImage(data).then((img) => ctx.drawImage(img, 0, 0, r.width, r.height));
    }
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#111827';
      ctx.fill();
      empty = false;
      hint.hidden = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    container.querySelector('.sig-clear').addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      empty = true;
      hint.hidden = false;
    });
    requestAnimationFrame(resize);
    window.addEventListener('resize', resize);

    return {
      isEmpty: () => empty,
      /* نُخرج التوقيع على خلفية بيضاء حتى يُطبع بوضوح */
      toDataURL() {
        if (empty) return '';
        const out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        const o = out.getContext('2d');
        o.fillStyle = '#fff';
        o.fillRect(0, 0, out.width, out.height);
        o.drawImage(canvas, 0, 0);
        return out.toDataURL('image/png');
      },
    };
  }

  /* ---------- رسم السيارة (منظر علوي، الأمام للأعلى) ---------- */
  function carSVG(damages = [], interactive = false) {
    const types = Object.fromEntries(DEFAULTS.damageTypes.map((t) => [t.id, t]));
    const markers = damages
      .map((d, i) => {
        const t = types[d.type] || { color: '#dc2626' };
        const x = (d.x / 100) * 300;
        const y = (d.y / 100) * 520;
        return `<g class="dmg-marker" data-i="${i}">
          <circle cx="${x}" cy="${y}" r="13" fill="${t.color}" stroke="#fff" stroke-width="3"/>
          <text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${i + 1}</text>
        </g>`;
      })
      .join('');
    return `<svg viewBox="0 0 300 520" class="car-svg${interactive ? ' interactive' : ''}" role="img" aria-label="رسم السيارة من الأعلى">
      <g class="car-wheel">
        <rect x="30" y="92" width="28" height="74" rx="9"/><rect x="242" y="92" width="28" height="74" rx="9"/>
        <rect x="30" y="352" width="28" height="74" rx="9"/><rect x="242" y="352" width="28" height="74" rx="9"/>
      </g>
      <ellipse class="car-part" cx="34" cy="208" rx="14" ry="8"/>
      <ellipse class="car-part" cx="266" cy="208" rx="14" ry="8"/>
      <path class="car-body" d="M150 18 C218 18 250 38 254 92 L258 424 C256 482 224 502 150 502 C76 502 44 482 42 424 L46 92 C50 38 82 18 150 18 Z"/>
      <path class="car-line" d="M70 60 Q150 40 230 60"/>
      <rect class="car-light" x="68" y="28" width="38" height="12" rx="6"/>
      <rect class="car-light" x="194" y="28" width="38" height="12" rx="6"/>
      <path class="car-glass" d="M78 172 Q150 142 222 172 L212 232 Q150 216 88 232 Z"/>
      <rect class="car-roof" x="90" y="238" width="120" height="128" rx="12"/>
      <path class="car-glass" d="M90 372 Q150 388 210 372 L218 422 Q150 444 82 422 Z"/>
      <rect class="car-tail" x="64" y="482" width="40" height="10" rx="5"/>
      <rect class="car-tail" x="196" y="482" width="40" height="10" rx="5"/>
      <line class="car-line" x1="47" y1="250" x2="88" y2="250"/><line class="car-line" x1="212" y1="250" x2="253" y2="250"/>
      ${markers}
    </svg>`;
  }

  function carDiagram(container, damages, onAdd, onSelect) {
    function render() {
      container.innerHTML = `
        <div class="car-frame">
          <span class="car-label car-front">الأمام</span>
          <span class="car-label car-right">يمين</span>
          <span class="car-label car-left">يسار</span>
          ${carSVG(damages, true)}
          <span class="car-label car-back">الخلف</span>
        </div>`;
      const svg = container.querySelector('svg');
      svg.addEventListener('click', (e) => {
        const m = e.target.closest('.dmg-marker');
        if (m) return onSelect(Number(m.dataset.i));
        const r = svg.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        onAdd({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
      });
    }
    render();
    return { render };
  }

  /* ---------- مؤشر البنزين ---------- */
  const FUEL_LABELS = ['فارغ', '1/8', '1/4', '3/8', 'النصف', '5/8', '3/4', '7/8', 'ممتلئ'];
  function fuelText(v) { return FUEL_LABELS[Number(v) || 0]; }
  function fuelBars(v) {
    const n = Number(v) || 0;
    let s = '<span class="fuel-bars" aria-label="مستوى البنزين ' + fuelText(n) + '">';
    for (let i = 1; i <= 8; i++) s += `<i class="${i <= n ? 'on' : ''}"></i>`;
    return s + `</span> <span>${fuelText(n)}</span>`;
  }

  /* ---------- نافذة منبثقة ---------- */
  function modal(title, bodyHTML, { okText = 'حفظ', cancelText = 'إلغاء', danger = false, onOpen } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `
        <form method="dialog" class="modal-form">
          <h3 class="modal-title">${U.esc(title)}</h3>
          <div class="modal-body">${bodyHTML}</div>
          <div class="modal-actions">
            <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${U.esc(okText)}</button>
            ${cancelText ? `<button value="cancel" formnovalidate class="btn btn-ghost">${U.esc(cancelText)}</button>` : ''}
          </div>
        </form>`;
      document.body.appendChild(dlg);
      let validator = null;
      const ctx = { dlg, setValidator: (fn) => { validator = fn; } };
      dlg.querySelector('form').addEventListener('submit', (e) => {
        if (e.submitter && e.submitter.value === 'ok' && validator) {
          const err = validator(dlg);
          if (err) { e.preventDefault(); U.toast(err, 'err'); }
        }
      });
      dlg.addEventListener('close', () => {
        const ok = dlg.returnValue === 'ok';
        const result = ok ? dlg : null;
        resolve(result);
        setTimeout(() => dlg.remove(), 0);
      });
      dlg.showModal();
      if (onOpen) onOpen(ctx);
    });
  }

  async function confirm(title, text, okText = 'نعم', danger = false) {
    const r = await modal(title, `<p>${U.esc(text)}</p>`, { okText, danger });
    return !!r;
  }

  /* ---------- حقل التقاط صورة ---------- */
  function photoInput(id, label) {
    return `<label class="photo-slot" for="${id}">
      <input type="file" id="${id}" accept="image/*" capture="environment" hidden>
      <span class="photo-preview"></span>
      <span class="photo-label">${U.esc(label)}</span>
    </label>`;
  }

  return { signaturePad, carSVG, carDiagram, fuelBars, fuelText, FUEL_LABELS, modal, confirm, photoInput };
})();
