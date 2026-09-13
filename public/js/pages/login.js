import { api } from '../api.js';
import { h, clear, toast, state } from '../ui.js';

export function renderLogin(root, onSuccess) {
  clear(root);

  const username = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'off' });
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const error = h('div.alert.danger', { style: 'display:none' });
  const button = h('button.btn', { type: 'submit' }, 'دخول');

  const logoImg = h('img.logo', { src: state.logo, alt: 'المفلح' });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      error.style.display = 'none';
      button.disabled = true;
      button.textContent = 'جاري الدخول…';
      try {
        await api.login(username.value.trim(), password.value);
        toast('أهلاً فيك');
        onSuccess();
      } catch (err) {
        error.textContent = err.message;
        error.style.display = 'block';
        password.value = '';
        password.focus();
      } finally {
        button.disabled = false;
        button.textContent = 'دخول';
      }
    },
  },
    h('label.field', {}, 'اسم المستخدم', username),
    h('label.field', {}, 'كلمة السر', password),
    error,
    button);

  root.append(h('div.login-wrap', {},
    h('div.login-card', {},
      logoImg,
      h('h1', {}, 'نظام مستودعات المفلح'),
      h('p.tagline', {}, 'إدارة المخزون وكشوفات الحسابات'),
      form)));

  setTimeout(() => username.focus(), 50);
}
