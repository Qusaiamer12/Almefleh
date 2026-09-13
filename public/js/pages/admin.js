import { api } from '../api.js';
import { h, clear, money, qty, dateTime, dateOnly, todayString, table, toast, modal, confirmDialog,
         inputToIso, toDateTimeInput, weekStartString } from '../ui.js';
import { renderStock, renderStatements, renderLoss, renderTransactions, stat } from './shared.js';

const TABS = [
  { key: 'dashboard', label: 'اللوحة', render: renderDashboard },
  { key: 'stock', label: 'الستوك', render: renderStock },
  { key: 'transactions', label: 'الحركات', render: renderAdminTransactions },
  { key: 'items', label: 'الأصناف والأسعار', render: renderItems },
  { key: 'recipes', label: 'المقادير', render: renderRecipes },
  { key: 'statements', label: 'كشوفات الزباين', render: renderStatements },
  { key: 'loss', label: 'النقص والفاقد', render: renderLoss },
  { key: 'users', label: 'الحسابات', render: renderUsers },
  { key: 'requests', label: 'طلبات الزباين', render: renderRequests },
  { key: 'audit', label: 'سجل التدقيق', render: renderAudit },
];

export function renderAdmin(root) {
  clear(root);
  const tabsBar = h('div.tabs');
  const page = h('div.page');
  root.append(tabsBar, page);

  let active = 'dashboard';
  const draw = () => {
    clear(tabsBar);
    for (const tab of TABS) {
      tabsBar.append(h('button', {
        class: active === tab.key ? 'active' : '',
        onclick: () => { active = tab.key; draw(); },
      }, tab.label));
    }
    clear(page);
    const loading = h('div.empty', {}, 'جاري التحميل…');
    page.append(loading);
    Promise.resolve(TABS.find((t) => t.key === active).render(page))
      .catch((err) => { clear(page); page.append(h('div.alert.danger', {}, err.message)); });
  };
  draw();
}

