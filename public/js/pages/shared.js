// مكوّنات مشتركة بين صفحة الأدمن وصفحة الاطّلاع
import { api } from '../api.js';
import { state, h, clear, money, num, qty, dateTime, dateOnly, table, modal, toast, downloadCsv, printElement, printHead, todayString, countItems, KIND_PILL, METHOD_LABELS } from '../ui.js';
import { icon } from '../icons.js';

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

  const buttons = h('div.segment');
  const emit = () => onChange(mode === 'week' ? { week: offset } : { from: from.value, to: to.value });

  const setMode = (newMode, newOffset = 0) => {
    mode = newMode; offset = newOffset;
    customBox.style.display = mode === 'custom' ? 'flex' : 'none';
    for (const b of buttons.querySelectorAll('button')) b.classList.remove('active');
    buttons.querySelector(`[data-key="${mode}${mode === 'week' ? offset : ''}"]`)?.classList.add('active');
    if (mode !== 'custom') emit();
  };

  buttons.append(
    h('button', { dataset: { key: 'week0' }, onclick: () => setMode('week', 0) }, 'هذا الأسبوع'),
    h('button', { dataset: { key: 'week-1' }, onclick: () => setMode('week', -1) }, 'الأسبوع اللي فات'),
    h('button', { dataset: { key: 'week-2' }, onclick: () => setMode('week', -2) }, 'قبل أسبوعين'),
    h('button', { dataset: { key: 'custom' }, onclick: () => setMode('custom') }, 'فترة مخصّصة'),
  );

  const box = h('div.toolbar', {}, buttons, h('div.spacer'), customBox);
  setTimeout(() => setMode('week', 0), 0);
  return box;
}

