// مكوّنات مشتركة بين صفحة الأدمن وصفحة الاطّلاع
import { api } from '../api.js';
import { h, clear, money, qty, dateTime, dateOnly, table, toast, downloadCsv, todayString, KIND_PILL, METHOD_LABELS } from '../ui.js';

/** شريط اختيار الفترة: أسبوعي (يبلّش السبت) أو مدى مخصّص */
export function periodPicker(onChange) {
  let mode = 'week';
  let offset = 0;
  const from = h('input', { type: 'date', value: todayString() });
  const to = h('input', { type: 'date', value: todayString() });
  const customBox = h('div.row', { style: 'display:none' },
    h('label.field', {}, 'من', from),
    h('label.field', {}, 'إلى', to),
    h('button.btn.sm', { onclick: () => emit() }, 'اعرض'));

  const buttons = h('div.row');
  const emit = () => onChange(mode === 'week' ? { week: offset } : { from: from.value, to: to.value });

  const setMode = (newMode, newOffset = 0) => {
    mode = newMode; offset = newOffset;
    customBox.style.display = mode === 'custom' ? 'flex' : 'none';
    for (const b of buttons.querySelectorAll('button')) b.classList.remove('gold');
    buttons.querySelector(`[data-key="${mode}${mode === 'week' ? offset : ''}"]`)?.classList.add('gold');
    if (mode !== 'custom') emit();
  };

  buttons.append(
    h('button.btn.ghost.sm', { dataset: { key: 'week0' }, onclick: () => setMode('week', 0) }, 'هذا الأسبوع'),
    h('button.btn.ghost.sm', { dataset: { key: 'week-1' }, onclick: () => setMode('week', -1) }, 'الأسبوع اللي فات'),
    h('button.btn.ghost.sm', { dataset: { key: 'week-2' }, onclick: () => setMode('week', -2) }, 'قبل أسبوعين'),
    h('button.btn.ghost.sm', { dataset: { key: 'custom' }, onclick: () => setMode('custom') }, 'فترة مخصّصة'),
  );

  const box = h('div', {}, buttons, customBox);
  setTimeout(() => setMode('week', 0), 0);
  return box;
}

/** تقرير الستوك اللحظي */
export async function renderStock(root) {
  clear(root);
  const body = h('div');
  root.append(body);

  const { items, summary } = await api.get('/api/stock');
  clear(body);

  body.append(h('div.grid.cols-4', {},
    stat('عدد الأصناف', summary.total_items),
    stat('قيمة الستوك', money(summary.total_value)),
    stat('أصناف تحت الصفر', summary.negative_count, summary.negative_count > 0),
    stat('أصناف بدون سعر', summary.missing_price_count, summary.missing_price_count > 0)));

  if (summary.negative_count > 0) {
    body.append(h('div.alert.danger.big', {}, '⚠',
      h('span', {}, `في ${summary.negative_count} صنف رصيده تحت الصفر — الكمية المسحوبة أكتر من المتوفر`)));
  }

  body.append(h('div.card', {},
    h('h3', {}, 'الستوك اللحظي',
      h('div', { style: 'flex:1' }),
      h('button.btn.ghost.sm.no-print', {
        onclick: () => downloadCsv('stock.csv', ['الصنف', 'الوحدة', 'الكمية', 'السعر', 'القيمة'],
          items.map((i) => [i.item_name, i.unit === 'kg' ? 'وزن' : 'عدد', i.quantity, i.current_price ?? '', i.value ?? ''])),
      }, 'تصدير CSV')),
    table([
      { label: 'الصنف', key: 'item_name' },
      { label: 'الوحدة', render: (r) => (r.unit === 'kg' ? 'وزن' : 'عدد') },
      { label: 'الكمية', cls: 'num', render: (r) => qty(r.quantity, r.unit) },
      { label: 'سعر الوحدة', cls: 'num', render: (r) => (r.current_price == null ? h('span.pill.warn', {}, 'بدون سعر') : money(r.current_price)) },
      { label: 'قيمة الرصيد', cls: 'num', render: (r) => money(r.value) },
      { label: 'مقادير', render: (r) => (r.has_recipe ? h('span.pill.in', {}, 'إله وصفة') : '—') },
      { label: 'آخر حركة', render: (r) => dateTime(r.last_movement_at) },
    ], items, { rowClass: (r) => (r.negative ? 'neg' : '') })));
}

