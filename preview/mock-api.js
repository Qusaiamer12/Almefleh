// ===========================================================================
// سيرفر وهمي بالمتصفح - للتجربة بس
// بيطبّق نفس منطق النظام الحقيقي: الأرصدة والستوك *مشتقّة* من الحركات،
// الأسعار إلها تاريخ سريان، والسعر المعلّق بينحسب أول ما يتحدّد السعر.
// البيانات بالذاكرة: أي تحديث للصفحة بيرجّع كل شي لأول الطريق.
// ===========================================================================

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
/**
 * وقت أكيد جوّا الأسبوع الحالي (بعد سبت البداية بكذا ساعة)، وما بيتعدّى الآن.
 * هيك البيانات التجريبية بتضل ظاهرة بتقرير "هذا الأسبوع" مهما كان اليوم
 * اللي بتفتح فيه النسخة.
 */
const thisWeek = (hoursAfterStart) => {
  const start = weekRange(0).from.getTime();
  return new Date(Math.min(start + hoursAfterStart * 3600000, Date.now() - 60000)).toISOString();
};

const TZ = 'Asia/Amman';
const parts = (d) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(d)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second };
};
const offsetMs = (d) => {
  const p = parts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(new Date(d).getTime() / 1000) * 1000;
};
function zonedToUtc(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  let off = offsetMs(new Date(guess));
  off = offsetMs(new Date(guess - off));
  return new Date(guess - off);
}
const dateStr = (d) => { const p = parts(d); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };

/** الأسبوع بيبلّش السبت بتوقيت عمّان */
function weekRange(offset = 0) {
  const p = parts(new Date());
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const back = (dow - 6 + 7) % 7;
  const from = zonedToUtc(p.year, p.month, p.day - back + offset * 7);
  const to = zonedToUtc(p.year, p.month, p.day - back + offset * 7 + 7);
  return { from, to };
}
function resolvePeriod(q = {}) {
  if (q.from && q.to) {
    const [fy, fm, fd] = q.from.split('-').map(Number);
    const [ty, tm, td] = q.to.split('-').map(Number);
    return { from: zonedToUtc(fy, fm, fd), to: zonedToUtc(ty, tm, td + 1), label: `من ${q.from} إلى ${q.to}`, type: 'custom' };
  }
  const offset = Number(q.week || 0);
  const r = weekRange(offset);
  return { ...r, label: `أسبوع ${dateStr(r.from)} → ${dateStr(new Date(r.to.getTime() - 1))}`, type: 'week', offset };
}

// ---------- البيانات ----------
let session = null;   // المستخدم الحالي (بتتعرّف بدري لأن seed بتنده على audit)
let seq = 100;
const nextId = () => ++seq;

const db = {
  entities: [
    { id: 1, name: 'بلال', type: 'customer', has_financials: true, active: true },
    { id: 2, name: 'إسلام', type: 'customer', has_financials: true, active: true },
    { id: 3, name: 'عمار', type: 'customer', has_financials: true, active: true },
    { id: 4, name: 'سعد', type: 'customer', has_financials: true, active: true },
    { id: 5, name: 'المشغل', type: 'operator', has_financials: false, active: true },
  ],
  users: [
    { id: 1, username: 'qusai', password: 'Admin@1234', display_name: 'قصي', role: 'admin', entity_id: null, notifications_on: true, active: true },
    { id: 2, username: 'abood', password: 'Almefleh@2024', display_name: 'عبود', role: 'recorder', entity_id: null, notifications_on: true, active: true },
    { id: 3, username: 'abublal', password: 'Almefleh@2024', display_name: 'أبو بلال', role: 'viewer', entity_id: null, notifications_on: false, active: true },
    { id: 4, username: 'blal', password: 'Almefleh@2024', display_name: 'بلال', role: 'customer', entity_id: 1, notifications_on: false, active: true },
    { id: 5, username: 'islam', password: 'Almefleh@2024', display_name: 'إسلام', role: 'customer', entity_id: 2, notifications_on: true, active: true },
    { id: 6, username: 'ammar', password: 'Almefleh@2024', display_name: 'عمار', role: 'customer', entity_id: 3, notifications_on: true, active: true },
    { id: 7, username: 'saad', password: 'Almefleh@2024', display_name: 'سعد', role: 'customer', entity_id: 4, notifications_on: true, active: true },
  ],
  items: [
    { id: 1, name: 'سطل زيتون', unit: 'piece', active: true },
    { id: 2, name: 'جاط زيتون', unit: 'piece', active: true },
    { id: 3, name: 'زيت زيتون', unit: 'kg', active: true },
    { id: 4, name: 'جاط مكدوس', unit: 'piece', active: true },
    { id: 5, name: 'سطل مكدوس', unit: 'piece', active: true },
    { id: 6, name: 'لبنة بلدية', unit: 'kg', active: true },
    { id: 7, name: 'دبس رمان', unit: 'kg', active: true },
    { id: 8, name: 'زعتر أخضر', unit: 'kg', active: true },
  ],
  item_prices: [
    { id: 1, item_id: 1, price: 25, effective_from: daysAgo(90), note: 'سعر أوّلي', created_by_name: 'قصي' },
    { id: 2, item_id: 2, price: 3.5, effective_from: daysAgo(90), note: 'سعر أوّلي', created_by_name: 'قصي' },
    { id: 3, item_id: 3, price: 6, effective_from: daysAgo(90), note: 'سعر أوّلي', created_by_name: 'قصي' },
    { id: 4, item_id: 5, price: 30, effective_from: daysAgo(60), note: 'سعر أوّلي', created_by_name: 'قصي' },
    { id: 5, item_id: 6, price: 4.5, effective_from: daysAgo(60), note: 'سعر أوّلي', created_by_name: 'قصي' },
    { id: 6, item_id: 7, price: 8, effective_from: daysAgo(45), note: 'سعر أوّلي', created_by_name: 'قصي' },
    { id: 7, item_id: 8, price: 12, effective_from: daysAgo(45), note: 'سعر أوّلي', created_by_name: 'قصي' },
    // جاط مكدوس (٤) بدون سعر عمداً - عشان تشوف "السعر المعلّق"
  ],
  item_components: [
    { id: 1, parent_item_id: 2, component_item_id: 1, quantity_per_unit: 0.1 },
    { id: 2, parent_item_id: 4, component_item_id: 5, quantity_per_unit: 0.125 },
  ],
  transactions: [],
  notifications: [],
  requests: [],
  proposals: [],
  audit: [],
};

