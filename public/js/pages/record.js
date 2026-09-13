import { api } from '../api.js';
import { h, clear, toast, modal, dateTime, qty, money, METHOD_LABELS } from '../ui.js';
import { icon } from '../icons.js';

const ARABIC_LETTERS = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('');

/** رمز فريد لكل محاولة تسجيل - بيمنع تسجيل نفس الحركة مرتين */
function newToken() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const RECORDER_NAV = [
  { key: 'record', label: 'تسجيل حركة', title: 'تسجيل الحركات', icon: 'cashier', render: renderRecorder },
];

/** نوع الحركة = الجهة + الاتجاه */
function resolveKind(party, direction) {
  if (party.type === 'operator') return direction === 'out' ? 'operator_out' : 'operator_in';
  return direction === 'out' ? 'customer_out' : 'customer_return';
}

const DIRECTION_LABELS = {
  operator: { out: 'إخراج للمشغل', in: 'إدخال من المشغل' },
  customer: { out: 'سحب بضاعة', in: 'إرجاع بضاعة' },
};
const DIRECTION_HINTS = {
  operator: { out: 'مواد خام طالعة للتصنيع', in: 'بضاعة جاهزة راجعة' },
  customer: { out: 'بضاعة طالعة للزبون', in: 'بضاعة راجعة منه' },
};

/**
 * شاشة تسجيل الحركات (آيباد).
 * التدفّق: جهة => اتجاه => صنف وكمية.
 * التوريد والدفعة برّا هالتدفّق لأن التوريد ما إله جهة والدفعة مالية مش بضاعة.
 */