/** تقرير الستوك اللحظي */
export async function renderStock(root, ctx) {
  clear(root);
  const body = h('div');
  root.append(body);

  const { items, summary } = await api.get('/api/stock');
  clear(body);
  ctx?.actions?.append(h('button.btn.ghost.no-print', {
    onclick: () => downloadCsv('stock.csv', ['الصنف', 'الوحدة', 'الكمية', 'السعر', 'القيمة'],
      items.map((i) => [i.item_name, i.unit === 'kg' ? 'وزن' : 'عدد', i.quantity, i.current_price ?? '', i.value ?? ''])),
  }, icon('download', 16), 'تصدير'));

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
    h('h3', {}, 'كل الأصناف', h('span.sub', {}, `${items.length} صنف`)),
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
export async function renderStatements(root, ctx) {
  clear(root);
  const summaryBox = h('div');
  const detailBox = h('div');
  let params = { week: 0 };
  let selectedEntity = null;

  const picker = periodPicker((p) => { params = p; refresh(); });
  root.append(picker, summaryBox, detailBox);

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

/**
 * بطاقة كشف حساب واحد (بتستعمل كمان بصفحة الزبون).
 *
 * الكشف مبني عشان ينطبع: مجمّع بالأيام مع مجموع لكل يوم، وترويسة بتتكرّر
 * على كل صفحة، وسطر ختامي واضح بالآخر. زي ما كان الكشف بالنظام القديم -
 * أبو بلال بيمسك الورقة وبيقرأ يوم يوم بدل ما يلاحق صفوف متلاصقة.
 */
export function statementCard(data) {
  const rows = data.lines;
  const name = data.entity.name;
  const closing = Number(data.closing_balance || 0);
  const credited = Math.round((Number(data.totals.payments) + Number(data.totals.returns)) * 1000) / 1000;

  const debitOf  = (r) => (r.kind === 'customer_out' ? Number(r.amount || 0) : 0);
  const creditOf = (r) => (r.kind === 'payment' ? Number(r.payment_amount || 0)
    : r.kind === 'customer_return' ? Number(r.amount || 0) : 0);

  const card = h('div.card.sheet', {},
    printHead(`كشف حساب — ${name}`, data.period.label),

    h('h3.no-print', {}, `كشف حساب: ${name}`,
      h('span.sub', {}, data.period.label),
      h('div', { style: 'flex:1' }),
      h('button.btn.ghost.sm', { onclick: () => printElement(card) }, icon('print', 14), 'طباعة'),
      h('button.btn.ghost.sm', {
        onclick: () => downloadCsv(`statement-${name}.csv`,
          ['التاريخ', 'البيان', 'الصنف', 'الكمية', 'سعر الوحدة', 'مدين', 'دائن', 'الرصيد'],
          rows.map((r) => [dateTime(r.occurred_at), r.kind_label, r.item_name || '', r.quantity ?? '',
            r.unit_price ?? '', debitOf(r) || '', creditOf(r) || '', r.running_balance])),
      }, 'تصدير CSV')),

    h('div.sheet-stats', {},
      stat('الرصيد الافتتاحي', money(data.opening_balance)),
      stat('سحوبات الفترة', money(data.totals.withdrawals)),
      Number(data.totals.returns) ? stat('إرجاعات الفترة', money(data.totals.returns)) : null,
      stat('دفعات الفترة', money(data.totals.payments)),
      stat('الرصيد الختامي', money(closing))),

    h('div.sheet-note', {}, `كل المبالغ بالدينار الأردني (${state.currency}) — ٣ منازل عشرية (فلس)`),

    data.totals.pending_price_lines > 0
      ? h('div.alert.warn', {}, `في ${data.totals.pending_price_lines} حركة بسعر معلّق — ما بتنحسب لحد ما يتحدّد سعر الصنف.`)
      : null);

  if (!rows.length) {
    card.append(h('div.empty', {}, 'ما في حركات بهاي الفترة'));
    return card;
  }

  // تجميع بالأيام: الصفوف جاية مرتّبة بالوقت، فالأيام بتتجمّع بمرّة وحدة
  const days = [];
  for (const r of rows) {
    const day = dateOnly(r.occurred_at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else days.push({ day, rows: [r] });
  }

  const COLS = 9;
  const tbody = h('tbody');
  for (const group of days) {
    const label = dayName(group.rows[0].occurred_at);
    group.rows.forEach((r, i) => {
      tbody.append(h('tr', {},
        // خلية اليوم بتمتد على كل صفوف اليوم - زي عمود اليوم بالكشف الورقي
        i === 0 ? h('td.day-cell', { rowspan: group.rows.length },
          h('b', {}, label), h('small', {}, group.day)) : null,
        h('td', {}, h('span.pill', { class: KIND_PILL[r.kind] || '' }, r.kind_label)),
        h('td', {}, r.item_name || (r.method ? METHOD_LABELS[r.method] : '—')),
        h('td.num', {}, r.quantity == null ? '—' : qty(r.quantity, r.item_unit)),
        h('td.num', {}, r.price_pending ? h('span.pill.warn', {}, 'معلّق') : num(r.unit_price)),
        h('td.num', {}, debitOf(r) ? num(r.amount) : '—'),
        h('td.num', {}, creditOf(r) ? num(creditOf(r)) : '—'),
        h('td.num', {}, h('b', {}, num(r.running_balance))),
        h('td.note', {}, r.note || '—')));
    });
    const dayDebit  = group.rows.reduce((sum, r) => sum + debitOf(r), 0);
    const dayCredit = group.rows.reduce((sum, r) => sum + creditOf(r), 0);
    tbody.append(h('tr.day-sum', {},
      h('td', { colspan: 5 }, `مجموع ${label}`),
      h('td.num', {}, num(dayDebit)),
      h('td.num', {}, num(dayCredit)),
      h('td.num', {}, num(group.rows[group.rows.length - 1].running_balance)),
      h('td')));
  }

  const head = (label, cls = '') => h(`th${cls}`, {}, label);
  card.append(h('div.table-wrap', {}, h('table.sheet-table', {},
    h('thead', {},
      // بتتكرّر على كل صفحة مطبوعة: مين الكشف ولأي فترة
      h('tr.sheet-title', {}, h('th', { colspan: COLS }, `كشف حساب — ${name} · ${data.period.label}`)),
      h('tr', {},
        head('اليوم'), head('البيان'), head('الصنف'),
        head('الكمية', '.num'), head('سعر الوحدة', '.num'),
        head('مدين (عليه)', '.num'), head('دائن (إله)', '.num'),
        head('الرصيد', '.num'), head('ملاحظة'))),
    tbody,
    h('tfoot', {},
      h('tr', {},
        h('td', { colspan: 5 }, 'إجمالي الفترة'),
        h('td.num', {}, num(data.totals.withdrawals)),
        h('td.num', {}, num(credited)),
        h('td.num', {}, num(closing)),
        h('td')),
      h('tr.sheet-net', {},
        h('td', { colspan: 8 },
          `الرصيد الختامي ${closing > 0 ? `— المطلوب من ${name}` : closing < 0 ? `— رصيد إله` : '— مسكّر'}`),
        h('td.num', {}, h('b', {}, money(closing))))))));

  card.append(h('div.print-foot', {},
    h('span', {}, `نظام مستودعات المفلح — كشف ${name}`),
    h('span', {}, data.period.label)));

  return card;
}

/** تقرير النقص/الفاقد */
export async function renderLoss(root, ctx) {
  clear(root);
  const box = h('div');
  let params = { week: 0 };
  const picker = periodPicker((p) => { params = p; refresh(); });
  root.append(picker,
    h('div.muted', { style: 'margin:-6px 2px 16px' },
      'التقرير بيقارن المتوقّع حسب المقادير مع الفعلي اللي رجع من المشغل.'), box);

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
export async function renderTransactions(root, { editable = false, onEdit, onDelete, ctx } = {}) {
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
  picker.append(filters);
  root.append(picker, box);

  async function refresh() {
    const data = await api.get('/api/transactions', {
      ...params, entity_id: entitySelect.value, kind: kindSelect.value, limit: 500,
    });
    clear(box);
    const columns = [
      { label: '#', key: 'id' },
      { label: 'السند', render: (r) => (r.voucher_no ? h('span.voucher-no', {}, `#${r.voucher_no}`) : '—') },
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

/**
 * قائمة حركات بنمط بطاقات الصفوف، مجمّعة حسب اليوم.
 * الصف بيوسّع لتفاصيله بضغطة - نفس نمط لوحات المواعيد.
 */
export function entryList(transactions, { onEdit, onDelete, refresh } = {}) {
  const box = h('div');
  if (!transactions.length) return h('div.empty', {}, 'ما في حركات');

  const groups = new Map();
  for (const t of transactions) {
    const day = dateOnly(t.occurred_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }

  const today = todayString();
  for (const [day, rows] of groups) {
    const label = day === today ? 'اليوم' : dayName(rows[0].occurred_at);
    box.append(h('div.day-group', {},
      h('div.day-head', {}, h('b', {}, label), h('span', {}, day)),
      rows.map((t) => entryRow(t, { onEdit, onDelete, refresh }))));
  }
  return box;
}

const dayName = (iso) => dateTime(iso).split(' ')[0];

function entryRow(t, { onEdit, onDelete, refresh } = {}) {
  const more = h('div.entry-more', { style: 'display:none' });
  let open = false;
  const toggle = h('button.link-more', {
    onclick: () => {
      open = !open;
      more.style.display = open ? 'flex' : 'none';
      row.classList.toggle('open', open);
      toggle.textContent = open ? 'إخفاء' : 'التفاصيل';
    },
  }, 'التفاصيل');

  const field = (k, v) => h('div.field', {}, h('span.k', {}, k), h('span.v', {}, v));

  more.append(
    t.voucher_no ? field('السند', `#${t.voucher_no}`) : null,
    t.note ? field('ملاحظة', t.note) : null,
    t.created_by_name ? field('سجّلها', t.created_by_name) : null,
    field('الوقت', dateTime(t.occurred_at)),
    h('div', { style: 'flex:1' }),
    onEdit ? h('div.row', {},
      h('button.btn.ghost.sm', { onclick: () => onEdit(t, refresh) }, 'تعديل'),
      h('button.btn.danger.sm', { onclick: () => onDelete(t, refresh) }, 'حذف')) : null);

  const row = h('div.entry', {},
    h('div.entry-main', {},
      h('span.pill', { class: KIND_PILL[t.kind] || '' }, t.kind_label),
      field('الجهة', t.entity_name || 'المستودع'),
      t.item_name ? field('الصنف', t.item_name) : field('طريقة الدفع', METHOD_LABELS[t.method] || '—'),
      t.quantity != null ? field('الكمية', qty(t.quantity, t.item_unit)) : null,
      h('div.spacer'),
      t.amount != null || t.payment_amount != null
        ? field('المبلغ', money(t.amount ?? t.payment_amount)) : null,
      t.price_pending ? h('span.pill.warn', {}, 'سعر معلّق') : null,
      toggle),
    more);
  return row;
}

export { stat };


/**
 * صفحة السندات: كل سند برقمه وجرده الكامل.
 * عبود بيثبّتها، وقصي وأبو بلال بيراجعوها سند سند بدل ما يفتّشوا بالحركات.
 */
/** الحركات المسعّرة بس إلها مبالغ - سندات المشغل والتوريد كمّية بحتة */
const PRICED_KINDS = new Set(['customer_out', 'customer_return']);

export async function renderVouchers(root, { editable = false } = {}) {
  clear(root);
  const box = h('div');
  let params = { week: 0 };

  const entitySelect = h('select', { onchange: () => refresh() }, h('option', { value: '' }, 'كل الجهات'));
  const { entities } = await api.get('/api/users/entities');
  for (const e of entities) entitySelect.append(h('option', { value: e.id }, e.name));

  const picker = periodPicker((p) => { params = p; refresh(); });
  picker.append(h('div.row', {}, h('label.field', {}, 'الجهة', entitySelect)));
  root.append(picker, box);

  async function refresh() {
    const { vouchers } = await api.get('/api/vouchers', {
      ...params, entity_id: entitySelect.value, limit: 300,
    });
    clear(box);
    const columns = [
      { label: 'رقم السند', render: (v) => h('span.voucher-no', {}, `#${v.voucher_no}`) },
      { label: 'التاريخ والوقت', render: (v) => dateTime(v.occurred_at) },
      { label: 'النوع', render: (v) => h('span.pill', { class: KIND_PILL[v.kind] || '' }, v.kind_label) },
      { label: 'الجهة', render: (v) => v.entity_name || 'المستودع' },
      { label: 'الأصناف', cls: 'num', render: (v) => countItems(v.line_count) },
      { label: 'المبلغ', cls: 'num', render: (v) => {
        if (!PRICED_KINDS.has(v.kind)) return '—';   // بضاعة داخلية: كميات بلا فلوس
        if (v.pending_price_lines) return h('span.pill.warn', {}, `${v.pending_price_lines} سعر معلّق`);
        return money(v.total_amount);
      } },
      { label: 'سجّله', render: (v) => v.created_by_name || '—' },
      { label: 'ملاحظة', render: (v) => v.note || '—' },
      { label: '', render: (v) => h('div.row', { style: 'flex-wrap:nowrap' },
          h('button.btn.ghost.sm', { onclick: () => openVoucherSheet(v) }, 'الجرد'),
          editable ? h('button.btn.danger.sm', { onclick: () => removeVoucher(v, refresh) }, 'حذف') : null) },
    ];
    box.append(h('div.card', {},
      h('div.toolbar', {},
        h('h3', {}, 'السندات'),
        h('div.spacer'),
        h('button.btn.ghost.sm', {
          onclick: () => downloadCsv('vouchers.csv',
            ['رقم السند', 'التاريخ', 'النوع', 'الجهة', 'عدد الأصناف', 'المبلغ', 'سجّله', 'ملاحظة'],
            vouchers.map((v) => [v.voucher_no, dateTime(v.occurred_at), v.kind_label,
              v.entity_name || 'المستودع', v.line_count,
              PRICED_KINDS.has(v.kind) ? (v.total_amount ?? '') : '', v.created_by_name || '', v.note || ''])),
        }, icon('download', 14), 'تصدير')),
      table(columns, vouchers, { empty: 'ما في سندات بهاي الفترة' })));
  }

  await refresh();
}

/** جرد سند كامل: كل أسطره بكمياتها ومبالغها */
async function openVoucherSheet(summary) {
  const { voucher, lines } = await api.get(`/api/vouchers/${summary.id}`);
  const priced = PRICED_KINDS.has(voucher.kind) && voucher.total_amount !== undefined;
  return modal({
    title: `جرد سند #${voucher.voucher_no}`,
    confirmText: 'تمام',
    cancelText: 'إغلاق',
    wide: true,
    body: h('div', {},
      h('div.confirm-bar', {},
        h('span.pill', { class: KIND_PILL[voucher.kind] || '' }, voucher.kind_label),
        h('b', {}, voucher.entity_name || 'المستودع'),
        h('span.muted', {}, '·'),
        h('span', {}, dateTime(voucher.occurred_at)),
        h('span.muted', {}, '·'),
        h('b', {}, countItems(voucher.line_count))),
      voucher.note ? h('div.muted', { style: 'margin-bottom:10px' }, voucher.note) : null,
      table([
        { label: '#', render: (l) => String(l._i + 1) },
        { label: 'الصنف', key: 'item_name' },
        { label: 'الكمية', cls: 'num', render: (l) => qty(l.quantity, l.item_unit) },
        // أعمدة الفلوس بتظهر بسندات الزباين بس
        ...(priced ? [
          { label: 'سعر الوحدة', cls: 'num', render: (l) => (l.price_pending
              ? h('span.pill.warn', {}, 'معلّق') : money(l.unit_price)) },
          { label: 'المبلغ', cls: 'num', render: (l) => money(l.amount) },
        ] : []),
        { label: 'ملاحظة', render: (l) => l.note || '—' },
      ], lines.map((l, i) => ({ ...l, _i: i })), { empty: 'ما ضل ولا سطر بالسند' }),
      priced && voucher.total_amount != null
        ? h('div.confirm-bar', { style: 'margin-top:12px' },
            h('b', {}, 'إجمالي السند'), h('div.spacer'), h('b', {}, money(voucher.total_amount)))
        : null),
  });
}

async function removeVoucher(v, refresh) {
  const ok = await modal({
    title: `حذف سند #${v.voucher_no}`,
    confirmText: 'حذف السند كله',
    body: h('div', {},
      h('div.confirm-bar', {},
        h('span.pill', { class: KIND_PILL[v.kind] || '' }, v.kind_label),
        h('b', {}, v.entity_name || 'المستودع'),
        h('span.muted', {}, '·'),
        h('b', {}, countItems(v.line_count))),
      h('div.alert.warn', {}, 'بينحذف السند وكل أسطره مع بعض. الأرصدة والستوك بيرجعوا تلقائياً، والحذف بينسجّل بسجل التدقيق.')),
  });
  if (!ok) return;
  await api.del(`/api/vouchers/${v.id}`);
  toast(`انحذف سند #${v.voucher_no}`);
  await refresh();
}