// ================= اللوحة =================
async function renderDashboard(root) {
  clear(root);
  const [stock, statements, proposals, requests, pending] = await Promise.all([
    api.get('/api/stock'),
    api.get('/api/statements'),
    api.get('/api/proposals', { status: 'pending' }),
    api.get('/api/requests', { open_only: 'true' }),
    api.get('/api/transactions', { pending_price: 'true', limit: 50 }),
  ]);

  root.append(h('div.grid.cols-4', {},
    stat('إجمالي ديون الزباين', money(statements.totals.balance)),
    stat('قيمة الستوك', money(stock.summary.total_value)),
    stat('أصناف تحت الصفر', stock.summary.negative_count, stock.summary.negative_count > 0),
    stat('حركات بسعر معلّق', pending.transactions.length, pending.transactions.length > 0)));

  if (proposals.proposals.length) {
    root.append(h('div.card', {},
      h('h3', {}, '🔔 اقتراحات تعديل أسعار بانتظار قرارك'),
      table([
        { label: 'الصنف', key: 'parent_name' },
        { label: 'السبب', render: (r) => `تغيّر سعر "${r.component_name}" من ${r.old_component_price ?? '—'} إلى ${r.new_component_price}` },
        { label: 'السعر الحالي', cls: 'num', render: (r) => money(r.current_parent_price) },
        { label: 'تكلفة المقادير', cls: 'num', render: (r) => money(r.cost_price) },
        { label: 'المقترح', cls: 'num', render: (r) => h('b', {}, money(r.suggested_price)) },
        { label: 'من تاريخ', render: (r) => dateOnly(r.effective_from) },
        { label: '', render: (r) => h('div.row', {},
          h('button.btn.sm', { onclick: () => acceptProposal(r) }, 'وافق'),
          h('button.btn.ghost.sm', {
            onclick: async () => { await api.post(`/api/proposals/${r.id}/reject`); toast('انرفض الاقتراح'); renderAdmin(document.getElementById('page-body')); },
          }, 'ارفض')) },
      ], proposals.proposals)));
  }

  if (pending.transactions.length) {
    root.append(h('div.card', {},
      h('h3', {}, '⏳ حركات بسعر معلّق', h('span.sub', {}, 'حدّد سعر الصنف وبتنحسب تلقائياً')),
      table([
        { label: 'التاريخ', render: (r) => dateTime(r.occurred_at) },
        { label: 'الزبون', key: 'entity_name' },
        { label: 'الصنف', key: 'item_name' },
        { label: 'الكمية', cls: 'num', render: (r) => qty(r.quantity, r.item_unit) },
        { label: '', render: (r) => h('button.btn.gold.sm', {
          onclick: () => openPriceDialog({ id: r.item_id, name: r.item_name }, () => renderAdmin(document.getElementById('page-body'))),
        }, 'حدّد السعر') },
      ], pending.transactions)));
  }

  if (requests.requests.length) {
    root.append(h('div.card', {},
      h('h3', {}, '✉ طلبات وملاحظات الزباين'),
      table([
        { label: 'الزبون', key: 'entity_name' },
        { label: 'الطلب', key: 'body' },
        { label: 'التاريخ', render: (r) => dateTime(r.created_at) },
        { label: '', render: (r) => h('button.btn.ghost.sm', {
          onclick: async () => { await api.patch(`/api/requests/${r.id}`, { handled: true }); toast('تم'); renderAdmin(document.getElementById('page-body')); },
        }, 'تم التعامل معه') },
      ], requests.requests)));
  }

  const negatives = stock.items.filter((i) => i.negative);
  if (negatives.length) {
    root.append(h('div.card', {},
      h('h3', { style: 'color:#B3261E' }, '⚠ أصناف رصيدها تحت الصفر'),
      table([
        { label: 'الصنف', key: 'item_name' },
        { label: 'الرصيد', cls: 'num', render: (r) => qty(r.quantity, r.unit) },
      ], negatives, { rowClass: () => 'neg' })));
  }
}

async function acceptProposal(proposal) {
  const price = h('input', { type: 'number', step: '0.01', value: proposal.suggested_price ?? '' });
  const effective = h('input', { type: 'date', value: dateOnly(proposal.effective_from) });
  const result = await modal({
    title: `تعديل سعر ${proposal.parent_name}`,
    confirmText: 'اعتمد السعر',
    body: h('div.grid', {},
      h('div.muted', {}, `تكلفة المقادير الجديدة: ${money(proposal.cost_price)} — السعر الحالي: ${money(proposal.current_parent_price)}`),
      h('label.field', {}, 'السعر الجديد', price),
      h('label.field', {}, 'يسري من تاريخ', effective),
      h('div.alert.warn', {}, 'كل الحركات من هذا التاريخ وجاي بتتحدّث تلقائياً بالسعر الجديد.')),
    onConfirm: async () => {
      await api.post(`/api/proposals/${proposal.id}/accept`, {
        price: Number(price.value),
        effective_from: inputToIso(effective.value),
      });
      toast('تم تعديل السعر');
    },
  });
  if (result) renderAdmin(document.getElementById('page-body'));
}

// ================= الحركات =================
async function renderAdminTransactions(root) {
  await renderTransactions(root, {
    editable: true,
    onEdit: (txn, refresh) => openEditTransaction(txn, refresh),
    onDelete: async (txn, refresh) => {
      const ok = await confirmDialog(
        `حذف ${txn.kind_label} — ${txn.entity_name || 'المستودع'} — ${txn.item_name || money(txn.payment_amount)}؟ الأرصدة بتتحدّث تلقائياً.`,
        'حذف');
      if (!ok) return;
      await api.del(`/api/transactions/${txn.id}`);
      toast('تم الحذف');
      refresh();
    },
  });
}

