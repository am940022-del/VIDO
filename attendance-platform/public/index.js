'use strict';
// إن كان المدير مسجلاً للدخول انتقل مباشرة للوحة
api('/api/admin/me').then(() => location.replace('/admin')).catch(() => {});

function bindForm(formId, errId, url) {
  const form = document.getElementById(formId);
  const err = document.getElementById(errId);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(url, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      location.href = '/admin';
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}
bindForm('login-form', 'login-error', '/api/login');
bindForm('reg-form', 'reg-error', '/api/register');