function stat(label, value, danger = false) {
  return h('div.stat', { class: danger ? 'danger' : '' },
    h('div.label', {}, label), h('div.value', {}, String(value)));
}

/** كشوفات الحسابات */
export async function renderStatements(root) {
  clear(root);
  const summaryBox = h('div');
  const detailBox = h('div');
  let params = { week: 0 };
  let selectedEntity = null;

  const picker = periodPicker((p) => { params = p; refresh(); });
  root.append(h('div.card.no-print', {}, h('h3', {}, 'الفترة'), picker), summaryBox, detailBox);

  async function refresh() {
    const data = await api.get('/api/statements', params);
    clear(summaryBox);
    summaryBox.append(h('div.card', {},
      h('h3', {}, 'أرصدة الزباين', h('span.sub', {}, data.period.label)),
      table([
        { label: 'الزبون', render: (r) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); openStatement(r.entity_id); } }, r.entity_name) },
        { label: 'رصيد أول الفترة', cls: 'num', render: (r) => money(r.opening_balance) },
        { label: 'حركة الفترة', cls: 'num', render: (r) => money(r.period_change) },
        { label: 'إجمالي السحوبات', cls: 'num', render: (r) => money(r.total_withdrawn) },
        { label: 'إجمالي المدفوع', cls: 'num', render: (r) => money(r.total_paid) },
        { label: 'الرصيد الحالي (الدين)', cls: 'num', render: (r) => h('b', {}, money(r.balance)) },
        { label: '', render: (r) => (r.pending_price_count > 0 ? h('span.pill.warn', {}, `${r.pending_price_count} بسعر معلّق`) : '') },
      ], data.customers, {
        footer: h('tr', {},
          h('td', {}, 'الإجمالي'), h('td'), h('td'),
          h('td.num', {}, money(data.totals.total_withdrawn)),
          h('td.num', {}, money(data.totals.total_paid)),
          h('td.num', {}, money(data.totals.balance)), h('td')),
      })));

    if (selectedEntity) openStatement(selectedEntity);
  }

  async function openStatement(entityId) {
    selectedEntity = entityId;
    const data = await api.get(`/api/statements/${entityId}`, params);
    clear(detailBox);
    detailBox.append(statementCard(data));
  }

  refresh();
}