function openEditTransaction(txn, refresh) {
  const isPayment = txn.kind === 'payment';
  const quantity = h('input', { type: 'text', value: txn.quantity_input || txn.quantity || '' });
  const amount = h('input', { type: 'text', value: txn.payment_amount ?? '' });
  const override = h('input', { type: 'number', step: '0.01', value: txn.price_overridden ? txn.unit_price : '' });
  const when = h('input', { type: 'datetime-local', value: toDateTimeInput(txn.occurred_at) });
  const note = h('input', { type: 'text', value: txn.note || '' });

  return modal({
    title: `تعديل حركة #${txn.id}`,
    confirmText: 'حفظ',
    body: h('div.grid', {},
      h('div.muted', {}, `${txn.kind_label} — ${txn.entity_name || 'المستودع'} — ${txn.item_name || ''}`),
      isPayment ? h('label.field', {}, 'المبلغ', amount) : h('label.field', {}, 'الكمية', quantity),
      isPayment ? null : h('label.field', {}, 'سعر استثنائي لهاي الحركة (اختياري)', override),
      h('label.field', {}, 'التاريخ والوقت', when),
      h('label.field', {}, 'ملاحظة', note),
      h('div.alert.warn', {}, 'التعديل بينسجّل بسجل التدقيق وبيعيد حساب الأرصدة رجوعاً وللأمام.')),
    onConfirm: async () => {
      const payload = { note: note.value.trim(), occurred_at: inputToIso(when.value) };
      if (isPayment) payload.payment_amount = amount.value.trim();
      else {
        payload.quantity = quantity.value.trim();
        payload.unit_price_override = override.value === '' ? null : Number(override.value);
      }
      const result = await api.patch(`/api/transactions/${txn.id}`, payload);
      if (result.warnings?.length) toast(result.warnings[0].message, true);
      toast('تم التعديل');
      refresh();
    },
  });
}

// ================= الأصناف والأسعار =================
async function renderItems(root) {
  clear(root);
  const box = h('div');
  root.append(h('div.card.no-print', {},
    h('h3', {}, 'الأصناف'),
    h('button.btn', { onclick: () => openNewItem(refresh) }, '+ صنف جديد')), box);

  async function refresh() {
    const { items } = await api.get('/api/items', { include_inactive: 'true' });
    clear(box);
    box.append(h('div.card', {},
      h('h3', {}, 'قائمة الأصناف', h('span.sub', {}, `${items.length} صنف`)),
      table([
        { label: 'الصنف', render: (r) => h('span', {}, r.name, r.active ? null : h('span.pill', { style: 'margin-inline-start:6px' }, 'موقوف')) },
        { label: 'الوحدة', render: (r) => (r.unit === 'kg' ? 'وزن' : 'عدد') },
        { label: 'الرصيد', cls: 'num', render: (r) => qty(r.quantity, r.unit) },
        { label: 'السعر الحالي', cls: 'num', render: (r) => (r.current_price == null ? h('span.pill.warn', {}, 'بدون سعر') : money(r.current_price)) },
        { label: '', render: (r) => h('div.row', {},
          h('button.btn.gold.sm', { onclick: () => openPriceDialog(r, refresh) }, 'تغيير السعر'),
          h('button.btn.ghost.sm', { onclick: () => openPriceHistory(r) }, 'تاريخ الأسعار'),
          h('button.btn.ghost.sm', { onclick: () => openEditItem(r, refresh) }, 'تعديل')) },
      ], items, { rowClass: (r) => (r.quantity < 0 ? 'neg' : '') })));
  }
  await refresh();
}