const itemById = (id) => db.items.find((i) => i.id === Number(id));
const entityById = (id) => db.entities.find((e) => e.id === Number(id));

function priceAt(itemId, at) {
  const rows = db.item_prices
    .filter((p) => p.item_id === Number(itemId) && new Date(p.effective_from) <= new Date(at))
    .sort((a, b) => new Date(b.effective_from) - new Date(a.effective_from) || b.id - a.id);
  return rows[0] ? rows[0].price : null;
}

const KIND_LABELS = {
  supply: 'توريد للمستودع', customer_out: 'سحب زبون', customer_return: 'إرجاع بضاعة',
  payment: 'دفعة', operator_out: 'إخراج للمشغل', operator_in: 'إدخال من المشغل',
};

/** نفس منطق v_transactions بقاعدة البيانات */
function view(t) {
  const item = t.item_id ? itemById(t.item_id) : null;
  const entity = t.entity_id ? entityById(t.entity_id) : null;
  const basePrice = t.item_id ? priceAt(t.item_id, t.occurred_at) : null;
  const unit_price = t.unit_price_override != null ? t.unit_price_override : basePrice;
  const priced = ['customer_out', 'customer_return'].includes(t.kind);
  const amount = t.kind === 'payment'
    ? t.payment_amount
    : (priced && unit_price != null ? round2(t.quantity * unit_price) : null);

  const stock_delta = { supply: t.quantity, customer_out: -t.quantity, customer_return: t.quantity,
    operator_out: -t.quantity, operator_in: t.quantity, payment: 0 }[t.kind] || 0;
  const debt_delta = t.kind === 'customer_out' ? (amount || 0)
    : t.kind === 'customer_return' ? -(amount || 0)
    : t.kind === 'payment' ? -t.payment_amount : 0;

  return {
    ...t,
    entity_name: entity ? entity.name : null,
    entity_type: entity ? entity.type : null,
    item_name: item ? item.name : null,
    item_unit: item ? item.unit : null,
    unit_price,
    price_overridden: t.unit_price_override != null,
    amount,
    price_pending: priced && unit_price == null,
    stock_delta,
    debt_delta,
    kind_label: KIND_LABELS[t.kind],
  };
}

const liveTxns = () => db.transactions.filter((t) => !t.deleted_at);
const stockOf = (itemId) => round3(liveTxns().filter((t) => t.item_id === itemId)
  .reduce((s, t) => s + view(t).stock_delta, 0));
const balanceOf = (entityId) => round2(liveTxns().filter((t) => t.entity_id === entityId)
  .reduce((s, t) => s + view(t).debt_delta, 0));

// ---------- تحليل الكميات (نفس قواعد النظام) ----------
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function normalizeDigits(input) {
  let out = '';
  for (const ch of String(input)) {
    const i = AR_DIGITS.indexOf(ch);
    if (i >= 0) { out += String(i); continue; }
    if (ch === '٫' || ch === '،' || ch === ',') { out += '.'; continue; }
    if (ch === '٬' || ch === '_') continue;
    out += ch;
  }
  return out;
}
const KG = ['كيلوغرام', 'كيلو', 'كغم', 'كجم', 'كغ', 'كج', 'ك', 'kg', 'k'];
const G = ['غرام', 'جرام', 'غم', 'جم', 'غ', 'ج', 'gm', 'gr', 'g'];
function parseQuantity(input, unit = 'piece') {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('الكمية مطلوبة');
  const text = normalizeDigits(raw).replace(/\s+/g, '').toLowerCase();
  if (!/[0-9]/.test(text)) throw new Error(`كمية غير مفهومة: "${raw}"`);
  const segs = [];
  let i = 0;
  while (i < text.length) {
    const m = /^[0-9]+(?:\.[0-9]+)?/.exec(text.slice(i));
    if (!m) throw new Error(`كمية غير مفهومة: "${raw}"`);
    const number = parseFloat(m[0]); i += m[0].length;
    let u = null;
    for (const s of KG) if (text.slice(i).startsWith(s)) { u = 'kg'; i += s.length; break; }
    if (!u) for (const s of G) if (text.slice(i).startsWith(s)) { u = 'g'; i += s.length; break; }
    segs.push({ number, unit: u });
    while (i < text.length && '+-و'.includes(text[i])) i += 1;
  }
  const hadUnit = segs.some((s) => s.unit);
  if (unit === 'piece') {
    if (hadUnit) throw new Error('هذا الصنف بالعدد، ما بينفع تكتب وحدة وزن (ك / غ)');
    if (!(segs[0].number > 0)) throw new Error('الكمية لازم تكون أكبر من صفر');
    return { value: round3(segs[0].number), raw };
  }
  const total = segs.reduce((s, x) => s + (x.unit === 'g' ? x.number / 1000 : x.number), 0);
  if (!(total > 0)) throw new Error('الكمية لازم تكون أكبر من صفر');
  return { value: round3(total), raw };
}
function parseAmount(input) {
  const t = normalizeDigits(String(input ?? '').trim()).replace(/\s/g, '');
  if (!/^[0-9]+(\.[0-9]+)?$/.test(t)) throw new Error(`مبلغ غير مفهوم: "${input}"`);
  const v = parseFloat(t);
  if (!(v > 0)) throw new Error('المبلغ لازم يكون أكبر من صفر');
  return round2(v);
}