/** بطاقة كشف حساب واحد (بتستعمل كمان بصفحة الزبون) */
export function statementCard(data) {
  const rows = data.lines;
  return h('div.card', {},
    h('h3', {}, `كشف حساب: ${data.entity.name}`,
      h('span.sub', {}, data.period.label),
      h('div', { style: 'flex:1' }),
      h('button.btn.ghost.sm.no-print', { onclick: () => window.print() }, 'طباعة'),
      h('button.btn.ghost.sm.no-print', {
        onclick: () => downloadCsv(`statement-${data.entity.name}.csv`,
          ['التاريخ', 'البيان', 'الصنف', 'الكمية', 'سعر الوحدة', 'مدين', 'دائن', 'الرصيد'],
          rows.map((r) => [dateTime(r.occurred_at), r.kind_label, r.item_name || '', r.quantity ?? '',
            r.unit_price ?? '', r.kind === 'customer_out' ? r.amount : '',
            r.kind === 'payment' ? r.payment_amount : (r.kind === 'customer_return' ? r.amount : ''),
            r.running_balance])),
      }, 'تصدير CSV')),

    h('div.grid.cols-4', { style: 'margin-bottom:14px' },
      stat('الرصيد الافتتاحي', money(data.opening_balance)),
      stat('سحوبات الفترة', money(data.totals.withdrawals)),
      stat('دفعات الفترة', money(data.totals.payments)),
      stat('الرصيد الختامي', money(data.closing_balance))),

    data.totals.pending_price_lines > 0
      ? h('div.alert.warn', {}, `في ${data.totals.pending_price_lines} حركة بسعر معلّق — ما بتنحسب لحد ما يتحدّد سعر الصنف.`)
      : null,

    table([
      { label: 'التاريخ والوقت', render: (r) => dateTime(r.occurred_at) },
      { label: 'البيان', render: (r) => h('span.pill', { class: KIND_PILL[r.kind] || '' }, r.kind_label) },
      { label: 'الصنف', render: (r) => r.item_name || (r.method ? METHOD_LABELS[r.method] : '—') },
      { label: 'الكمية', cls: 'num', render: (r) => (r.quantity == null ? '—' : qty(r.quantity, r.item_unit)) },
      { label: 'سعر الوحدة', cls: 'num', render: (r) => (r.price_pending ? h('span.pill.warn', {}, 'معلّق') : money(r.unit_price)) },
      { label: 'مدين (عليه)', cls: 'num', render: (r) => (r.kind === 'customer_out' ? money(r.amount) : '—') },
      { label: 'دائن (إله)', cls: 'num', render: (r) => (r.kind === 'payment' ? money(r.payment_amount) : r.kind === 'customer_return' ? money(r.amount) : '—') },
      { label: 'الرصيد', cls: 'num', render: (r) => h('b', {}, money(r.running_balance)) },
      { label: 'ملاحظة', render: (r) => r.note || '—' },
    ], rows, {
      empty: 'ما في حركات بهاي الفترة',
      footer: h('tr', {},
        h('td', { colspan: 5 }, 'الرصيد الختامي'),
        h('td.num', {}, money(data.totals.withdrawals)),
        h('td.num', {}, money(Math.round((data.totals.payments + data.totals.returns) * 100) / 100)),
        h('td.num', {}, money(data.closing_balance)), h('td')),
    }));
}

/** تقرير النقص/الفاقد */
export async function renderLoss(root) {
  clear(root);
  const box = h('div');
  let params = { week: 0 };
  const picker = periodPicker((p) => { params = p; refresh(); });
  root.append(h('div.card.no-print', {}, h('h3', {}, 'الفترة'), picker,
    h('div.muted', { style: 'margin-top:6px' },
      'التقرير بيقارن المتوقّع حسب المقادير مع الفعلي اللي رجع من المشغل.')), box);

  async function refresh() {
    const data = await api.get('/api/reports/loss', params);
    clear(box);

    box.append(h('div.grid.cols-4', {},
      stat('قيمة الفاقد', money(data.summary.total_loss_value), data.summary.total_loss_value > 0),
      stat('أصناف فيها نقص', data.summary.items_with_loss, data.summary.items_with_loss > 0)));

    box.append(h('div.card', {},
      h('h3', {}, 'الإنتاج: المتوقّع مقابل الفعلي', h('span.sub', {}, data.period.label)),
      table([
        { label: 'الصنف الجاهز', key: 'item_name' },
        { label: 'رجع فعلياً', cls: 'num', render: (r) => qty(r.actual_output, r.unit) },
        { label: 'المفروض يرجع', cls: 'num', render: (r) => qty(r.expected_output, r.unit) },
        { label: 'النقص', cls: 'num', render: (r) => (r.loss_units > 0 ? h('b', { style: 'color:#B3261E' }, qty(r.loss_units, r.unit)) : qty(r.loss_units, r.unit)) },
        { label: 'نسبة النقص', cls: 'num', render: (r) => (r.loss_percent == null ? '—' : `${r.loss_percent}%`) },
        { label: 'المكوّنات', render: (r) => r.components.map((c) => `${c.component_name}: طلع ${c.allocated_issued} / لزم ${c.required}`).join(' • ') },
      ], data.production, { empty: 'ما في عمليات تصنيع بهاي الفترة', rowClass: (r) => (r.loss_units > 0 ? 'neg' : '') })));

    box.append(h('div.card', {},
      h('h3', {}, 'المواد الخام: المستهلك مقابل المطلوب'),
      table([
        { label: 'المادة', key: 'item_name' },
        { label: 'طلع للمشغل', cls: 'num', render: (r) => qty(r.issued, r.unit) },
        { label: 'المطلوب حسب الوصفة', cls: 'num', render: (r) => qty(r.required, r.unit) },
        { label: 'الفرق', cls: 'num', render: (r) => qty(r.difference, r.unit) },
        { label: 'قيمة الفرق', cls: 'num', render: (r) => money(r.loss_value) },
      ], data.components, { empty: 'ما في مواد خام طلعت بهاي الفترة' })));

    if (data.unlinked_issues.length) {
      box.append(h('div.card', {},
        h('h3', {}, 'مواد طلعت للمشغل بدون وصفة مرتبطة',
          h('span.sub', {}, 'حدّد مقاديرها عشان تدخل بحساب الفاقد')),
        table([
          { label: 'المادة', key: 'item_name' },
          { label: 'الكمية', cls: 'num', render: (r) => qty(r.issued, r.unit) },
        ], data.unlinked_issues)));
    }
  }
}