/** تغيير السعر - بيسأل دايماً "من متى" */
export function openPriceDialog(item, refresh) {
  const price = h('input', { type: 'number', step: '0.01', min: '0', placeholder: 'السعر الجديد' });
  const effective = h('input', { type: 'date', value: todayString() });
  const note = h('input', { type: 'text', placeholder: 'سبب التغيير (اختياري)' });
  const preview = h('div.muted');

  const modeRow = h('div.row', {},
    h('button.btn.ghost.sm', { onclick: () => { effective.value = todayString(); update(); } }, 'من اليوم'),
    h('button.btn.ghost.sm', {
      onclick: () => { effective.value = weekStartString(); update(); },
    }, 'من بداية الأسبوع'));

  const update = () => {
    preview.textContent = `الحركات من ${effective.value} وجاي بتتحسب بالسعر الجديد، واللي قبله بتضل بسعرها القديم.`;
  };
  effective.addEventListener('change', update);
  update();

  return modal({
    title: `تغيير سعر: ${item.name}`,
    confirmText: 'حفظ السعر',
    body: h('div.grid', {},
      h('label.field', {}, 'السعر الجديد', price),
      h('label.field', {}, 'يسري من تاريخ', effective),
      modeRow,
      h('label.field', {}, 'ملاحظة', note),
      preview),
    onConfirm: async () => {
      if (price.value === '') throw new Error('أدخل السعر');
      const result = await api.post(`/api/items/${item.id}/prices`, {
        price: Number(price.value),
        effective_from: inputToIso(effective.value),
        note: note.value.trim() || undefined,
      });
      let message = `تم. ${result.affected_transactions} حركة تحدّثت.`;
      if (result.proposals?.length) message += ` وفي ${result.proposals.length} صنف مرتبط بده قرار منك.`;
      toast(message);
      refresh?.();
    },
  });
}

async function openPriceHistory(item) {
  const { prices } = await api.get(`/api/items/${item.id}/prices`);
  return modal({
    title: `تاريخ أسعار: ${item.name}`,
    confirmText: 'تمام',
    cancelText: 'إغلاق',
    body: table([
      { label: 'السعر', cls: 'num', render: (r) => money(r.price) },
      { label: 'يسري من', render: (r) => dateTime(r.effective_from) },
      { label: 'سجّله', render: (r) => r.created_by_name || '—' },
      { label: 'ملاحظة', render: (r) => r.note || '—' },
    ], prices, { empty: 'ما في أسعار مسجّلة' }),
  });
}

function openNewItem(refresh) {
  const name = h('input', { type: 'text' });
  const unit = h('select', {}, h('option', { value: 'piece' }, 'بالعدد'), h('option', { value: 'kg' }, 'بالوزن'));
  const price = h('input', { type: 'number', step: '0.01', placeholder: 'اختياري' });
  return modal({
    title: 'صنف جديد',
    confirmText: 'إضافة',
    body: h('div.grid', {},
      h('label.field', {}, 'اسم الصنف', name),
      h('label.field', {}, 'وحدة القياس', unit),
      h('label.field', {}, 'السعر', price)),
    onConfirm: async () => {
      if (!name.value.trim()) throw new Error('اكتب اسم الصنف');
      await api.post('/api/items', {
        name: name.value.trim(), unit: unit.value,
        price: price.value === '' ? undefined : Number(price.value),
      });
      toast('انضاف الصنف');
      refresh();
    },
  });
}

function openEditItem(item, refresh) {
  const name = h('input', { type: 'text', value: item.name });
  const unit = h('select', {},
    h('option', { value: 'piece', selected: item.unit === 'piece' }, 'بالعدد'),
    h('option', { value: 'kg', selected: item.unit === 'kg' }, 'بالوزن'));
  const active = h('input', { type: 'checkbox', checked: item.active });
  return modal({
    title: `تعديل: ${item.name}`,
    confirmText: 'حفظ',
    body: h('div.grid', {},
      h('label.field', {}, 'الاسم', name),
      h('label.field', {}, 'وحدة القياس', unit),
      h('label.field', {}, h('span', {}, 'فعّال'), active)),
    onConfirm: async () => {
      await api.patch(`/api/items/${item.id}`, {
        name: name.value.trim(), unit: unit.value, active: active.checked,
      });
      toast('تم التعديل');
      refresh();
    },
  });
}

