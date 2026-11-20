'use strict';
const O = '/api/owner';
let data = null;
let filter = 'all';
let current = null;
let cc = '966';

const STATUS = {
  pending: ['طلب جديد', 'late'],
  ok: ['فعّالة', 'ok'],
  expired: ['منتهية', 'absent'],
  suspended: ['موقوفة', 'transferred'],
};

function show(view) {
  for (const v of ['login', 'code', 'password', 'setup', 'recovery', 'dash']) $(`#v-${v}`).classList.toggle('hidden', v !== view);
  $('#logout').classList.toggle('hidden', view === 'login');
}

async function boot() {
  try {
    const me = await api(`${O}/me`);
    $('#who').textContent = me.email;
    cc = me.country_code || cc;
    if (me.must_change_password) return show('password');
    if (!me.totp_enabled) return startSetup();
    $('#rec-left').textContent = me.recovery_left;
    show('dash');
    await load();
  } catch (e) {
    if (e.code === 'need_2fa') { show('code'); return $('#c-code').focus(); }
    show('login');
  }
}

/* ---------------- الدخول وكلمة المرور ---------------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`${O}/login`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    if (r.need_2fa) { show('code'); $('#c-code').focus(); return; }
    boot();
  } catch (ex) {
    $('#login-error').textContent = ex.message;
    $('#login-error').classList.remove('hidden');
  }
});
async function changePassword(form, errEl) {
  try {
    await api(`${O}/password`, { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
    form.reset();
    toast('تم تغيير كلمة المرور');
    boot();
  } catch (ex) {
    if (errEl) { errEl.textContent = ex.message; errEl.classList.remove('hidden'); } else toast(ex.message);
  }
}
$('#pw-form').addEventListener('submit', (e) => { e.preventDefault(); changePassword(e.target, $('#pw-error')); });
$('#pw-form-2').addEventListener('submit', (e) => { e.preventDefault(); changePassword(e.target); });
$('#logout').addEventListener('click', async () => { await api(`${O}/logout`, { method: 'POST' }).catch(() => {}); location.reload(); });

/* ---------------- التحقق بخطوتين ---------------- */
$('#code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#code-error');
  err.classList.add('hidden');
  try {
    await api(`${O}/login/2fa`, { method: 'POST', body: { code: $('#c-code').value.trim() } });
    e.target.reset();
    boot();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
    $('#c-code').select();
    if (ex.status === 401) setTimeout(() => show('login'), 1500);
  }
});

async function startSetup() {
  show('setup');
  try {
    const s = await api(`${O}/2fa/setup`, { method: 'POST' });
    $('#qr').innerHTML = s.qr_svg; // SVG مولّد على الخادم من رابط otpauth فقط
    $('#secret').textContent = s.secret;
    $('#s-code').focus();
  } catch (ex) { toast(ex.message); }
}
$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#setup-error');
  err.classList.add('hidden');
  try {
    const r = await api(`${O}/2fa/enable`, { method: 'POST', body: { code: $('#s-code').value.trim() } });
    showRecovery(r.recovery_codes);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

let recText = '';
function showRecovery(codes) {
  recText = `رموز استرداد لوحة مالك المنصة (${location.host}) — كل رمز يُستخدم مرة واحدة:\n\n${codes.join('\n')}\n`;
  $('#recovery').innerHTML = codes.map((c) => `<code dir="ltr">${esc(c)}</code>`).join('');
  show('recovery');
}
$('#rec-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(recText); toast('تم النسخ'); } catch { toast('انسخها يدوياً'); }
});
$('#rec-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([recText], { type: 'text/plain;charset=utf-8' }));
  a.download = 'recovery-codes.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#rec-done').addEventListener('click', () => { recText = ''; $('#recovery').innerHTML = ''; boot(); });
$('#regen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!confirm('ستتوقف رموز الاسترداد القديمة. متابعة؟')) return;
  try {
    const r = await api(`${O}/2fa/recovery`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    showRecovery(r.recovery_codes);
  } catch (ex) { toast(ex.message); }
});

