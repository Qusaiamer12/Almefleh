import { api } from '../api.js';
import { h, clear, toast, modal, dateTime, qty, money, METHOD_LABELS } from '../ui.js';

const ARABIC_LETTERS = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('');

const KINDS = [
  { value: 'supply', label: 'توريد', needsEntity: false, entityType: null },
  { value: 'customer_out', label: 'سحب زبون', needsEntity: true, entityType: 'customer' },
  { value: 'customer_return', label: 'إرجاع بضاعة', needsEntity: true, entityType: 'customer' },
  { value: 'payment', label: 'دفعة', needsEntity: true, entityType: 'customer', noItem: true },
  { value: 'operator_out', label: 'إخراج للمشغل', needsEntity: true, entityType: 'operator' },
  { value: 'operator_in', label: 'إدخال من المشغل', needsEntity: true, entityType: 'operator' },
];

/** شاشة تسجيل الحركات - مصمّمة للآيباد (تشبه شاشة الكاشير) */
export async function renderRecorder(root) {
  clear(root);

  const ui = {
    kind: KINDS[1],
    entityId: null,
    search: '',
    letter: '',
    items: [],
    entities: [],
    activeLetters: new Set(),
  };

  const kindTabs = h('div.entity-tabs.kind-tabs');
  const entityTabs = h('div.entity-tabs');
  const searchInput = h('input', {
    type: 'search', placeholder: 'دوّر على صنف بالاسم…',
    oninput: () => { ui.search = searchInput.value.trim(); ui.letter = ''; drawGrid(); drawAlpha(); },
  });
  const itemGrid = h('div.item-grid');
  const alphaBar = h('div.alpha-bar');
  const recentBox = h('div.recent');
  const banner = h('div', {});

  const layout = h('div.cashier', {},
    h('div.cashier-main', {},
      banner,
      h('div.cashier-bar', {}, kindTabs),
      entityTabs,
      h('div.cashier-bar', {}, searchInput,
        h('button.btn.gold', { onclick: openNewItem }, '+ صنف جديد')),
      itemGrid,
      h('div.card', { style: 'margin:0;padding:8px' },
        h('h3', { style: 'margin:4px 8px 6px;font-size:14px' }, 'آخر الحركات اللي سجّلتها'),
        recentBox)),
    alphaBar);
  root.append(layout);

  // ---------- تحميل البيانات ----------
  async function loadEntities() {
    const { entities } = await api.get('/api/users/entities');
    ui.entities = entities;
    drawEntityTabs();
  }

  async function loadItems() {
    const { items } = await api.get('/api/items');
    ui.items = items;
    ui.activeLetters = new Set(items.map((i) => i.name.trim()[0]));
    drawAlpha();
    drawGrid();
  }

  async function loadRecent() {
    const { transactions } = await api.get('/api/transactions', { limit: 15, mine: 'true' });
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

  // ---------- الرسم ----------
  function drawKindTabs() {
    clear(kindTabs);
    for (const kind of KINDS) {
      kindTabs.append(h('button', {
        class: ui.kind.value === kind.value ? 'active' : '',
        onclick: () => { ui.kind = kind; ui.entityId = null; drawKindTabs(); drawEntityTabs(); drawGrid(); },
      }, kind.label));
    }
  }

  function drawEntityTabs() {
    clear(entityTabs);
    if (!ui.kind.needsEntity) {
      entityTabs.append(h('div.muted', { style: 'padding:4px' }, 'توريد للمستودع — مش محتاج جهة'));
      return;
    }
    const list = ui.entities.filter((e) => e.type === ui.kind.entityType);
    if (list.length === 1) ui.entityId = ui.entityId ?? list[0].id;
    for (const entity of list) {
      entityTabs.append(h('button', {
        class: ui.entityId === entity.id ? 'active' : '',
        onclick: () => { ui.entityId = entity.id; drawEntityTabs(); drawGrid(); },
      }, entity.name));
    }
  }

  function drawAlpha() {
    clear(alphaBar);
    alphaBar.append(h('button', {
      class: ui.letter === '' ? 'active' : '',
      onclick: () => { ui.letter = ''; drawAlpha(); drawGrid(); },
    }, '⌂'));
    for (const letter of ARABIC_LETTERS) {
      const has = ui.activeLetters.has(letter) ||
        (letter === 'أ' && [...ui.activeLetters].some((l) => 'اآإأ'.includes(l)));
      alphaBar.append(h('button', {
        class: `${ui.letter === letter ? 'active' : ''} ${has ? '' : 'off'}`.trim(),
        onclick: () => { ui.letter = ui.letter === letter ? '' : letter; ui.search = ''; searchInput.value = ''; drawAlpha(); drawGrid(); },
      }, letter));
    }
  }

  function visibleItems() {
    let list = ui.items;
    if (ui.search) list = list.filter((i) => i.name.includes(ui.search));
    if (ui.letter) {
      const variants = ui.letter === 'أ' ? ['أ', 'ا', 'إ', 'آ'] : [ui.letter];
      list = list.filter((i) => variants.includes(i.name.trim()[0]));
    }
    return list;
  }

  function drawGrid() {
    clear(itemGrid);
    clear(banner);

    if (ui.kind.noItem) {
      itemGrid.append(h('div', { style: 'grid-column:1/-1' },
        h('div.card', {},
          h('h3', {}, 'تسجيل دفعة'),
          !ui.entityId ? h('div.alert.warn', {}, 'اختار الزبون أول شي')
            : h('button.btn', { onclick: openPayment }, 'أدخل مبلغ الدفعة'))));
      return;
    }
    if (ui.kind.needsEntity && !ui.entityId) {
      itemGrid.append(h('div', { style: 'grid-column:1/-1' },
        h('div.alert.warn', {}, 'اختار الجهة أول شي، بعدين اختار الصنف')));
      return;
    }

    const list = visibleItems();
    if (!list.length) {
      itemGrid.append(h('div', { style: 'grid-column:1/-1' },
        h('div.empty', {}, 'ما في أصناف مطابقة')));
      return;
    }
    for (const item of list) {
      itemGrid.append(h('div.item-tile', {
        onclick: () => openQuantity(item),
      },
        h('span', {}, item.name),
        h('small', {}, item.unit === 'kg' ? 'بالوزن' : 'بالعدد'),
        item.needs_price ? h('small', { style: 'color:#9A6A00' }, 'بدون سعر') : null));
    }
  }

  // ---------- إدخال الكمية (لوحة أرقام) ----------
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

    const note = h('input', { type: 'text', placeholder: 'ملاحظة (اختياري)' });

    return modal({
      title: `${ui.kind.label} — ${item.name}`,
      confirmText: 'تسجيل',
      body: h('div', {},
        h('div.muted', { style: 'margin-bottom:6px' },
          item.unit === 'kg' ? 'بتقدر تكتب ١٠ك أو ٥٠٠غ' : 'الكمية بالعدد'),
        display, pad, unitRow,
        h('label.field', { style: 'margin-top:12px' }, 'ملاحظة', note)),
      onConfirm: async () => {
        if (!value) throw new Error('أدخل الكمية');
        const payload = {
          kind: ui.kind.value,
          entity_id: ui.kind.needsEntity ? ui.entityId : undefined,
          item_id: item.id,
          quantity: value,
          note: note.value.trim() || undefined,
        };
        const result = await api.post('/api/transactions', payload);
        showWarnings(result.warnings);
        toast(`تم: ${ui.kind.label} — ${item.name} (${value})`);
        loadRecent();
      },
    });
  }

  function openPayment() {
    const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'المبلغ' });
    const method = h('select', {},
      h('option', { value: 'cash' }, 'نقدي'),
      h('option', { value: 'bank' }, 'تحويل بنكي'),
      h('option', { value: 'check' }, 'شيك'));
    const note = h('input', { type: 'text', placeholder: 'رقم الشيك / ملاحظة (اختياري)' });

    return modal({
      title: 'تسجيل دفعة',
      confirmText: 'تسجيل',
      body: h('div.grid', {},
        h('label.field', {}, 'المبلغ', amount),
        h('label.field', {}, 'طريقة الدفع', method),
        h('label.field', {}, 'ملاحظة', note)),
      onConfirm: async () => {
        if (!amount.value.trim()) throw new Error('أدخل المبلغ');
        await api.post('/api/transactions', {
          kind: 'payment',
          entity_id: ui.entityId,
          payment_amount: amount.value.trim(),
          method: method.value,
          note: note.value.trim() || undefined,
        });
        toast('تم تسجيل الدفعة');
        loadRecent();
      },
    });
  }

  function openNewItem() {
    const name = h('input', { type: 'text', placeholder: 'اسم الصنف' });
    const unit = h('select', {},
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

  function editTransaction(txn) {
    const quantity = h('input', { type: 'text', value: txn.quantity_input || txn.quantity || '' });
    const amount = h('input', { type: 'text', value: txn.payment_amount ?? '' });
    const note = h('input', { type: 'text', value: txn.note || '' });
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
  function showWarnings(warnings) {
    clear(banner);
    if (!warnings?.length) return;
    for (const w of warnings) {
      banner.append(h('div.alert.danger.big', {},
        h('span', {}, '⚠'),
        h('span', {}, w.message)));
    }
    setTimeout(() => clear(banner), 15000);
  }

  drawKindTabs();
  await Promise.all([loadEntities(), loadItems(), loadRecent()]);
}