// ================= المقادير =================
async function renderRecipes(root) {
  clear(root);
  const { items } = await api.get('/api/items');
  const select = h('select', { onchange: () => load(Number(select.value)) },
    h('option', { value: '' }, 'اختار صنف…'),
    items.map((i) => h('option', { value: i.id }, i.name)));
  const box = h('div');

  root.append(h('div.card.no-print', {},
    h('h3', {}, 'مقادير الأصناف', h('span.sub', {}, 'شو بده الصنف الجاهز من مواد خام لكل وحدة')),
    h('div.row', {}, h('label.field', {}, 'الصنف الجاهز', select))), box);

  async function load(itemId) {
    clear(box);
    if (!itemId) return;
    const item = items.find((i) => i.id === itemId);
    const data = await api.get(`/api/items/${itemId}/recipe`);
    const rows = data.components.map((c) => ({ ...c }));

    const listBox = h('div');
    const drawList = () => {
      clear(listBox);
      listBox.append(table([
        { label: 'المكوّن', key: 'component_name' },
        { label: 'الكمية لكل وحدة', cls: 'num', render: (r) => qty(r.quantity_per_unit, r.component_unit) },
        { label: '', render: (r) => h('button.btn.danger.sm', {
          onclick: () => { rows.splice(rows.indexOf(r), 1); drawList(); },
        }, 'حذف') },
      ], rows, { empty: 'ما في مقادير محدّدة لهذا الصنف' }));
    };
    drawList();

    const componentSelect = h('select', {},
      items.filter((i) => i.id !== itemId).map((i) => h('option', { value: i.id }, i.name)));
    const quantityInput = h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'الكمية' });

    box.append(h('div.card', {},
      h('h3', {}, `مقادير: ${item.name}`),
      h('div.grid.cols-4', { style: 'margin-bottom:12px' },
        stat('تكلفة المقادير', money(data.cost)),
        stat('سعر البيع الحالي', money(data.current_price)),
        stat('هامش الربح', money(data.margin))),
      !data.cost_complete && data.components.length
        ? h('div.alert.warn', {}, 'في مكوّن ما إله سعر — التكلفة مش كاملة.') : null,
      listBox,
      h('div.row', { style: 'margin-top:12px' },
        h('label.field', {}, 'مكوّن', componentSelect),
        h('label.field', {}, 'الكمية لكل وحدة', quantityInput),
        h('button.btn.ghost', {
          onclick: () => {
            const id = Number(componentSelect.value);
            const q = Number(quantityInput.value);
            if (!(q > 0)) return toast('أدخل كمية صحيحة', true);
            if (rows.some((r) => r.component_item_id === id)) return toast('المكوّن مضاف مسبقاً', true);
            const src = items.find((i) => i.id === id);
            rows.push({ component_item_id: id, component_name: src.name, component_unit: src.unit, quantity_per_unit: q });
            quantityInput.value = '';
            drawList();
          },
        }, '+ إضافة مكوّن')),
      h('div.row', { style: 'margin-top:14px' },
        h('button.btn', {
          onclick: async () => {
            await api.put(`/api/items/${itemId}/recipe`, {
              components: rows.map((r) => ({ component_item_id: r.component_item_id, quantity_per_unit: r.quantity_per_unit })),
            });
            toast('انحفظت المقادير');
            load(itemId);
          },
        }, 'حفظ المقادير'))));
  }
}

