'use strict';
// إن كان المدير مسجلاً للدخول انتقل مباشرة للوحة
api('/api/admin/me').then(() => location.replace('/admin')).catch(() => {});

function supportHtml(sp) {
  if (!sp || (!sp.whatsapp && !sp.email)) return '';
  return '<span class="muted small">للتواصل مع إدارة المنصة:</span> ' +
    (sp.whatsapp ? `<a class="btn btn-sm" href="https://wa.me/${esc(sp.whatsapp)}" target="_blank" rel="noopener">واتساب</a> ` : '') +
    (sp.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${esc(sp.email)}">${esc(sp.email)}</a>` : '');
}

api('/api/public/info').then((info) => {
  const html = supportHtml(info.support);
  $$('.support').forEach((el) => { el.innerHTML = html; el.classList.toggle('hidden', !html); });
  if (info.registration === 'closed') {
    $('#reg-form').classList.add('hidden');
    $('#reg-closed').classList.remove('hidden');
    $('#reg-title').textContent = 'اشترك مع مدرستك';
  }
}).catch(() => {});

function bind(formId, errId, url, onOk) {
  $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $(errId);
    err.classList.add('hidden');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(url, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      onOk(e.target);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}
bind('#login-form', '#login-error', '/api/login', () => { location.href = '/admin'; });
bind('#reg-form', '#reg-error', '/api/register', (form) => {
  form.classList.add('hidden');
  $('#reg-done').classList.remove('hidden');
});
