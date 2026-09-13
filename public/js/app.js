import { api } from './api.js';
import { h, clear, state, toast, dateTime, modal } from './ui.js';
import { renderLogin } from './pages/login.js';
import { renderAdmin } from './pages/admin.js';
import { renderRecorder } from './pages/record.js';
import { renderOverview } from './pages/overview.js';
import { renderCustomer } from './pages/customer.js';

const app = document.getElementById('app');

const ROLE_LABELS = {
  admin: 'مدير النظام', recorder: 'مسجّل الحركات',
  viewer: 'اطّلاع', customer: 'زبون',
};

const PAGES = {
  admin: renderAdmin,
  recorder: renderRecorder,
  viewer: renderOverview,
  customer: renderCustomer,
};

/** شعار المفلح - رابط واحد ثابت والسيرفر بيختار الملف (png أو svg) */
function logo(className = 'logo') {
  return h('img', { class: className, src: state.logo, alt: 'المفلح' });
}

async function boot() {
  try {
    const config = await api.get('/api/config');
    state.currency = config.currency || 'د.أ';
    state.user = config.user;
  } catch {
    state.user = null;
  }

  if (!state.user) return renderLogin(app, boot);
  renderShell();
}

function renderShell() {
  const user = state.user;
  clear(app);

  const bellCount = h('span.bell-dot', { style: 'display:none' });
  const bell = h('button.icon-btn', {
    title: 'التنبيهات',
    onclick: () => toggleNotifications(bell),
  }, '🔔', bellCount);

  const topbar = h('div.topbar', {},
    logo(),
    h('div.brand', {}, h('b', {}, 'نظام مستودعات المفلح'), h('small', {}, 'إدارة المخزون وكشوفات الحسابات')),
    h('div.spacer'),
    user.notifications_on ? bell : null,
    h('button.icon-btn', { title: 'حسابي', onclick: openAccountDialog }, '⚙'),
    h('div.who', {}, h('b', {}, user.display_name), h('span', {}, ROLE_LABELS[user.role])),
    h('button.icon-btn', {
      onclick: async () => { await api.logout(); location.reload(); },
    }, 'خروج'),
  );

  const body = h('div#page-body');
  app.append(topbar, body);

  (PAGES[user.role] || renderOverview)(body);

  if (user.notifications_on) {
    refreshBell(bellCount);
    setInterval(() => refreshBell(bellCount), 60000);
  }
}

async function refreshBell(dot) {
  try {
    const { unread } = await api.get('/api/notifications/count');
    dot.textContent = unread > 99 ? '99+' : String(unread);
    dot.style.display = unread > 0 ? 'grid' : 'none';
  } catch { /* تجاهل */ }
}

let notifPanel = null;
async function toggleNotifications(anchor) {
  if (notifPanel) { notifPanel.remove(); notifPanel = null; return; }

  const { notifications, unread } = await api.get('/api/notifications', { limit: 40 });
  const list = h('div');

  notifPanel = h('div.notif-panel', {},
    h('header', {},
      h('b', {}, `التنبيهات${unread ? ` (${unread})` : ''}`),
      h('div', { style: 'flex:1' }),
      unread ? h('button.btn.ghost.sm', {
        onclick: async () => {
          await api.post('/api/notifications/read-all');
          notifPanel.remove(); notifPanel = null;
          toast('تم تعليم الكل كمقروء');
          document.querySelector('.bell-dot').style.display = 'none';
        },
      }, 'تعليم الكل كمقروء') : null),
    list);

  if (!notifications.length) {
    list.append(h('div.empty', {}, 'ما في تنبيهات'));
  } else {
    for (const n of notifications) {
      list.append(h('div.notif', {
        class: n.read_at ? '' : 'unread',
        onclick: async () => { if (!n.read_at) await api.post(`/api/notifications/${n.id}/read`); },
      },
        h('b', {}, n.title),
        n.body ? h('p', {}, n.body) : null,
        h('time', {}, dateTime(n.created_at))));
    }
  }

  document.body.append(notifPanel);
  setTimeout(() => {
    const onDoc = (e) => {
      if (notifPanel && !notifPanel.contains(e.target) && e.target !== anchor) {
        notifPanel.remove(); notifPanel = null;
        document.removeEventListener('click', onDoc);
      }
    };
    document.addEventListener('click', onDoc);
  }, 10);
}

/** تغيير اليوزر/الباسورد - متاح لكل الحسابات */
function openAccountDialog() {
  const current = h('input', { type: 'password', placeholder: 'كلمة السر الحالية', required: true });
  const username = h('input', { type: 'text', value: state.user.username });
  const password = h('input', { type: 'password', placeholder: 'اتركها فاضية إذا ما بدك تغيّرها' });

  return modal({
    title: 'بيانات الدخول تبعي',
    confirmText: 'حفظ',
    body: h('div.grid', {},
      h('label.field', {}, 'كلمة السر الحالية', current),
      h('label.field', {}, 'اسم المستخدم', username),
      h('label.field', {}, 'كلمة سر جديدة', password)),
    onConfirm: async () => {
      const payload = { current_password: current.value };
      if (username.value.trim() && username.value.trim() !== state.user.username) {
        payload.new_username = username.value.trim();
      }
      if (password.value) payload.new_password = password.value;
      if (!payload.new_username && !payload.new_password) {
        throw new Error('ما في شي للتعديل');
      }
      await api.post('/api/auth/change-credentials', payload);
      toast('تم تحديث بيانات الدخول');
      setTimeout(() => location.reload(), 800);
    },
  });
}

export { logo };
boot();