/** سجل الحركات */
export async function renderTransactions(root, { editable = false, onEdit, onDelete } = {}) {
  clear(root);
  const box = h('div');
  const filters = h('div.row');
  let params = { week: 0 };

  const entitySelect = h('select', { onchange: () => refresh() }, h('option', { value: '' }, 'كل الجهات'));
  const kindSelect = h('select', { onchange: () => refresh() }, h('option', { value: '' }, 'كل الأنواع'));

  const { entities } = await api.get('/api/users/entities');
  for (const e of entities) entitySelect.append(h('option', { value: e.id }, e.name));
  const { kinds } = await api.get('/api/transactions/meta/kinds');
  for (const k of kinds) kindSelect.append(h('option', { value: k.value }, k.label));

  filters.append(
    h('label.field', {}, 'الجهة', entitySelect),
    h('label.field', {}, 'نوع الحركة', kindSelect));

  const picker = periodPicker((p) => { params = p; refresh(); });
  root.append(h('div.card.no-print', {}, h('h3', {}, 'فلترة'), picker, filters), box);

  async function refresh() {
    const data = await api.get('/api/transactions', {
      ...params, entity_id: entitySelect.value, kind: kindSelect.value, limit: 500,
    });
    clear(box);
    const columns = [
      { label: '#', key: 'id' },
      { label: 'التاريخ والوقت', render: (r) => dateTime(r.occurred_at) },
      { label: 'النوع', render: (r) => h('span.pill', { class: KIND_PILL[r.kind] || '' }, r.kind_label) },
      { label: 'الجهة', render: (r) => r.entity_name || 'المستودع' },
      { label: 'الصنف', render: (r) => r.item_name || '—' },
      { label: 'الكمية', cls: 'num', render: (r) => (r.quantity == null ? '—' : qty(r.quantity, r.item_unit)) },
      { label: 'سعر الوحدة', cls: 'num', render: (r) => (r.price_pending ? h('span.pill.warn', {}, 'معلّق') : money(r.unit_price)) },
      { label: 'المبلغ', cls: 'num', render: (r) => money(r.amount ?? r.payment_amount) },
      { label: 'سجّلها', render: (r) => r.created_by_name || '—' },
      { label: 'ملاحظة', render: (r) => r.note || '—' },
    ];
    if (editable) {
      columns.push({
        label: '', cls: 'no-print', render: (r) => h('div.row', {},
          h('button.btn.ghost.sm', { onclick: () => onEdit(r, refresh) }, 'تعديل'),
          h('button.btn.danger.sm', { onclick: () => onDelete(r, refresh) }, 'حذف')),
      });
    }
    box.append(h('div.card', {},
      h('h3', {}, 'الحركات', h('span.sub', {}, `${data.transactions.length} حركة`)),
      table(columns, data.transactions, { empty: 'ما في حركات' })));
  }

  refresh();
  return { refresh };
}

export { stat };