/* ---------------- اللوحة ---------------- */
async function load() {
  data = await api(`${O}/schools`);
  const s = data.summary;
  const tile = (label, v, cls = '', f = '') => `<button type="button" class="card stat tile ${cls}" ${f ? `data-goto="${f}"` : ''}><div class="stat-label">${label}</div><div class="stat-value num">${v}</div></button>`;
  $('#tiles').innerHTML =
    tile('مدارس فعّالة', s.active, '', 'ok') +
    tile('طلبات جديدة', s.pending, s.pending ? 'late' : '', 'pending') +
    tile('تنتهي خلال 14 يوماً', s.expiring, s.expiring ? 'late' : '', 'expiring') +
    tile('منتهية', s.expired, s.expired ? 'absent' : '', 'expired') +
    tile('موقوفة', s.suspended, '', 'suspended') +
    tile('إجمالي الطلاب', s.students);
  render();
}

function match(sc) {
  if (filter === 'all') return true;
  if (filter === 'pending') return sc.status === 'pending';
  if (filter === 'suspended') return sc.status === 'suspended';
  if (filter === 'expired') return sc.access === 'expired';
  if (filter === 'expiring') return sc.access === 'ok' && sc.days_left !== null && sc.days_left <= 14;
  return sc.access === 'ok';
}

function render() {
  const q = normAr($('#q').value);
  const list = data.schools.filter((sc) => match(sc) && (!q || normAr(sc.name).includes(q) || sc.email.toLowerCase().includes(q)));
  $('#rows').innerHTML = list.length ? list.map((sc) => {
    const st = sc.status === 'pending' ? 'pending' : sc.status === 'suspended' ? 'suspended' : sc.access;
    const [label, cls] = STATUS[st] || STATUS.ok;
    const end = sc.subscription_end
      ? `<bdi class="num">${esc(sc.subscription_end)}</bdi><br><span class="small ${sc.days_left < 0 ? 'muted' : sc.days_left <= 14 ? '' : 'muted'}">${sc.days_left < 0 ? `منذ ${-sc.days_left} يوم` : `بعد ${sc.days_left} يوم`}</span>`
      : '<span class="muted">مفتوح</span>';
    const action = sc.status === 'pending'
      ? `<button class="btn btn-primary btn-sm" data-activate="${sc.id}" type="button">تفعيل</button>`
      : `<button class="btn btn-sm" data-manage="${sc.id}" type="button">إدارة</button>`;
    return `<tr>
      <td><strong>${esc(sc.name)}</strong><br><span class="small muted">${esc(sc.admin_name)} · <bdi>${esc(sc.email)}</bdi>${sc.contact_phone ? ` · <bdi>${esc(sc.contact_phone)}</bdi>` : ''}</span>${sc.owner_notes ? `<br><span class="small muted">📝 ${esc(sc.owner_notes)}</span>` : ''}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td>${esc(sc.plan || '—')}</td>
      <td>${end}</td>
      <td class="num">${sc.students}</td><td class="num">${sc.teachers}</td><td class="num">${sc.records_30d}</td>
      <td class="num small">${sc.last_activity ? `<bdi>${esc(sc.last_activity)}</bdi>` : '<span class="muted">—</span>'}</td>
      <td><div class="row" style="flex-wrap:nowrap;gap:4px">${action}${sc.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-manage="${sc.id}" type="button">تفاصيل</button>` : ''}</div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="empty">لا توجد مدارس في هذا التصنيف</td></tr>';
}

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  $$('#filters .tab').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
  render();
});
$('#tiles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]');
  if (b) $(`#filters [data-f="${b.dataset.goto}"]`).click();
});
$('#q').addEventListener('input', render);

/* ---------------- تفعيل وإدارة مدرسة ---------------- */
$('#rows').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-activate]');
  const man = e.target.closest('[data-manage]');
  if (act) {
    const sc = data.schools.find((x) => x.id === Number(act.dataset.activate));
    const months = prompt(`تفعيل «${sc.name}» — مدة الاشتراك بالأشهر (فارغ = مفتوح):`, '12');
    if (months === null) return;
    const body = { status: 'active' };
    if (months.trim()) body.extend_months = Number(months);
    try {
      await api(`${O}/schools/${sc.id}`, { method: 'PATCH', body });
      toast(`تم تفعيل ${sc.name}`);
      await load();
      if (sc.contact_phone && confirm('إرسال رسالة التفعيل للمدير عبر واتساب؟')) {
        window.open(whatsappUrl(sc.contact_phone, cc, `السلام عليكم ${sc.admin_name}،\nتم تفعيل حساب ${sc.name} في منصة رصد الحضور.\nالدخول: ${location.origin}\nبالبريد وكلمة المرور التي سجلتم بها.`), '_blank');
      }
    } catch (ex) { toast(ex.message); }
  }
  if (man) openManage(Number(man.dataset.manage));
});