// ================= الحسابات =================
async function renderUsers(root) {
  clear(root);
  const box = h('div');
  root.append(h('div.card.no-print', {},
    h('h3', {}, 'الحسابات', h('span.sub', {}, 'إنت الوحيد اللي بتشوف بيانات الدخول')),
    h('button.btn', { onclick: () => openNewUser(refresh) }, '+ حساب جديد')), box);

  const ROLE_LABELS = { admin: 'مدير', recorder: 'مسجّل حركات', viewer: 'اطّلاع', customer: 'زبون' };
  let revealed = false;

  async function refresh() {
    const { users } = await api.get('/api/users');
    clear(box);
    box.append(h('div.card', {},
      h('h3', {}, 'كل الحسابات',
        h('div', { style: 'flex:1' }),
        h('button.btn.ghost.sm', {
          onclick: () => { revealed = !revealed; refresh(); },
        }, revealed ? 'إخفاء كلمات السر' : 'إظهار كلمات السر')),
      table([
        { label: 'الاسم', key: 'display_name' },
        { label: 'الصلاحية', render: (r) => ROLE_LABELS[r.role] },
        { label: 'الجهة', render: (r) => r.entity_name || '—' },
        { label: 'اسم المستخدم', render: (r) => h('code', {}, r.username) },
        { label: 'كلمة السر', render: (r) => (revealed ? h('code', {}, r.password || '(مشفّرة بمفتاح قديم)') : '••••••') },
        { label: 'تنبيهات', render: (r) => (r.notifications_on ? 'مفعّلة' : 'مطفيّة') },
        { label: 'الحالة', render: (r) => (r.active ? h('span.pill.in', {}, 'فعّال') : h('span.pill.out', {}, 'موقوف')) },
        { label: '', render: (r) => h('button.btn.ghost.sm', { onclick: () => openEditUser(r, refresh) }, 'تعديل') },
      ], users)));
  }
  await refresh();
}

async function openNewUser(refresh) {
  const { entities } = await api.get('/api/users/entities');
  const username = h('input', { type: 'text' });
  const displayName = h('input', { type: 'text' });
  const role = h('select', {},
    h('option', { value: 'recorder' }, 'مسجّل حركات'),
    h('option', { value: 'viewer' }, 'اطّلاع (قراءة فقط)'),
    h('option', { value: 'customer' }, 'زبون'),
    h('option', { value: 'admin' }, 'مدير'));
  const entity = h('select', {}, h('option', { value: '' }, '—'),
    entities.map((e) => h('option', { value: e.id }, e.name)));
  const password = h('input', { type: 'text' });
  const notifications = h('input', { type: 'checkbox', checked: true });

  return modal({
    title: 'حساب جديد',
    confirmText: 'إنشاء',
    body: h('div.grid', {},
      h('label.field', {}, 'الاسم', displayName),
      h('label.field', {}, 'اسم المستخدم', username),
      h('label.field', {}, 'كلمة السر', password),
      h('label.field', {}, 'الصلاحية', role),
      h('label.field', {}, 'الجهة (للزبون)', entity),
      h('label.field', {}, h('span', {}, 'يستقبل تنبيهات'), notifications)),
    onConfirm: async () => {
      await api.post('/api/users', {
        username: username.value.trim(), display_name: displayName.value.trim(),
        role: role.value, password: password.value,
        entity_id: entity.value || null, notifications_on: notifications.checked,
      });
      toast('انشأ الحساب');
      refresh();
    },
  });
}

function openEditUser(user, refresh) {
  const username = h('input', { type: 'text', value: user.username });
  const password = h('input', { type: 'text', placeholder: 'اتركها فاضية إذا ما بدك تغيّرها' });
  const active = h('input', { type: 'checkbox', checked: user.active });
  const notifications = h('input', { type: 'checkbox', checked: user.notifications_on });

  return modal({
    title: `تعديل حساب: ${user.display_name}`,
    confirmText: 'حفظ',
    body: h('div.grid', {},
      h('label.field', {}, 'اسم المستخدم', username),
      h('label.field', {}, 'كلمة سر جديدة', password),
      h('label.field', {}, h('span', {}, 'فعّال'), active),
      h('label.field', {}, h('span', {}, 'يستقبل تنبيهات'), notifications)),
    onConfirm: async () => {
      const payload = {
        username: username.value.trim(), active: active.checked,
        notifications_on: notifications.checked,
      };
      if (password.value) payload.password = password.value;
      await api.patch(`/api/users/${user.id}`, payload);
      toast('تم التعديل');
      refresh();
    },
  });
}

