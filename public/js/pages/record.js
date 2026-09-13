import { api } from '../api.js';
import { h, clear, toast, modal, dateTime, qty } from '../ui.js';
import { icon } from '../icons.js';

const ARABIC_LETTERS = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('');

/** تطبيع عربي مطابق للي بقاعدة البيانات: "شطه" = "شطة"، وبلا مسافات */
function normalizeAr(text) {
  return String(text || '').toLowerCase()
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/\s+/g, '');
}
const trimNum = (n) => String(Number(n)).replace(/\.0+$/, '');

/** الكميات الأكتر استعمالاً - ضغطة وحدة بدل كتابة */
const QUICK = [1, 2, 3, 4, 5, 6, 10, 12, 20, 24, 25, 50];

/**
 * مُدخل كمية موحّد: كميات جاهزة بضغطة + لوحة أرقام للباقي.
 * الهدف تقليل الكتابة قدر الإمكان - الكتابة هي مصدر الغلط.
 * @returns {{ el: HTMLElement, get: () => string }}
 */
function quantityInput(item) {
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

  const quick = h('div.quick-qty', {}, QUICK.map((n) => h('button', {
    type: 'button', onclick: () => { value = String(n); update(); },
  }, String(n))));

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  const pad = h('div.keypad', {}, keys.map((k) => h('button', { type: 'button', onclick: () => press(k) }, k)));
  const unitRow = item.unit === 'kg'
    ? h('div.keypad', {},
        h('button', { type: 'button', onclick: () => press('ك') }, 'كيلو'),
        h('button', { type: 'button', onclick: () => press('غ') }, 'غرام'),
        h('button', { type: 'button', onclick: () => press('C') }, 'مسح'))
    : h('div.keypad', {}, h('button', { type: 'button', style: 'grid-column:1/-1', onclick: () => press('C') }, 'مسح'));

  // الأصناف بالعدد: الكميات الجاهزة بتغطّي معظم الحالات، فلوحة الأرقام مطويّة
  // عشان زر "تسجيل" يضل باين بلا سحب. أصناف الوزن بتحتاجها غالباً فبتضل مفتوحة.
  const byWeight = item.unit === 'kg';
  const padBox = h('div', { style: byWeight ? '' : 'display:none' }, pad, unitRow);
  const toggle = h('button.btn.ghost.sm', {
    type: 'button', style: byWeight ? 'display:none' : '',
    onclick: () => { padBox.style.display = ''; toggle.style.display = 'none'; },
  }, 'رقم تاني…');

  const el = h('div', {},
    display,
    h('div.qty-label', {}, 'الأكتر استعمالاً'),
    quick,
    h('div.row', { style: 'margin-top:10px' }, toggle),
    padBox);

  return { el, get: () => value };
}

/** رمز فريد لكل محاولة تسجيل - بيمنع تسجيل نفس الحركة مرتين */
function newToken() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const RECORDER_NAV = [
  { key: 'record', label: 'تسجيل حركة', title: 'تسجيل الحركات', icon: 'cashier', render: renderRecorder },
];

/** المستودع نفسه: التوريد بيدخل عليه من برّا، فما إله جهة */
const WAREHOUSE = { id: null, name: 'المستودع', type: 'warehouse' };