async function renderRecorder(root) {
  clear(root);

  const ui = {
    party: null,        // الجهة المختارة
    direction: null,    // 'in' | 'out'
    search: '',
    letter: '',
    items: [],
    entities: [],
    activeLetters: new Set(),
  };

  const banner = h('div');
  const steps = h('div');
  const picker = h('div');       // البحث + شبكة الأصناف + بار الحروف
  const recentBox = h('div.recent');

  root.append(banner, steps, picker,
    h('div.card', { style: 'margin-top:16px' },
      h('h3', {}, 'آخر الحركات اللي سجّلتها'), recentBox));

  // ================= تحميل =================
  async function loadEntities() {
    const { entities } = await api.get('/api/users/entities');
    // المشغل أول، وبعدين الزباين
    ui.entities = entities.sort((a, b) => (a.type === b.type ? 0 : a.type === 'operator' ? -1 : 1));
    drawSteps();
  }
  async function loadItems() {
    const { items } = await api.get('/api/items');
    ui.items = items;
    ui.activeLetters = new Set(items.map((i) => i.name.trim()[0]));
    drawPicker();
  }
  async function loadRecent() {
    const { transactions } = await api.get('/api/transactions', { limit: 12, mine: 'true' });
    clear(recentBox);
    if (!transactions.length) { recentBox.append(h('div.empty', {}, 'ما في حركات بعد')); return; }
    for (const t of transactions) {
      recentBox.append(h('div.recent-row', {},
        h('span.pill', {}, t.kind_label),
        h('b', {}, t.entity_name || 'المستودع'),
        h('span.grow', {}, t.item_name
          ? `${t.item_name} — ${qty(t.quantity, t.item_unit)}`
          : `${money(t.payment_amount)} (${METHOD_LABELS[t.method] || ''})`),
        h('span.muted', { style: 'font-size:12px' }, dateTime(t.occurred_at)),
        h('button.btn.ghost.sm', { onclick: () => editTransaction(t) }, 'تعديل'),
        h('button.btn.danger.sm', { onclick: () => deleteTransaction(t) }, 'حذف')));
    }
  }

  // ================= الخطوات =================
  function drawSteps() {
    clear(steps);

    // --- الخطوة ١: الجهة ---
    const partyGrid = h('div.party-grid');
    for (const e of ui.entities) {
      partyGrid.append(h('button.party', {
        class: ui.party?.id === e.id ? 'active' : '',
        onclick: () => { ui.party = e; ui.direction = null; drawSteps(); drawPicker(); },
      },
        h('span.party-name', {}, e.name),
        h('small', {}, e.type === 'operator' ? 'جهة داخلية' : 'زبون')));
    }

    steps.append(h('div.step', {},
      h('div.step-head', {}, h('span.step-no', {}, '١'), h('b', {}, 'على مين؟')),
      partyGrid,
      h('div.row', { style: 'margin-top:12px' },
        h('button.btn.ghost', { onclick: openSupply }, icon('box', 16), 'توريد للمستودع'))));

    if (!ui.party) return;

    // --- الخطوة ٢: الاتجاه ---
    const labels = DIRECTION_LABELS[ui.party.type];
    const hints = DIRECTION_HINTS[ui.party.type];
    const dirGrid = h('div.dir-grid');
    for (const dir of ['out', 'in']) {
      dirGrid.append(h('button.dir', {
        class: `${dir} ${ui.direction === dir ? 'active' : ''}`.trim(),
        onclick: () => { ui.direction = dir; drawSteps(); drawPicker(); },
      },
        h('span.dir-arrow', {}, dir === 'out' ? '↑' : '↓'),
        h('span', {}, h('b', {}, labels[dir]), h('small', {}, hints[dir]))));
    }
    steps.append(h('div.step', {},
      h('div.step-head', {}, h('span.step-no', {}, '٢'),
        h('b', {}, `${ui.party.name} — إدخال ولا إخراج؟`)),
      dirGrid,
      ui.party.type === 'customer'
        ? h('div.row', { style: 'margin-top:12px' },
            h('button.btn.gold', { onclick: openPayment }, 'تسجيل دفعة من ' + ui.party.name))
        : null));
  }

  // ================= الأصناف =================
  function visibleItems() {
    let list = ui.items;
    if (ui.search) list = list.filter((i) => i.name.includes(ui.search));
    if (ui.letter) {
      const variants = ui.letter === 'أ' ? ['أ', 'ا', 'إ', 'آ'] : [ui.letter];
      list = list.filter((i) => variants.includes(i.name.trim()[0]));
    }
    return list;
  }

  function drawPicker() {
    clear(picker);
    if (!ui.party || !ui.direction) return;

    const searchInput = h('input', {
      type: 'search', placeholder: 'دوّر على صنف بالاسم…', id: 'item-search',
      value: ui.search,
      oninput: (e) => { ui.search = e.target.value.trim(); ui.letter = ''; drawGrid(); drawAlpha(); },
    });
    const itemGrid = h('div.item-grid');
    const alphaBar = h('div.alpha-bar');

    function drawAlpha() {
      clear(alphaBar);
      alphaBar.append(h('button', {
        class: ui.letter === '' ? 'active' : '',
        onclick: () => { ui.letter = ''; drawAlpha(); drawGrid(); },
      }, '⌂'));
      for (const letter of ARABIC_LETTERS) {
        const has = ui.activeLetters.has(letter)
          || (letter === 'أ' && [...ui.activeLetters].some((l) => 'اآإأ'.includes(l)));
        alphaBar.append(h('button', {
          class: `${ui.letter === letter ? 'active' : ''} ${has ? '' : 'off'}`.trim(),
          onclick: () => {
            ui.letter = ui.letter === letter ? '' : letter;
            ui.search = ''; searchInput.value = '';
            drawAlpha(); drawGrid();
          },
        }, letter));
      }
    }

    function drawGrid() {
      clear(itemGrid);
      const list = visibleItems();
      if (!list.length) {
        itemGrid.append(h('div', { style: 'grid-column:1/-1' }, h('div.empty', {}, 'ما في أصناف مطابقة')));
        return;
      }
      for (const item of list) {
        itemGrid.append(h('div.item-tile', { onclick: () => openQuantity(item) },
          h('span', {}, item.name),
          h('small', {}, item.unit === 'kg' ? 'بالوزن' : 'بالعدد'),
          item.needs_price ? h('small', { style: 'color:var(--warn)' }, 'بدون سعر') : null));
      }
    }

    const labels = DIRECTION_LABELS[ui.party.type];
    picker.append(h('div.step', {},
      h('div.step-head', {}, h('span.step-no', {}, '٣'),
        h('b', {}, `${labels[ui.direction]} — اختار الصنف`)),
      h('div.cashier-bar', {}, searchInput,
        h('button.btn.gold', { onclick: openNewItem }, 'صنف جديد')),
      h('div.cashier', {}, alphaBar, h('div.cashier-main', {}, itemGrid))));

    drawAlpha();
    drawGrid();
    // على الآيباد خطوة الأصناف بتوقع تحت حدّ الشاشة - بننزّلها لعنده
    requestAnimationFrame(() => picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  // ================= إدخال الكمية =================
  function openQuantity(item) {
    let value = '';
    const display = h('div.qty-display', {}, '0');
    const update = () => { display.textContent = value || '0'; };
    const press = (key) => {
      if (key === 'C') value = '';
      else if (key === '⌫') value = value.slice(0, -1);
      else if (key === '.') { if (!value.includes('.') && value) value += '.'; }
      else if (key === 'ك' || key === 'غ') { if (value && !/[كغ]$/.test(value)) value += key; }
      else value += key;
      update();
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
    const pad = h('div.keypad', {}, keys.map((k) => h('button', { type: 'button', onclick: () => press(k) }, k)));
    const unitRow = item.unit === 'kg'
      ? h('div.keypad', {},
          h('button', { type: 'button', onclick: () => press('ك') }, 'كيلو'),
          h('button', { type: 'button', onclick: () => press('غ') }, 'غرام'),
          h('button', { type: 'button', onclick: () => press('C') }, 'مسح'))
      : h('div.keypad', {}, h('button', { type: 'button', style: 'grid-column:1/-1', onclick: () => press('C') }, 'مسح'));
    const note = h('input', { type: 'text', id: 'qty-note', placeholder: 'ملاحظة (اختياري)' });
    const token = newToken();
    const kind = resolveKind(ui.party, ui.direction);

    return modal({
      title: `${DIRECTION_LABELS[ui.party.type][ui.direction]} — ${item.name}`,
      confirmText: 'تسجيل',
      body: h('div', {},
        h('div.muted', { style: 'margin-bottom:8px' },
          `${ui.party.name} · ${item.unit === 'kg' ? 'بتقدر تكتب ١٠ك أو ٥٠٠غ' : 'الكمية بالعدد'}`),
        display, pad, unitRow,
        h('label.field', { style: 'margin-top:14px' }, 'ملاحظة', note)),
      onConfirm: async () => {
        if (!value) throw new Error('أدخل الكمية');
        const result = await api.post('/api/transactions', {
          kind,
          entity_id: ui.party.id,
          item_id: item.id,
          quantity: value,
          note: note.value.trim() || undefined,
          client_token: token,
        });
        showWarnings(result.warnings);
        toast(result.duplicate ? 'هاي الحركة مسجّلة أصلاً - ما انسجّلت مرتين'
          : `تم: ${item.name} (${value}) — ${ui.party.name}`);
        loadRecent();
      },
    });
  }

  // ================= توريد ودفعة =================
  function openSupply() {
    const select = h('select', { id: 'supply-item' },
      ui.items.map((i) => h('option', { value: i.id }, i.name)));
    const quantity = h('input', { type: 'text', id: 'supply-qty', placeholder: 'مثلاً ١٠٠ أو ١٠ك' });
    const note = h('input', { type: 'text', id: 'supply-note', placeholder: 'المورّد / ملاحظة (اختياري)' });
    const token = newToken();

    return modal({
      title: 'توريد للمستودع',
      confirmText: 'تسجيل',
      body: h('div.grid', {},
        h('div.muted', {}, 'بضاعة داخلة على المستودع من برّا - ما إلها جهة.'),
        h('label.field', {}, 'الصنف', select),
        h('label.field', {}, 'الكمية', quantity),
        h('label.field', {}, 'ملاحظة', note)),
      onConfirm: async () => {
        if (!quantity.value.trim()) throw new Error('أدخل الكمية');
        const result = await api.post('/api/transactions', {
          kind: 'supply',
          item_id: Number(select.value),
          quantity: quantity.value.trim(),
          note: note.value.trim() || undefined,
          client_token: token,
        });
        showWarnings(result.warnings);
        toast(result.duplicate ? 'التوريد مسجّل أصلاً' : 'تم تسجيل التوريد');
        loadRecent();
      },
    });
  }

  function openPayment() {
    const amount = h('input', { type: 'text', inputmode: 'decimal', id: 'pay-amount', placeholder: 'المبلغ' });
    const method = h('select', { id: 'pay-method' },
      h('option', { value: 'cash' }, 'نقدي'),
      h('option', { value: 'bank' }, 'تحويل بنكي'),
      h('option', { value: 'check' }, 'شيك'));
    const note = h('input', { type: 'text', id: 'pay-note', placeholder: 'رقم الشيك / ملاحظة (اختياري)' });
    const token = newToken();

    return modal({
      title: `دفعة من ${ui.party.name}`,
      confirmText: 'تسجيل',
      body: h('div.grid', {},
        h('label.field', {}, 'المبلغ', amount),
        h('label.field', {}, 'طريقة الدفع', method),
        h('label.field', {}, 'ملاحظة', note)),
      onConfirm: async () => {
        if (!amount.value.trim()) throw new Error('أدخل المبلغ');
        const result = await api.post('/api/transactions', {
          kind: 'payment',
          entity_id: ui.party.id,
          payment_amount: amount.value.trim(),
          method: method.value,
          note: note.value.trim() || undefined,
          client_token: token,
        });
        toast(result.duplicate ? 'الدفعة مسجّلة أصلاً' : `تم تسجيل دفعة ${ui.party.name}`);
        loadRecent();
      },
    });
  }

  function openNewItem() {
    const name = h('input', { type: 'text', id: 'new-item-name', placeholder: 'اسم الصنف' });
    const unit = h('select', { id: 'new-item-unit' },
      h('option', { value: 'piece' }, 'بالعدد'),
      h('option', { value: 'kg' }, 'بالوزن (كيلو/غرام)'));

    return modal({
      title: 'إضافة صنف جديد',
      confirmText: 'إضافة',
      body: h('div.grid', {},
        h('label.field', {}, 'اسم الصنف', name),
        h('label.field', {}, 'وحدة القياس', unit),
        h('div.alert.warn', {}, 'السعر بيحدده قصي من صفحته — الصنف بينضاف بدون سعر.')),
      onConfirm: async () => {
        if (!name.value.trim()) throw new Error('اكتب اسم الصنف');
        await api.post('/api/items', { name: name.value.trim(), unit: unit.value });
        toast('انضاف الصنف');
        await loadItems();
      },
    });
  }

  // ================= تعديل وحذف =================
  function editTransaction(txn) {
    const quantity = h('input', { type: 'text', id: 'edit-qty', value: txn.quantity_input || txn.quantity || '' });
    const amount = h('input', { type: 'text', id: 'edit-amount', value: txn.payment_amount ?? '' });
    const note = h('input', { type: 'text', id: 'edit-note', value: txn.note || '' });
    const isPayment = txn.kind === 'payment';

    return modal({
      title: `تعديل حركة #${txn.id}`,
      confirmText: 'حفظ التعديل',
      body: h('div.grid', {},
        h('div.muted', {}, `${txn.kind_label} — ${txn.entity_name || 'المستودع'} — ${txn.item_name || ''}`),
        isPayment ? h('label.field', {}, 'المبلغ', amount) : h('label.field', {}, 'الكمية', quantity),
        h('label.field', {}, 'ملاحظة', note)),
      onConfirm: async () => {
        const payload = { note: note.value.trim() };
        if (isPayment) payload.payment_amount = amount.value.trim();
        else payload.quantity = quantity.value.trim();
        const result = await api.patch(`/api/transactions/${txn.id}`, payload);
        showWarnings(result.warnings);
        toast('تم التعديل');
        loadRecent();
      },
    });
  }

  async function deleteTransaction(txn) {
    const ok = await modal({
      title: 'حذف حركة',
      confirmText: 'حذف',
      body: h('div', {},
        h('p', {}, `متأكد بدك تحذف: ${txn.kind_label} — ${txn.entity_name || 'المستودع'} — ${txn.item_name || ''}؟`),
        h('div.alert.warn', {}, 'الحذف بينسجّل بسجل التدقيق وبيرجع يعدّل الأرصدة تلقائياً.')),
    });
    if (!ok) return;
    await api.del(`/api/transactions/${txn.id}`);
    toast('تم الحذف');
    loadRecent();
  }

  /** تنبيه كبير وواضح لما الكمية أكتر من المتوفر */
  let warningTimer = null;
  function showWarnings(warnings) {
    clearTimeout(warningTimer);
    clear(banner);
    if (!warnings?.length) return;
    for (const w of warnings) {
      banner.append(h('div.alert.danger.big', {}, h('span', {}, '⚠'), h('span', {}, w.message)));
    }
    warningTimer = setTimeout(() => clear(banner), 15000);
  }

  await Promise.all([loadEntities(), loadItems(), loadRecent()]);
}