// ================= طلبات الزباين =================
async function renderRequests(root) {
  clear(root);
  const box = h('div');
  root.append(box);
  const refresh = async () => {
    const { requests } = await api.get('/api/requests');
    clear(box);
    box.append(h('div.card', {},
      h('h3', {}, 'طلبات وملاحظات الزباين'),
      table([
        { label: 'الزبون', key: 'entity_name' },
        { label: 'الطلب', key: 'body' },
        { label: 'التاريخ', render: (r) => dateTime(r.created_at) },
        { label: 'الحالة', render: (r) => (r.handled ? h('span.pill.in', {}, 'تمّ') : h('span.pill.warn', {}, 'مفتوح')) },
        { label: '', render: (r) => h('button.btn.ghost.sm', {
          onclick: async () => { await api.patch(`/api/requests/${r.id}`, { handled: !r.handled }); refresh(); },
        }, r.handled ? 'إعادة فتح' : 'تم التعامل معه') },
      ], requests, { empty: 'ما في طلبات' })));
  };
  await refresh();
}

// ================= سجل التدقيق =================
async function renderAudit(root) {
  clear(root);
  const box = h('div');
  const actionSelect = h('select', { onchange: () => refresh() },
    h('option', { value: '' }, 'كل العمليات'),
    h('option', { value: 'update' }, 'تعديل'),
    h('option', { value: 'delete' }, 'حذف'),
    h('option', { value: 'create' }, 'إضافة'));
  const showLogins = h('input', { type: 'checkbox', onchange: () => refresh() });

  root.append(h('div.card.no-print', {},
    h('h3', {}, 'سجل التدقيق', h('span.sub', {}, 'كل تعديل وحذف: مين، إمتى، شو كان وشو صار')),
    h('div.row', {},
      h('label.field', {}, 'نوع العملية', actionSelect),
      h('label.field', {}, h('span', {}, 'إظهار عمليات الدخول'), showLogins))), box);

  async function refresh() {
    const { entries } = await api.get('/api/audit', {
      action: actionSelect.value, hide_logins: showLogins.checked ? 'false' : 'true', limit: 300,
    });
    clear(box);
    box.append(h('div.card', {},
      table([
        { label: 'الوقت', render: (r) => dateTime(r.created_at) },
        { label: 'مين', render: (r) => r.user_display_name || r.username || '—' },
        { label: 'العملية', render: (r) => h('span.pill', { class: r.action === 'delete' ? 'out' : r.action === 'create' ? 'in' : '' }, r.action_label) },
        { label: 'على', key: 'table_label' },
        { label: 'التفاصيل', key: 'summary' },
        { label: '', render: (r) => ((r.before_data || r.after_data)
          ? h('button.btn.ghost.sm', { onclick: () => showDiff(r) }, 'قبل / بعد') : '—') },
      ], entries, { empty: 'السجل فاضي' })));
  }

  function showDiff(entry) {
    const fmt = (obj) => h('pre', {
      style: 'background:#F7F4EA;padding:10px;border-radius:8px;overflow:auto;max-height:240px;direction:ltr;text-align:left;font-size:12px',
    }, obj ? JSON.stringify(obj, null, 2) : '—');
    return modal({
      title: `${entry.action_label} — ${entry.table_label}`,
      confirmText: 'تمام', cancelText: 'إغلاق', wide: true,
      body: h('div.grid.cols-2', {},
        h('div', {}, h('b', {}, 'قبل'), fmt(entry.before_data)),
        h('div', {}, h('b', {}, 'بعد'), fmt(entry.after_data))),
    });
  }

  await refresh();
}