/** نوع الحركة = الجهة + الاتجاه */
function resolveKind(party, direction) {
  if (party.type === 'warehouse') return 'supply';
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
 * التدفّق كله بالضغط - الكتابة هي مصدر الغلط:
 *   جهة => اتجاه => صنف => كمية (كميات جاهزة بضغطة، ولوحة أرقام للباقي)
 * التوريد بيتخطّى خطوة الاتجاه (دايماً بضاعة داخلة) وما إله جهة.
 * الدفعات مش هون - شغل مالي بيتسجّل من حساب المدير.
 */
async function renderRecorder(root) {
  clear(root);

  const ui = {
    party: null,        // الجهة المختارة
    direction: null,    // 'in' | 'out'
    family: null,       // عائلة المنتج المفتوحة
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
    ui.activeLetters = new Set(items.map((i) => (i.base || i.name).trim()[0]));
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
        h('span.grow', {}, `${t.item_name} — ${qty(t.quantity, t.item_unit)}`),
        h('span.muted', { style: 'font-size:12px' }, dateTime(t.occurred_at)),
        h('button.btn.ghost.sm', { onclick: () => editTransaction(t) }, 'تعديل'),
        h('button.btn.danger.sm', { onclick: () => deleteTransaction(t) }, 'حذف')));
    }
  }

  /** بداية اختيار جديدة: العائلة المفتوحة والبحث ما لازم يضلوا من الجهة اللي قبل */
  function resetPick() { ui.family = null; ui.search = ''; ui.letter = ''; }

  // ================= الخطوات =================
  function drawSteps() {
    clear(steps);

    // --- الخطوة ١: الجهة ---
    const partyGrid = h('div.party-grid');
    for (const e of ui.entities) {
      partyGrid.append(h('button.party', {
        class: ui.party?.id === e.id ? 'active' : '',
        onclick: () => { resetPick(); ui.party = e; ui.direction = null; drawSteps(); drawPicker(); },
      },
        h('span.party-name', {}, e.name),
        h('small', {}, e.type === 'operator' ? 'جهة داخلية' : 'زبون')));
    }

    steps.append(h('div.step', {},
      h('div.step-head', {}, h('span.step-no', {}, '١'), h('b', {}, 'على مين؟')),
      partyGrid,
      h('div.row', { style: 'margin-top:12px' },
        h('button.btn.ghost', {
          class: ui.party?.type === 'warehouse' ? 'active-supply' : '',
          // التوريد ما إله جهة ولا اتجاه - بضغطة بيفتح الأصناف على طول
          onclick: () => { resetPick(); ui.party = WAREHOUSE; ui.direction = 'in'; drawSteps(); drawPicker(); },
        }, icon('box', 16), 'توريد للمستودع'))));

    // التوريد بيتخطّى خطوة الاتجاه - دايماً بضاعة داخلة
    if (!ui.party || ui.party.type === 'warehouse') return;

    // --- الخطوة ٢: الاتجاه ---
    const labels = DIRECTION_LABELS[ui.party.type];
    const hints = DIRECTION_HINTS[ui.party.type];
    const dirGrid = h('div.dir-grid');
    for (const dir of ['out', 'in']) {
      dirGrid.append(h('button.dir', {
        class: `${dir} ${ui.direction === dir ? 'active' : ''}`.trim(),
        onclick: () => { resetPick(); ui.direction = dir; drawSteps(); drawPicker(); },
      },
        h('span.dir-arrow', {}, dir === 'out' ? '↑' : '↓'),
        h('span', {}, h('b', {}, labels[dir]), h('small', {}, hints[dir]))));
    }
    steps.append(h('div.step', {},
      h('div.step-head', {}, h('span.step-no', {}, '٢'),
        h('b', {}, `${ui.party.name} — إدخال ولا إخراج؟`)),
      dirGrid));
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
      type: 'search', placeholder: 'دوّر بالاسم — بيقبل "شطه" و"شطة5ك"…', id: 'item-search',
      value: ui.search,
      oninput: (e) => { ui.search = e.target.value.trim(); ui.letter = ''; ui.family = null; drawGrid(); drawAlpha(); },
    });
    const itemGrid = h('div.item-grid');
    const alphaBar = h('div.alpha-bar');
    const crumb = h('div.crumb');

    function drawAlpha() {
      clear(alphaBar);
      alphaBar.append(h('button', {
        class: ui.letter === '' ? 'active' : '',
        onclick: () => { ui.letter = ''; ui.family = null; drawAlpha(); drawGrid(); },
      }, '⌂'));
      for (const letter of ARABIC_LETTERS) {
        const has = ui.activeLetters.has(letter)
          || (letter === 'أ' && [...ui.activeLetters].some((l) => 'اآإأ'.includes(l)));
        alphaBar.append(h('button', {
          class: `${ui.letter === letter ? 'active' : ''} ${has ? '' : 'off'}`.trim(),
          onclick: () => {
            ui.letter = ui.letter === letter ? '' : letter;
            ui.search = ''; searchInput.value = ''; ui.family = null;
            drawAlpha(); drawGrid();
          },
        }, letter));
      }
    }

    /** الأصناف بعد البحث/الحرف */
    function filtered() {
      let list = ui.items;
      if (ui.search) {
        const t = normalizeAr(ui.search);
        list = list.filter((i) => normalizeAr(i.name).includes(t)
          || normalizeAr(i.base || '').includes(t));
      }
      if (ui.letter) {
        const variants = ui.letter === 'أ' ? ['أ', 'ا', 'إ', 'آ'] : [ui.letter];
        list = list.filter((i) => variants.includes((i.base || i.name).trim()[0]));
      }
      return list;
    }

    function drawGrid() {
      clear(itemGrid); clear(crumb);
      const list = filtered();

      if (!list.length) {
        itemGrid.append(h('div', { style: 'grid-column:1/-1' }, h('div.empty', {}, 'ما في أصناف مطابقة')));
        return;
      }

      // البحث بيعرض الأصناف مباشرة - المستخدم عارف شو بده
      if (ui.search) { drawItems(list); return; }

      // عائلة مختارة => أحجامها
      if (ui.family) {
        const sizes = list.filter((i) => (i.base || i.name) === ui.family);
        crumb.append(
          h('button.btn.ghost.sm', { onclick: () => { ui.family = null; drawGrid(); } }, '→ كل الأصناف'),
          h('b', {}, ui.family));
        drawItems(sizes);
        return;
      }

      // الافتراضي: عائلات المنتجات (٩٣ عائلة بدل ٢٣٣ صنف)
      const families = new Map();
      for (const i of list) {
        const key = i.base || i.name;
        if (!families.has(key)) families.set(key, []);
        families.get(key).push(i);
      }
      for (const [name, members] of families) {
        if (members.length === 1) { drawItems(members, itemGrid); continue; }
        itemGrid.append(h('div.item-tile.family', {
          onclick: () => { ui.family = name; drawGrid(); },
        },
          h('span', {}, name),
          h('small', {}, `${members.length} أحجام`)));
      }
    }

    function drawItems(list, target = itemGrid) {
      for (const item of list) {
        target.append(h('div.item-tile', { onclick: () => openQuantity(item) },
          h('span', {}, item.size ? `${trimNum(item.size)}${item.size_unit || ''}` : item.name),
          h('small', {}, item.size ? item.name : (item.unit === 'kg' ? 'بالوزن' : 'بالعدد')),
          item.needs_price ? h('small', { style: 'color:var(--warn)' }, 'بدون سعر') : null));
      }
    }

    const heading = ui.party.type === 'warehouse'
      ? 'توريد للمستودع — اختار الصنف'
      : `${DIRECTION_LABELS[ui.party.type][ui.direction]} — اختار الصنف`;
    picker.append(h('div.step', {},
      h('div.step-head', {}, h('span.step-no', {}, ui.party.type === 'warehouse' ? '٢' : '٣'),
        h('b', {}, heading)),
      h('div.cashier-bar', {}, searchInput,
        h('button.btn.gold', { onclick: openNewItem }, 'صنف جديد')),
      crumb,
      h('div.cashier', {}, alphaBar, h('div.cashier-main', {}, itemGrid))));

    drawAlpha();
    drawGrid();
    requestAnimationFrame(() => picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  // ================= إدخال الكمية =================
  function openQuantity(item) {
    const input = quantityInput(item);
    const note = h('input', { type: 'text', id: 'qty-note', placeholder: 'ملاحظة (اختياري)' });
    const token = newToken();
    const kind = resolveKind(ui.party, ui.direction);
    const isSupply = kind === 'supply';

    return modal({
      title: `${ui.party.name} — ${item.name}`,
      confirmText: 'تسجيل',
      body: h('div', {},
        // ملخّص واضح قبل التسجيل: مين، شو الاتجاه، وأي صنف
        h('div.confirm-bar', {},
          h('span.pill', { class: ui.direction === 'out' ? 'out' : 'in' },
            isSupply ? 'توريد' : DIRECTION_LABELS[ui.party.type][ui.direction]),
          h('b', {}, ui.party.name),
          h('span.muted', {}, '·'),
          h('b', {}, item.name)),
        input.el,
        h('label.field', { style: 'margin-top:14px' }, 'ملاحظة', note)),
      onConfirm: async () => {
        const value = input.get();
        if (!value) throw new Error('أدخل الكمية');
        const result = await api.post('/api/transactions', {
          kind,
          entity_id: ui.party.id || undefined,
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
    const input = quantityInput({ unit: txn.item_unit });
    const note = h('input', { type: 'text', id: 'edit-note', value: txn.note || '' });

    return modal({
      title: `تعديل حركة #${txn.id}`,
      confirmText: 'حفظ التعديل',
      body: h('div.grid', {},
        h('div.confirm-bar', {},
          h('span.pill', {}, txn.kind_label),
          h('b', {}, txn.entity_name || 'المستودع'),
          h('span.muted', {}, '·'),
          h('b', {}, txn.item_name || '')),
        h('div.muted', { style: 'margin-bottom:8px' }, `الكمية الحالية: ${txn.quantity_input || txn.quantity}`),
        input.el,
        h('label.field', { style: 'margin-top:14px' }, 'ملاحظة', note)),
      onConfirm: async () => {
        const value = input.get();
        if (!value) throw new Error('أدخل الكمية الجديدة');
        const payload = { note: note.value.trim(), quantity: value };
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