// ---------- بيانات تجريبية ----------
function addTxn(t) {
  const row = { id: nextId(), created_by: 1, created_by_name: 'قصي', note: null,
    unit_price_override: null, payment_amount: null, method: null, quantity: null,
    quantity_input: null, item_id: null, entity_id: null, deleted_at: null, ...t };
  db.transactions.push(row);
  return row;
}
function audit(action, table, summary, extra = {}) {
  db.audit.unshift({ id: nextId(), created_at: new Date().toISOString(), action, table_name: table,
    summary, username: session?.username || 'qusai', user_display_name: session?.display_name || 'قصي',
    action_label: { create: 'إضافة', update: 'تعديل', delete: 'حذف' }[action] || action,
    table_label: { transactions: 'حركة', items: 'صنف', item_prices: 'سعر', item_components: 'مقادير',
      users: 'حساب', customer_requests: 'طلب زبون', price_proposals: 'اقتراح سعر' }[table] || table,
    before_data: null, after_data: null, ...extra });
}
function notify(type, title, body, onlyAdmin = false) {
  for (const u of db.users) {
    if (!u.notifications_on) continue;
    if (onlyAdmin && u.role !== 'admin') continue;
    db.notifications.unshift({ id: nextId(), user_id: u.id, type, title, body,
      read_at: null, created_at: new Date().toISOString() });
  }
}

(function seed() {
  addTxn({ kind: 'supply', item_id: 1, quantity: 200, quantity_input: '200', occurred_at: daysAgo(24), note: 'توريد من المزرعة' });
  addTxn({ kind: 'supply', item_id: 5, quantity: 80, quantity_input: '80', occurred_at: daysAgo(22) });
  addTxn({ kind: 'supply', item_id: 6, quantity: 60, quantity_input: '60ك', occurred_at: daysAgo(20) });
  addTxn({ kind: 'operator_out', entity_id: 5, item_id: 1, quantity: 20, quantity_input: '20', occurred_at: daysAgo(18) });
  addTxn({ kind: 'operator_in', entity_id: 5, item_id: 2, quantity: 180, quantity_input: '180', occurred_at: daysAgo(17), note: 'رجع ناقص عن المتوقّع' });
  addTxn({ kind: 'operator_out', entity_id: 5, item_id: 5, quantity: 16, quantity_input: '16', occurred_at: daysAgo(16) });
  addTxn({ kind: 'operator_in', entity_id: 5, item_id: 4, quantity: 120, quantity_input: '120', occurred_at: daysAgo(15) });

  addTxn({ kind: 'customer_out', entity_id: 1, item_id: 2, quantity: 50, quantity_input: '50', occurred_at: daysAgo(12) });
  addTxn({ kind: 'customer_out', entity_id: 2, item_id: 2, quantity: 30, quantity_input: '30', occurred_at: daysAgo(11) });
  addTxn({ kind: 'payment', entity_id: 1, payment_amount: 100, method: 'cash', occurred_at: daysAgo(9), note: 'دفعة نقدي' });
  addTxn({ kind: 'customer_out', entity_id: 3, item_id: 6, quantity: 12.5, quantity_input: '12ك500غ', occurred_at: daysAgo(8) });
  addTxn({ kind: 'customer_out', entity_id: 4, item_id: 4, quantity: 25, quantity_input: '25', occurred_at: daysAgo(6) });

  // ===== دورة تصنيع هالأسبوع (عشان تقرير الفاقد يبيّن من أول لحظة) =====
  // طلع ١٠ سطول، والوصفة ٠.١ سطل للجاط => المتوقّع ١٠٠ جاط
  addTxn({ kind: 'operator_out', entity_id: 5, item_id: 1, quantity: 10, quantity_input: '10', occurred_at: thisWeek(2) });
  // رجع ٩٢ بس => فاقد ٨ جاطات (٨٪)
  addTxn({ kind: 'operator_in', entity_id: 5, item_id: 2, quantity: 92, quantity_input: '92', occurred_at: thisWeek(6) });

  // حركات هالأسبوع
  addTxn({ kind: 'customer_out', entity_id: 1, item_id: 2, quantity: 40, quantity_input: '40', occurred_at: thisWeek(8), created_by: 2, created_by_name: 'عبود' });
  addTxn({ kind: 'customer_out', entity_id: 2, item_id: 8, quantity: 5, quantity_input: '5ك', occurred_at: thisWeek(10), created_by: 2, created_by_name: 'عبود' });
  addTxn({ kind: 'payment', entity_id: 2, payment_amount: 120, method: 'bank', occurred_at: thisWeek(12), created_by: 2, created_by_name: 'عبود' });
  addTxn({ kind: 'customer_out', entity_id: 3, item_id: 2, quantity: 20, quantity_input: '20', occurred_at: thisWeek(20), created_by: 2, created_by_name: 'عبود' });
  addTxn({ kind: 'customer_return', entity_id: 1, item_id: 2, quantity: 5, quantity_input: '5', occurred_at: thisWeek(26), note: 'بضاعة راجعة' });

  db.requests.push({ id: nextId(), entity_id: 3, entity_name: 'عمار', user_name: 'عمار',
    body: 'بدي كشف حساب مفصّل عن الشهر اللي فات لو سمحت', handled: false,
    created_at: daysAgo(2), handled_by_name: null });

  notify('pending_price', 'صنف بدون سعر', '"جاط مكدوس" انضاف من عبود وبده سعر', true);
  notify('customer_request', 'طلب/ملاحظة من عمار', 'بدي كشف حساب مفصّل عن الشهر اللي فات لو سمحت', true);
  notify('negative_stock', 'رصيد صنف تحت الصفر', '"دبس رمان" صار رصيده سالب بعد آخر حركة');

  audit('create', 'transactions', 'سحب زبون - بلال - جاط زيتون × 40');
  audit('update', 'item_prices', 'تغيير سعر "سطل زيتون" من 22 إلى 25');
  audit('delete', 'transactions', 'حذف حركة #104 (سحب زبون - سعد - 87.50)');
})();