function openManage(id) {
  current = data.schools.find((x) => x.id === id);
  $('#sd-title').textContent = current.name;
  $('#sd-meta').innerHTML = `${esc(current.admin_name)} · <bdi>${esc(current.email)}</bdi> · سُجلت <bdi>${esc(current.created_at.slice(0, 10))}</bdi>`;
  $('#sd-status').value = current.status;
  $('#sd-plan').value = current.plan || '';
  $('#sd-end').value = current.subscription_end || '';
  $('#sd-phone').value = current.contact_phone || '';
  $('#sd-notes').value = current.owner_notes || '';
  $('#sd').showModal();
}

function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, last));
  return x.toISOString().slice(0, 10);
}
$$('[data-ext]').forEach((b) => b.addEventListener('click', () => {
  const cur = $('#sd-end').value;
  const base = cur && cur > data.today ? cur : data.today;
  $('#sd-end').value = addMonths(base, Number(b.dataset.ext));
  if ($('#sd-status').value === 'pending') $('#sd-status').value = 'active';
}));

$('#sd').addEventListener('close', async () => {
  if ($('#sd').returnValue !== 'save' || !current) return;
  const f = Object.fromEntries(new FormData($('#sd-form')));
  if (f.status === 'suspended' && current.status !== 'suspended' && !confirm(`إيقاف «${current.name}»؟ لن يستطيع المدير ولا المعلمون الدخول حتى إعادة التفعيل.`)) return;
  try {
    await api(`${O}/schools/${current.id}`, { method: 'PATCH', body: f });
    toast('تم الحفظ');
    load();
  } catch (ex) { toast(ex.message); }
});

$('#sd-reset').addEventListener('click', async () => {
  if (!confirm(`إنشاء كلمة مرور مؤقتة جديدة لمدير «${current.name}»؟ ستتوقف كلمة المرور الحالية.`)) return;
  try {
    const r = await api(`${O}/schools/${current.id}/reset-password`, { method: 'POST' });
    $('#sd').close();
    showCredentials(current, r.temp_password);
  } catch (ex) { toast(ex.message); }
});

$('#sd-delete').addEventListener('click', async () => {
  const name = prompt(`حذف نهائي لـ «${current.name}» وكل طلابها وسجلاتها.\nاكتب اسم المدرسة كما هو للتأكيد:`);
  if (name === null) return;
  try {
    await api(`${O}/schools/${current.id}`, { method: 'DELETE', body: { confirm_name: name.trim() } });
    $('#sd').close();
    toast('تم الحذف');
    load();
  } catch (ex) { toast(ex.message); }
});

/* ---------------- إضافة مدرسة ---------------- */
$('#new-school').addEventListener('click', () => { $('#nd-form').reset(); $('#nd').showModal(); });
$('#nd').addEventListener('close', async () => {
  if ($('#nd').returnValue !== 'create') return;
  const f = Object.fromEntries(new FormData($('#nd-form')));
  if (!f.extend_months) delete f.extend_months;
  try {
    const r = await api(`${O}/schools`, { method: 'POST', body: f });
    await load();
    showCredentials({ name: f.name, admin_name: f.admin_name, email: f.email, contact_phone: f.contact_phone }, r.temp_password);
  } catch (ex) {
    toast(ex.message);
    $('#nd').showModal();
  }
});

function showCredentials(sc, pass) {
  const text = `السلام عليكم ${sc.admin_name}،\nتم تجهيز حساب ${sc.name} في منصة رصد الحضور.\n\nرابط الدخول: ${location.origin}\nالبريد: ${sc.email}\nكلمة المرور المؤقتة: ${pass}\n\nسيُطلب منك تغيير كلمة المرور عند أول دخول.`;
  $('#cred-text').textContent = text;
  const wa = $('#cred-wa');
  wa.classList.toggle('hidden', !sc.contact_phone);
  if (sc.contact_phone) wa.href = whatsappUrl(sc.contact_phone, cc, text);
  $('#cred').showModal();
  $('#cred-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('تم النسخ'); } catch { toast('انسخ النص يدوياً'); }
  };
}
$('#cred-close').addEventListener('click', () => $('#cred').close());

boot();
