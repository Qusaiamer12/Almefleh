import { api } from './api.js';
import { h, clear, state, toast, dateTime, modal } from './ui.js';
import { icon } from './icons.js';
import { renderLogin } from './pages/login.js';
import { ADMIN_NAV } from './pages/admin.js';
import { RECORDER_NAV } from './pages/record.js';
import { OVERVIEW_NAV } from './pages/overview.js';
import { CUSTOMER_NAV } from './pages/customer.js';

const app = document.getElementById('app');

const ROLE_LABELS = {
  admin: 'مدير النظام', recorder: 'مسجّل الحركات',
  viewer: 'اطّلاع', customer: 'زبون',
};
const NAV_BY_ROLE = {
  admin: ADMIN_NAV, recorder: RECORDER_NAV,
  viewer: OVERVIEW_NAV, customer: CUSTOMER_NAV,
};

/** شعار المفلح - رابط واحد ثابت والسيرفر بيختار الملف (png أو svg) */
const logo = (className = 'logo') => h('img', { class: className, src: state.logo, alt: 'المفلح' });

const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

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
  const nav = NAV_BY_ROLE[user.role] || OVERVIEW_NAV;
  let active = nav[0].key;
  clear(app);

  // شاشة وحدة (عبود) ما بتستاهل سايدبار - العرض كله للشغل
  const singleSection = nav.length === 1;

  // ---------- السايدبار ----------
  const navBox = h('div.nav');
  const brand = h('div.brand', {}, logo(),
    h('div.brand-text', {}, h('b', {}, 'مستودعات المفلح'), h('span', {}, 'إدارة المخزون')));
  const sidebar = singleSection ? null : h('aside.sidebar', {},
    brand,
    navBox,
    h('div.spacer'),
    h('div.sidebar-foot', {},
      h('button', { onclick: openAccountDialog }, icon('settings'), 'حسابي'),
      h('button', {
        onclick: async () => { await api.logout(); location.reload(); },
      }, icon('logout'), 'خروج')));

  // ---------- الشريط العلوي ----------
  const bellCount = h('span.bell-dot', { style: 'display:none' });
  const bell = h('button.icon-btn', { title: 'التنبيهات', onclick: () => toggleNotifications(bell) },
    icon('bell'), bellCount);

  const searchBox = buildSearch((key) => go(key));

  const topbar = h('header.topbar', {},
    singleSection ? brand : null,
    (user.role === 'admin' || user.role === 'viewer') ? searchBox : h('div.spacer'),
    h('div.spacer'),
    user.notifications_on ? bell : null,
    singleSection ? h('button.icon-btn', { title: 'حسابي', onclick: openAccountDialog }, icon('settings')) : null,
    singleSection ? h('button.icon-btn', {
      title: 'خروج', onclick: async () => { await api.logout(); location.reload(); },
    }, icon('logout')) : null,
    h('div.account', {},
      h('div.avatar', {}, initials(user.display_name)),
      h('div.who', {}, h('b', {}, user.display_name), h('span', {}, ROLE_LABELS[user.role]))));

  // ---------- المحتوى ----------
  const title = h('h1');
  const actions = h('div.row');
  const section = h('div');
  const panel = h('div.panel', {},
    h('div.page-head', {}, title, h('div.spacer'), actions), section);

  app.append(h('div.shell', {}, sidebar,
    h('div.main', {}, topbar, h('div.content', {}, panel))));

  function drawNav() {
    if (singleSection) return;
    clear(navBox);
    for (const item of nav) {
      navBox.append(h('button', {
        class: active === item.key ? 'active' : '',
        onclick: () => go(item.key),
      }, icon(item.icon), item.label));
    }
  }

  function go(key) {
    const item = nav.find((n) => n.key === key);
    if (!item) return;
    active = key;
    drawNav();
    title.textContent = item.title || item.label;
    clear(actions);
    clear(section);
    section.append(h('div.empty', {}, 'جاري التحميل…'));
    Promise.resolve(item.render(section, { actions, go }))
      .then(() => { if (section.firstChild?.classList?.contains('empty') && section.children.length > 1) section.firstChild.remove(); })
      .catch((err) => { clear(section); section.append(h('div.alert.danger', {}, err.message)); });
  }

  go(active);

  if (user.notifications_on) {
    refreshBell(bellCount);
    setInterval(() => refreshBell(bellCount), 60000);
  }
}