// ---------- الجلسة ----------
const HOME = { admin: '/admin', recorder: '/record', viewer: '/overview', customer: '/customer' };
const safeUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role,
  entity_id: u.entity_id, entity_name: u.entity_id ? entityById(u.entity_id).name : null,
  notifications_on: u.notifications_on });

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const canSeeStock = () => session && (session.role === 'admin' || session.role === 'viewer');
const delay = () => new Promise((r) => setTimeout(r, 60)); // إحساس واقعي بالتحميل

// ---------- المعالجات ----------
function listItems(q = {}) {
  let rows = db.items.filter((i) => (q.include_inactive === 'true' ? true : i.active));
  if (q.search) rows = rows.filter((i) => i.name.includes(q.search));
  if (q.letter) rows = rows.filter((i) => i.name.trim().startsWith(q.letter));
  return rows.map((i) => {
    const price = priceAt(i.id, new Date());
    const base = { id: i.id, name: i.name, unit: i.unit, active: i.active,
      has_recipe: db.item_components.some((c) => c.parent_item_id === i.id),
      last_movement_at: liveTxns().filter((t) => t.item_id === i.id)
        .map((t) => t.occurred_at).sort().pop() || null };
    if (canSeeStock()) return { ...base, quantity: stockOf(i.id), current_price: price };
    return { ...base, ...(session.role === 'recorder' ? { needs_price: price == null } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

function filterTxns(q = {}) {
  let rows = liveTxns();
  if (session.role === 'customer') rows = rows.filter((t) => t.entity_id === session.entity_id);
  else if (q.entity_id) rows = rows.filter((t) => t.entity_id === Number(q.entity_id));
  if (q.item_id) rows = rows.filter((t) => t.item_id === Number(q.item_id));
  if (q.kind) rows = rows.filter((t) => t.kind === q.kind);
  if (q.mine === 'true') rows = rows.filter((t) => t.created_by === session.id);
  if (q.from && q.to || q.week !== undefined) {
    const p = resolvePeriod(q);
    rows = rows.filter((t) => new Date(t.occurred_at) >= p.from && new Date(t.occurred_at) < p.to);
  }
  let out = rows.map(view);
  if (q.pending_price === 'true') out = out.filter((t) => t.price_pending);
  out.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at) || b.id - a.id);
  if (session.role === 'recorder') {
    out = out.map(({ unit_price, amount, price_pending, price_overridden, debt_delta, ...rest }) => rest);
  }
  return out.slice(0, Number(q.limit || 200));
}

function statementFor(entityId, q) {
  const entity = entityById(entityId);
  if (!entity) fail(404, 'الجهة غير موجودة');
  if (session.role === 'recorder') fail(403, 'ما عندك صلاحية تشوف الكشوفات');
  if (session.role === 'customer' && session.entity_id !== entityId) fail(403, 'بتقدر تشوف كشف حسابك بس');

  const period = resolvePeriod(q);
  const all = liveTxns().filter((t) => t.entity_id === entityId).map(view);
  const opening = round2(all.filter((t) => new Date(t.occurred_at) < period.from)
    .reduce((s, t) => s + t.debt_delta, 0));
  const inPeriod = all.filter((t) => new Date(t.occurred_at) >= period.from && new Date(t.occurred_at) < period.to)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at) || a.id - b.id);

  let running = opening;
  const lines = inPeriod.map((l) => { running = round2(running + l.debt_delta); return { ...l, running_balance: running }; });
  const sum = (f) => round2(lines.reduce((s, r) => s + f(r), 0));

  return {
    entity, period, opening_balance: opening, lines,
    totals: {
      withdrawals: sum((r) => (r.kind === 'customer_out' ? r.amount || 0 : 0)),
      returns: sum((r) => (r.kind === 'customer_return' ? r.amount || 0 : 0)),
      payments: sum((r) => (r.kind === 'payment' ? r.payment_amount || 0 : 0)),
      pending_price_lines: lines.filter((r) => r.price_pending).length,
    },
    closing_balance: round2(running),
    financial: entity.has_financials,
  };
}

function lossReport(q) {
  const period = resolvePeriod(q);
  const inPeriod = liveTxns().filter((t) => new Date(t.occurred_at) >= period.from && new Date(t.occurred_at) < period.to);
  const outputBy = {}; const issuedBy = {};
  for (const t of inPeriod) {
    if (t.kind === 'operator_in') outputBy[t.item_id] = (outputBy[t.item_id] || 0) + t.quantity;
    if (t.kind === 'operator_out') issuedBy[t.item_id] = (issuedBy[t.item_id] || 0) + t.quantity;
  }
  const parents = {};
  for (const c of db.item_components) {
    (parents[c.parent_item_id] ||= []).push(c);
  }
  const requiredTotals = {};
  for (const [pid, comps] of Object.entries(parents)) {
    const actual = outputBy[pid] || 0;
    for (const c of comps) requiredTotals[c.component_item_id] = (requiredTotals[c.component_item_id] || 0) + actual * c.quantity_per_unit;
  }

  const production = [];
  for (const [pid, comps] of Object.entries(parents)) {
    const parent = itemById(pid);
    const actual = outputBy[pid] || 0;
    const anyIssued = comps.some((c) => (issuedBy[c.component_item_id] || 0) > 0);
    if (!actual && !anyIssued) continue;
    let expected = null;
    const components = comps.map((c) => {
      const required = round3(actual * c.quantity_per_unit);
      const issuedTotal = issuedBy[c.component_item_id] || 0;
      const totalReq = requiredTotals[c.component_item_id] || 0;
      const share = totalReq > 0 ? required / totalReq : 1;
      const allocated = round3(issuedTotal * share);
      const exp = c.quantity_per_unit > 0 ? allocated / c.quantity_per_unit : null;
      if (exp != null) expected = expected == null ? exp : Math.min(expected, exp);
      return { component_item_id: c.component_item_id, component_name: itemById(c.component_item_id).name,
        component_unit: itemById(c.component_item_id).unit, quantity_per_unit: c.quantity_per_unit,
        required, issued_total: round3(issuedTotal), allocated_issued: allocated,
        expected_output_from_component: exp == null ? null : round3(exp), difference: round3(allocated - required) };
    });
    const exp = expected == null ? null : round3(expected);
    const loss = exp == null ? null : round3(exp - actual);
    production.push({ item_id: Number(pid), item_name: parent.name, unit: parent.unit,
      actual_output: round3(actual), expected_output: exp, loss_units: loss,
      loss_percent: exp && exp > 0 ? round2((loss / exp) * 100) : null, components });
  }

  const components = Object.entries(requiredTotals).map(([cid, req]) => {
    const issued = issuedBy[cid] || 0;
    if (!issued && !req) return null;
    const price = priceAt(cid, period.to);
    const diff = round3(issued - req);
    return { item_id: Number(cid), item_name: itemById(cid).name, unit: itemById(cid).unit,
      issued: round3(issued), required: round3(req), difference: diff, price,
      loss_value: price == null ? null : round2(diff * price) };
  }).filter(Boolean);

  const unlinked = Object.keys(issuedBy).filter((id) => !(id in requiredTotals))
    .map((id) => ({ item_id: Number(id), item_name: itemById(id).name, unit: itemById(id).unit, issued: round3(issuedBy[id]) }));

  return { period, production, components, unlinked_issues: unlinked,
    summary: { total_loss_value: round2(components.reduce((s, c) => s + (c.loss_value || 0), 0)),
      items_with_loss: production.filter((p) => (p.loss_units || 0) > 0).length } };
}

function stockReport() {
  const items = db.items.filter((i) => i.active).map((i) => {
    const quantity = stockOf(i.id);
    const price = priceAt(i.id, new Date());
    return { item_id: i.id, item_name: i.name, unit: i.unit, active: i.active, quantity,
      current_price: price, negative: quantity < 0, needs_price: price == null,
      value: price == null ? null : round2(quantity * price),
      has_recipe: db.item_components.some((c) => c.parent_item_id === i.id),
      last_movement_at: liveTxns().filter((t) => t.item_id === i.id).map((t) => t.occurred_at).sort().pop() || null };
  }).sort((a, b) => a.item_name.localeCompare(b.item_name, 'ar'));
  return { items, summary: { total_items: items.length,
    negative_count: items.filter((i) => i.negative).length,
    missing_price_count: items.filter((i) => i.needs_price).length,
    total_value: round2(items.reduce((s, i) => s + (i.value || 0), 0)) } };
}

function bomCost(itemId, at) {
  const comps = db.item_components.filter((c) => c.parent_item_id === Number(itemId));
  if (!comps.length) return { cost: null, complete: false, lines: [] };
  let cost = 0; let complete = true;
  const lines = comps.map((c) => {
    const price = priceAt(c.component_item_id, at);
    if (price == null) complete = false; else cost += price * c.quantity_per_unit;
    return { component_item_id: c.component_item_id, component_name: itemById(c.component_item_id).name,
      component_unit: itemById(c.component_item_id).unit, quantity_per_unit: c.quantity_per_unit,
      component_price: price, line_cost: price == null ? null : round2(price * c.quantity_per_unit), id: c.id };
  });
  return { cost: round2(cost), complete, lines };
}

function setPrice(itemId, body) {
  const item = itemById(itemId);
  const effectiveFrom = body.effective_from || new Date().toISOString();
  const oldPrice = priceAt(itemId, effectiveFrom);
  db.item_prices.push({ id: nextId(), item_id: Number(itemId), price: Number(body.price),
    effective_from: effectiveFrom, note: body.note || null, created_by_name: session.display_name });

  const affected = liveTxns().filter((t) => t.item_id === Number(itemId) && t.unit_price_override == null
    && ['customer_out', 'customer_return'].includes(t.kind) && new Date(t.occurred_at) >= new Date(effectiveFrom)).length;

  // اقتراح سعر لكل صنف بيستعمل هالصنف بالوصفة (بيحافظ على نفس هامش الربح)
  const proposals = [];
  for (const c of db.item_components.filter((x) => x.component_item_id === Number(itemId))) {
    const parent = itemById(c.parent_item_id);
    const justBefore = new Date(new Date(effectiveFrom).getTime() - 1);
    const oldCost = db.item_components.filter((x) => x.parent_item_id === parent.id)
      .reduce((s, x) => s + (x.component_item_id === Number(itemId) ? (oldPrice || 0) : (priceAt(x.component_item_id, justBefore) || 0)) * x.quantity_per_unit, 0);
    const newCost = bomCost(parent.id, effectiveFrom).cost;
    const currentParentPrice = priceAt(parent.id, effectiveFrom);
    const suggested = currentParentPrice != null && oldCost > 0 && newCost != null
      ? round2(currentParentPrice * (newCost / oldCost)) : newCost;
    const p = { id: nextId(), parent_item_id: parent.id, parent_name: parent.name, parent_unit: parent.unit,
      component_item_id: Number(itemId), component_name: item.name, old_component_price: oldPrice,
      new_component_price: Number(body.price), current_parent_price: currentParentPrice,
      suggested_price: suggested, cost_price: newCost, old_cost: round2(oldCost),
      effective_from: effectiveFrom, status: 'pending', created_at: new Date().toISOString() };
    db.proposals.unshift(p);
    proposals.push(p);
    notify('price_change', `سعر "${item.name}" تغيّر`,
      `بدك تعدّل سعر "${parent.name}" المرتبط فيه؟ المقترح: ${suggested ?? '—'} (الحالي: ${currentParentPrice ?? '—'})`, true);
  }
  audit('update', 'item_prices', `تغيير سعر "${item.name}" من ${oldPrice ?? '—'} إلى ${body.price} اعتباراً من ${dateStr(effectiveFrom)}`,
    { before_data: { price: oldPrice }, after_data: { price: Number(body.price), effective_from: effectiveFrom } });
  return { ok: true, old_price: oldPrice, new_price: Number(body.price), effective_from: effectiveFrom,
    affected_transactions: affected, proposals };
}

function createTxn(body) {
  const kind = body.kind;
  if (body.client_token) {
    const dup = liveTxns().find((t) => t.client_token === body.client_token);
    if (dup) return { transaction: view(dup), warnings: [], duplicate: true };
  }
  const entity = kind === 'supply' ? null : entityById(body.entity_id);
  if (kind !== 'supply' && !entity) fail(400, 'الجهة غير موجودة');
  if (['customer_out', 'customer_return', 'payment'].includes(kind) && entity.type !== 'customer') {
    fail(400, 'هاي الحركة بتنسجّل على زبون مش على المشغل');
  }
  if (['operator_out', 'operator_in'].includes(kind) && entity.type !== 'operator') {
    fail(400, 'حركات المشغل بتنسجّل على المشغل بس');
  }

  const row = { kind, entity_id: entity ? entity.id : null, note: body.note || null,
    occurred_at: (session.role === 'admin' && body.occurred_at) ? body.occurred_at : new Date().toISOString(),
    created_by: session.id, created_by_name: session.display_name, client_token: body.client_token || null };

  if (kind === 'payment') {
    row.payment_amount = parseAmount(body.payment_amount ?? body.amount);
    if (!['cash', 'bank', 'check'].includes(body.method)) fail(400, 'لازم تحدد طريقة الدفع: نقدي / تحويل بنكي / شيك');
    row.method = body.method;
  } else {
    const item = itemById(body.item_id);
    if (!item) fail(400, 'الصنف غير موجود');
    const q = parseQuantity(body.quantity, item.unit);
    row.item_id = item.id; row.quantity = q.value; row.quantity_input = q.raw;
    if (session.role === 'admin' && body.unit_price_override != null && body.unit_price_override !== '') {
      row.unit_price_override = Number(body.unit_price_override);
    }
  }

  const saved = addTxn(row);
  const full = view(saved);
  audit('create', 'transactions', `${KIND_LABELS[kind]}${full.entity_name ? ' - ' + full.entity_name : ''}` +
    `${full.item_name ? ' - ' + full.item_name + ' × ' + saved.quantity_input : ''}` +
    `${saved.payment_amount ? ' - ' + saved.payment_amount : ''}`, { after_data: saved });

  const warnings = [];
  if (saved.item_id && stockOf(saved.item_id) < 0) {
    const item = itemById(saved.item_id);
    warnings.push({ level: 'danger', item_id: item.id, item_name: item.name,
      message: canSeeStock()
        ? `تنبيه: رصيد "${item.name}" صار بالسالب (${stockOf(item.id)})`
        : `تنبيه: الكمية المسحوبة أكتر من المتوفر بالمستودع لصنف "${item.name}"` });
    notify('negative_stock', 'رصيد صنف تحت الصفر', `"${item.name}" صار رصيده سالب بعد آخر حركة`);
  }
  if (full.price_pending) {
    notify('pending_price', 'حركة بسعر معلّق',
      `"${full.item_name}" ما إله سعر - حركة ${full.entity_name} ما بتنحسب لحد ما تحدّد السعر`, true);
  }
  return { transaction: session.role === 'recorder'
    ? (({ unit_price, amount, price_pending, price_overridden, debt_delta, ...r }) => r)(full) : full, warnings };
}

// ---------- الموجّه ----------
const routes = {
  'GET /api/config': () => ({ app_name: 'نظام مستودعات المفلح', currency: 'د.أ',
    timezone: TZ, user: session ? safeUser(session) : null }),

  'POST /api/auth/login': (b) => {
    const u = db.users.find((x) => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
    if (!u || !u.active || u.password !== b.password) fail(401, 'اليوزر أو كلمة السر غلط');
    session = u;
    return { user: safeUser(u), home: HOME[u.role] };
  },
  'POST /api/auth/logout': () => { session = null; return { ok: true }; },
  'GET /api/auth/me': () => (session ? { user: safeUser(session), home: HOME[session.role] } : fail(401, 'مش مسجّل دخول')),
  'POST /api/auth/change-credentials': (b) => {
    if (b.current_password !== session.password) fail(401, 'كلمة السر الحالية غلط');
    if (b.new_password) {
      if (String(b.new_password).length < 8) fail(400, 'كلمة السر لازم تكون ٨ خانات على الأقل');
      if (!/[0-9]/.test(b.new_password)) fail(400, 'كلمة السر لازم تحتوي على رقم واحد على الأقل');
      session.password = b.new_password;
    }
    if (b.new_username) session.username = String(b.new_username).trim();
    audit('update', 'users', 'تغيير بيانات الدخول (ذاتي)');
    return { ok: true };
  },

  'GET /api/users/entities': () => ({ entities: db.entities.filter((e) => e.active) }),
  'GET /api/users': () => (session.role !== 'admin' ? fail(403, 'ما عندك صلاحية لهاي الصفحة')
    : { users: db.users.map((u) => ({ ...safeUser(u), password: u.password, active: u.active })) }),
  'POST /api/users': (b) => {
    if (db.users.some((u) => u.username === b.username)) fail(409, 'اليوزر موجود مسبقاً');
    const u = { id: nextId(), ...b, active: true };
    db.users.push(u); audit('create', 'users', `إنشاء حساب: ${b.display_name} (${b.role})`);
    return { user: safeUser(u) };
  },

  'GET /api/items': (b, q) => ({ items: listItems(q) }),
  'POST /api/items': (b) => {
    if (db.items.some((i) => i.name.trim().toLowerCase() === String(b.name).trim().toLowerCase())) fail(409, 'في صنف بنفس الاسم');
    const item = { id: nextId(), name: String(b.name).trim(), unit: b.unit === 'kg' ? 'kg' : 'piece', active: true };
    db.items.push(item);
    let price = null;
    if (session.role === 'admin' && b.price != null && b.price !== '') {
      price = Number(b.price);
      db.item_prices.push({ id: nextId(), item_id: item.id, price,
        effective_from: b.effective_from || new Date().toISOString(), note: 'سعر أوّلي', created_by_name: session.display_name });
    }
    audit('create', 'items', `إضافة صنف: ${item.name}`, { after_data: { ...item, price } });
    if (price == null) notify('pending_price', 'صنف جديد بدون سعر', `"${item.name}" انضاف من ${session.display_name} وبده سعر`, true);
    return { item: { ...item, current_price: price } };
  },

  'GET /api/transactions': (b, q) => ({ transactions: filterTxns(q) }),
  'GET /api/transactions/meta/kinds': () => ({
    kinds: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
    methods: [{ value: 'cash', label: 'نقدي' }, { value: 'bank', label: 'تحويل بنكي' }, { value: 'check', label: 'شيك' }],
    week_start: 'السبت' }),
  'POST /api/transactions': (b) => createTxn(b),

  'GET /api/stock': () => (canSeeStock() ? stockReport() : fail(403, 'ما عندك صلاحية لهاي الصفحة')),
  'GET /api/statements': (b, q) => {
    if (session.role === 'customer') return statementFor(session.entity_id, q);
    if (session.role === 'recorder') fail(403, 'ما عندك صلاحية تشوف الأرصدة');
    const period = resolvePeriod(q);
    const customers = db.entities.filter((e) => e.type === 'customer').map((e) => {
      const all = liveTxns().filter((t) => t.entity_id === e.id).map(view);
      const inP = all.filter((t) => new Date(t.occurred_at) >= period.from && new Date(t.occurred_at) < period.to);
      return { entity_id: e.id, entity_name: e.name, type: e.type, has_financials: e.has_financials,
        balance: balanceOf(e.id),
        total_withdrawn: round2(all.filter((t) => t.kind === 'customer_out').reduce((s, t) => s + (t.amount || 0), 0)),
        total_paid: round2(all.filter((t) => t.kind === 'payment').reduce((s, t) => s + t.payment_amount, 0)),
        total_returned: round2(all.filter((t) => t.kind === 'customer_return').reduce((s, t) => s + (t.amount || 0), 0)),
        pending_price_count: all.filter((t) => t.price_pending).length,
        opening_balance: round2(all.filter((t) => new Date(t.occurred_at) < period.from).reduce((s, t) => s + t.debt_delta, 0)),
        period_change: round2(inP.reduce((s, t) => s + t.debt_delta, 0)) };
    });
    return { period, customers, totals: {
      balance: round2(customers.reduce((s, c) => s + c.balance, 0)),
      total_withdrawn: round2(customers.reduce((s, c) => s + c.total_withdrawn, 0)),
      total_paid: round2(customers.reduce((s, c) => s + c.total_paid, 0)) } };
  },
  'GET /api/reports/loss': (b, q) => (canSeeStock() ? lossReport(q) : fail(403, 'ما عندك صلاحية لهاي الصفحة')),
  'GET /api/audit': (b, q) => {
    if (session.role !== 'admin') fail(403, 'ما عندك صلاحية لهاي الصفحة');
    let rows = db.audit;
    if (q.action) rows = rows.filter((a) => a.action === q.action);
    return { entries: rows.slice(0, Number(q.limit || 300)) };
  },
  'GET /api/proposals': (b, q) => ({ proposals: db.proposals.filter((p) => (q.status || 'pending') === 'all' || p.status === (q.status || 'pending')) }),
  'GET /api/requests': (b, q) => {
    let rows = db.requests;
    if (session.role === 'customer') rows = rows.filter((r) => r.entity_id === session.entity_id);
    if (q.open_only === 'true') rows = rows.filter((r) => !r.handled);
    return { requests: rows };
  },
  'POST /api/requests': (b) => {
    const r = { id: nextId(), entity_id: session.entity_id, entity_name: entityById(session.entity_id).name,
      user_name: session.display_name, body: String(b.body).trim(), handled: false, created_at: new Date().toISOString() };
    db.requests.unshift(r);
    notify('customer_request', `طلب/ملاحظة من ${r.entity_name}`, r.body.slice(0, 180), true);
    return { request: r };
  },
  'GET /api/notifications': (b, q) => {
    const mine = db.notifications.filter((n) => n.user_id === session.id);
    return { notifications: mine.slice(0, Number(q.limit || 50)), unread: mine.filter((n) => !n.read_at).length };
  },
  'GET /api/notifications/count': () => ({ unread: db.notifications.filter((n) => n.user_id === session.id && !n.read_at).length }),
  'POST /api/notifications/read-all': () => {
    db.notifications.filter((n) => n.user_id === session.id).forEach((n) => { n.read_at = new Date().toISOString(); });
    return { ok: true };
  },
};

/** مسارات فيها معرّف متغيّر */
function dynamic(method, path, body, query) {
  let m;
  if ((m = path.match(/^\/api\/statements\/(\d+)$/)) && method === 'GET') return statementFor(Number(m[1]), query);
  if ((m = path.match(/^\/api\/stock\/(\d+)$/)) && method === 'GET') {
    const item = stockReport().items.find((i) => i.item_id === Number(m[1]));
    return { item, movements: filterTxns({ item_id: m[1], limit: 50 }), ...bomCost(m[1], new Date()) };
  }
  if ((m = path.match(/^\/api\/items\/(\d+)\/prices$/))) {
    if (method === 'GET') return { prices: db.item_prices.filter((p) => p.item_id === Number(m[1]))
      .sort((a, b) => new Date(b.effective_from) - new Date(a.effective_from)) };
    if (method === 'POST') return setPrice(Number(m[1]), body);
  }
  if ((m = path.match(/^\/api\/items\/(\d+)\/recipe$/))) {
    const id = Number(m[1]);
    if (method === 'GET') {
      const cost = bomCost(id, new Date());
      const current = priceAt(id, new Date());
      return { components: cost.lines, cost: cost.cost, cost_complete: cost.complete,
        current_price: current, margin: current != null && cost.cost ? round2(current - cost.cost) : null };
    }
    if (method === 'PUT') {
      db.item_components = db.item_components.filter((c) => c.parent_item_id !== id);
      for (const c of (body.components || [])) {
        db.item_components.push({ id: nextId(), parent_item_id: id,
          component_item_id: Number(c.component_item_id), quantity_per_unit: Number(c.quantity_per_unit) });
      }
      audit('update', 'item_components', 'تعديل مقادير الصنف');
      const cost = bomCost(id, new Date());
      return { ok: true, cost: cost.cost, cost_complete: cost.complete };
    }
  }
  if ((m = path.match(/^\/api\/items\/(\d+)$/)) && method === 'PATCH') {
    const item = itemById(m[1]);
    const before = { ...item };
    Object.assign(item, { name: body.name ?? item.name, unit: body.unit ?? item.unit,
      active: body.active ?? item.active });
    audit('update', 'items', `تعديل صنف: ${before.name}`, { before_data: before, after_data: { ...item } });
    return { item, changes: {} };
  }
  if ((m = path.match(/^\/api\/transactions\/(\d+)$/))) {
    const txn = db.transactions.find((t) => t.id === Number(m[1]) && !t.deleted_at);
    if (!txn) fail(404, 'الحركة غير موجودة');
    if (method === 'PATCH') {
      const before = { ...txn };
      if (body.quantity !== undefined) {
        const q = parseQuantity(body.quantity, itemById(txn.item_id).unit);
        txn.quantity = q.value; txn.quantity_input = q.raw;
      }
      if (body.payment_amount !== undefined && body.payment_amount !== null) txn.payment_amount = parseAmount(body.payment_amount);
      if (body.note !== undefined) txn.note = body.note || null;
      if (body.occurred_at && session.role === 'admin') txn.occurred_at = body.occurred_at;
      if (body.unit_price_override !== undefined) {
        txn.unit_price_override = body.unit_price_override === null || body.unit_price_override === ''
          ? null : Number(body.unit_price_override);
      }
      audit('update', 'transactions', `تعديل حركة #${txn.id} (${KIND_LABELS[txn.kind]})`,
        { before_data: before, after_data: { ...txn } });
      const warnings = [];
      if (txn.item_id && stockOf(txn.item_id) < 0) {
        warnings.push({ level: 'danger', message: `تنبيه: رصيد "${itemById(txn.item_id).name}" صار بالسالب` });
      }
      return { transaction: view(txn), changes: {}, warnings };
    }
    if (method === 'DELETE') {
      txn.deleted_at = new Date().toISOString();
      const v = view(txn);
      audit('delete', 'transactions', `حذف حركة #${txn.id} (${KIND_LABELS[txn.kind]}` +
        `${v.entity_name ? ' - ' + v.entity_name : ''}${v.amount ? ' - ' + v.amount : ''})`, { before_data: v });
      return { ok: true };
    }
  }
  if ((m = path.match(/^\/api\/users\/(\d+)$/)) && method === 'PATCH') {
    const u = db.users.find((x) => x.id === Number(m[1]));
    if (body.password) u.password = body.password;
    if (body.username) u.username = body.username;
    if (body.active != null) u.active = body.active;
    if (body.notifications_on != null) u.notifications_on = body.notifications_on;
    audit('update', 'users', `تعديل حساب: ${u.display_name}`);
    return { user: safeUser(u) };
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)$/)) && method === 'PATCH') {
    const r = db.requests.find((x) => x.id === Number(m[1]));
    r.handled = body.handled !== false;
    r.handled_by_name = session.display_name;
    return { request: r };
  }
  if ((m = path.match(/^\/api\/proposals\/(\d+)\/accept$/))) {
    const p = db.proposals.find((x) => x.id === Number(m[1]));
    if (!p || p.status !== 'pending') fail(409, 'الاقتراح غير موجود أو تم البتّ فيه مسبقاً');
    p.status = 'accepted';
    db.item_prices.push({ id: nextId(), item_id: p.parent_item_id,
      price: body.price != null ? Number(body.price) : p.suggested_price,
      effective_from: body.effective_from || p.effective_from,
      note: 'تعديل تلقائي بعد تغيّر سعر المقادير', created_by_name: session.display_name });
    audit('update', 'price_proposals', `قبول تعديل سعر "${p.parent_name}"`);
    return { ok: true };
  }
  if ((m = path.match(/^\/api\/proposals\/(\d+)\/reject$/))) {
    const p = db.proposals.find((x) => x.id === Number(m[1]));
    if (p) p.status = 'rejected';
    return { ok: true };
  }
  if ((m = path.match(/^\/api\/notifications\/(\d+)\/read$/))) {
    const n = db.notifications.find((x) => x.id === Number(m[1]));
    if (n) n.read_at = new Date().toISOString();
    return { ok: true };
  }
  fail(404, 'الصفحة أو العملية غير موجودة');
}

async function handle(method, url, body) {
  await delay();
  const [path, queryString] = String(url).split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  if (!session && !['POST /api/auth/login', 'GET /api/config'].includes(`${method} ${path}`)) {
    fail(401, 'لازم تسجّل دخول');
  }
  const handler = routes[`${method} ${path}`];
  if (handler) return handler(body, query);
  return dynamic(method, path, body, query);
}

export const api = {
  get: (p, params) => {
    const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    return handle('GET', p + (clean.length ? '?' + new URLSearchParams(clean) : ''));
  },
  post: (p, b) => handle('POST', p, b),
  patch: (p, b) => handle('PATCH', p, b),
  put: (p, b) => handle('PUT', p, b),
  del: (p) => handle('DELETE', p),
  login: (username, password) => handle('POST', '/api/auth/login', { username, password }),
  logout: () => handle('POST', '/api/auth/logout'),
  me: () => handle('GET', '/api/auth/me'),
};