/** بحث سريع: زبون => كشفه، صنف => صفحة الأصناف */
function buildSearch(go) {
  const input = h('input', { type: 'search', placeholder: 'دوّر على زبون أو صنف…', id: 'global-search' });
  const results = h('div.notif-panel', { style: 'display:none;top:60px' });
  let cache = null;

  const close = () => { results.style.display = 'none'; };
  const open = async () => {
    const term = input.value.trim();
    if (!term) return close();
    if (!cache) {
      const [items, entities] = await Promise.all([
        api.get('/api/items').catch(() => ({ items: [] })),
        api.get('/api/users/entities').catch(() => ({ entities: [] })),
      ]);
      cache = { items: items.items || [], entities: entities.entities || [] };
    }
    clear(results);
    const customers = cache.entities.filter((e) => e.type === 'customer' && e.name.includes(term));
    const items = cache.items.filter((i) => i.name.includes(term)).slice(0, 6);
    if (!customers.length && !items.length) {
      results.append(h('div.empty', {}, 'ما في نتائج'));
    }
    for (const c of customers) {
      results.append(h('div.notif', {
        style: 'cursor:pointer',
        onclick: () => { close(); input.value = ''; go('statements'); },
      }, h('b', {}, c.name), h('p', {}, 'كشف حساب الزبون')));
    }
    for (const i of items) {
      results.append(h('div.notif', {
        style: 'cursor:pointer',
        onclick: () => { close(); input.value = ''; go('items'); },
      }, h('b', {}, i.name), h('p', {}, 'صنف — الأصناف والأسعار')));
    }
    results.style.display = 'block';
  };

  input.addEventListener('input', open);
  input.addEventListener('blur', () => setTimeout(close, 180));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); }
  });

  return h('div.search', {}, icon('search', 16), input, results);
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
          const dot = document.querySelector('.bell-dot');
          if (dot) dot.style.display = 'none';
        },
      }, 'تعليم الكل كمقروء') : null),
    list);

  if (!notifications.length) list.append(h('div.empty', {}, 'ما في تنبيهات'));
  for (const n of notifications) {
    list.append(h('div.notif', {
      class: n.read_at ? '' : 'unread',
      onclick: async () => { if (!n.read_at) await api.post(`/api/notifications/${n.id}/read`); },
    }, h('b', {}, n.title), n.body ? h('p', {}, n.body) : null, h('time', {}, dateTime(n.created_at))));
  }

  document.body.append(notifPanel);
  setTimeout(() => {
    const onDoc = (e) => {
      if (notifPanel && !notifPanel.contains(e.target) && !anchor.contains(e.target)) {
        notifPanel.remove(); notifPanel = null;
        document.removeEventListener('click', onDoc);
      }
    };
    document.addEventListener('click', onDoc);
  }, 10);
}

/** تغيير اليوزر/الباسورد - متاح لكل الحسابات */
function openAccountDialog() {
  const current = h('input', { type: 'password', id: 'cur-pass', placeholder: 'كلمة السر الحالية' });
  const username = h('input', { type: 'text', id: 'new-user', value: state.user.username });
  const password = h('input', { type: 'password', id: 'new-pass', placeholder: 'اتركها فاضية إذا ما بدك تغيّرها' });

  return modal({
    title: 'بيانات الدخول تبعي',
    confirmText: 'حفظ',
    body: h('div.grid', {},
      h('label.field', {}, 'كلمة السر الحالية', current),
      h('label.field', {}, 'اسم المستخدم', username),
      h('label.field', {}, 'كلمة سر جديدة', password),
      h('div.alert.warn', {}, 'تغيير كلمة السر بينهي جلساتك المفتوحة على أي جهاز تاني.')),
    onConfirm: async () => {
      const payload = { current_password: current.value };
      if (username.value.trim() && username.value.trim() !== state.user.username) {
        payload.new_username = username.value.trim();
      }
      if (password.value) payload.new_password = password.value;
      if (!payload.new_username && !payload.new_password) throw new Error('ما في شي للتعديل');
      await api.post('/api/auth/change-credentials', payload);
      toast('تم تحديث بيانات الدخول');
      setTimeout(() => location.reload(), 800);
    },
  });
}

boot();
