import { api } from '../api.js';
import { h, clear, toast, modal, dateTime, qty, countItems } from '../ui.js';
import { icon } from '../icons.js';

const ARABIC_LETTERS = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('');

/** تطبيع عربي مطابق للي بقاعدة البيانات: "شطه" = "شطة"، وبلا مسافات */
function normalizeAr(text) {
  return String(text || '').toLowerCase()
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
    .replace(/[ً-ْـ]/g, '')
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
function quantityInput(item, initial = '') {
  let value = String(initial || '');
  const display = h('div.qty-display', {}, value || '0');
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
  // عشان زر التأكيد يضل باين بلا سحب. أصناف الوزن بتحتاجها غالباً فبتضل مفتوحة.
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

/** رمز فريد لكل سند - بيمنع تثبيت نفس السند مرتين */
function newToken() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const RECORDER_NAV = [
  { key: 'record', label: 'تسجيل سند', title: 'تسجيل السندات', icon: 'cashier', render: renderRecorder },
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

/** عنوان السند: "سحب بضاعة — بلال" */
function voucherTitle(party, direction) {
  if (!party) return 'سند';
  if (party.type === 'warehouse') return 'توريد للمستودع';
  return `${DIRECTION_LABELS[party.type][direction]} — ${party.name}`;
}

/**
 * شاشة تسجيل السندات (آيباد).
 * التدفّق كله بالضغط - الكتابة هي مصدر الغلط:
 *   جهة => اتجاه => أصناف (سطر ورا سطر بالسند) => جرد كلي للمراجعة => تثبيت
 * السند بينحفظ كله مرّة وحدة: يا كل الأسطر يا ولا وحدة.
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
    // --- السند المفتوح ---
    basket: [],         // [{ item, quantity, note }]
    token: null,        // رمز السند - بيتجدّد مع كل سند جديد
    note: '',           // ملاحظة السند
  };

  const banner = h('div');
  const steps = h('div');
  const picker = h('div');       // البحث + شبكة الأصناف + بار الحروف
  const basketBar = h('div');    // شريط السند المفتوح (ثابت تحت)
  const recentBox = h('div.recent');

  root.append(banner, steps, picker,
    h('div.card', { style: 'margin-top:16px' },
      h('h3', {}, 'آخر السندات اللي سجّلتها'), recentBox),
    basketBar);

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
    const { vouchers } = await api.get('/api/vouchers', { limit: 12, mine: 'true' });
    clear(recentBox);
    if (!vouchers.length) { recentBox.append(h('div.empty', {}, 'ما في سندات بعد')); return; }
    for (const v of vouchers) {
      recentBox.append(h('div.recent-row', {},
        h('span.voucher-no', {}, `سند #${v.voucher_no}`),
        h('span.pill', {}, v.kind_label),
        h('b', {}, v.entity_name || 'المستودع'),
        h('span.grow', {}, countItems(v.line_count)),
        h('span.muted', { style: 'font-size:12px' }, dateTime(v.occurred_at)),
        h('button.btn.ghost.sm', { onclick: () => openVoucher(v) }, 'الجرد'),
        h('button.btn.danger.sm', { onclick: () => deleteVoucher(v) }, 'حذف')));
    }
  }

  /** بداية اختيار جديدة: العائلة المفتوحة والبحث ما لازم يضلوا من الجهة اللي قبل */
  function resetPick() { ui.family = null; ui.search = ''; ui.letter = ''; }

  // ================= السند المفتوح =================
  function startVoucher() {
    ui.basket = [];
    ui.note = '';
    ui.token = newToken();
  }
  function clearVoucher() {
    ui.basket = [];
    ui.note = '';
    ui.token = null;
    drawBasket();
    drawPicker();
  }

  /**
   * تبديل الجهة أو الاتجاه والسند مفتوح بيلغيه - فبنسأل أول.
   * (السند كله على جهة وحدة واتجاه واحد - هيك القاعدة بتفرض كمان)
   */
  async function guardSwitch() {
    if (!ui.basket.length) return true;
    const ok = await modal({
      title: 'في سند مفتوح',
      confirmText: 'إلغاء السند',
      cancelText: 'رجوع للسند',
      body: h('div', {},
        h('div.confirm-bar', {},
          h('span.pill', {}, voucherTitle(ui.party, ui.direction)),
          h('b', {}, countItems(ui.basket.length))),
        h('p', {}, 'إذا بدّلت الجهة أو الاتجاه بينلغي السند المفتوح وأصنافه.'),
        h('div.alert.warn', {}, 'السند الواحد بيكون على جهة وحدة واتجاه واحد.')),
    });
    if (!ok) return false;
    clearVoucher();
    return true;
  }

  function basketQtyOf(item) {
    return ui.basket.filter((l) => l.item.id === item.id).length;
  }

  function addLine(item, quantity, note) {
    if (!ui.token) startVoucher();
    ui.basket.push({ item, quantity, note: note || '' });
    drawBasket();
  }

  function drawBasket() {
    clear(basketBar);
    // مساحة تحت عشان الشريط الثابت ما يغطّي آخر الصفحة
    document.body.classList.toggle('has-voucher-bar', ui.basket.length > 0);
    if (!ui.basket.length) return;

    basketBar.append(h('div.voucher-bar', {},
      h('div.voucher-bar-info', {},
        h('span.voucher-count', {}, String(ui.basket.length)),
        h('span', {},
          h('b', {}, voucherTitle(ui.party, ui.direction)),
          h('small', {}, `${countItems(ui.basket.length)} بالسند — ما انثبّت بعد`))),
      h('div.row', {},
        h('button.btn.ghost', { onclick: () => guardSwitch() }, 'إلغاء'),
        h('button.btn.gold.lg', { onclick: openReview }, icon('check', 16), 'مراجعة وتثبيت'))));
  }

  // ================= الجرد الكلي قبل التثبيت =================
  function openReview() {
    if (!ui.basket.length) { toast('السند فاضي', true); return; }
    const noteInput = h('input', { type: 'text', id: 'voucher-note', value: ui.note,
      placeholder: 'ملاحظة على السند كله (اختياري)' });
    const listBox = h('div.review-lines');

    /** الأصناف المكرّرة بتنعلّم عشان يتأكد إنها مقصودة */
    function duplicates() {
      const seen = new Map();
      for (const line of ui.basket) seen.set(line.item.id, (seen.get(line.item.id) || 0) + 1);
      return seen;
    }

    function drawLines() {
      clear(listBox);
      const dup = duplicates();
      ui.basket.forEach((line, index) => {
        listBox.append(h('div.review-line', {},
          h('span.review-no', {}, String(index + 1)),
          h('span.review-item', {},
            h('b', {}, line.item.name),
            line.note ? h('small', {}, line.note) : null,
            dup.get(line.item.id) > 1 ? h('small.dup', {}, 'هذا الصنف مكرّر بالسند') : null),
          h('span.review-qty', {}, line.quantity,
            h('small', {}, line.item.unit === 'kg' ? 'بالوزن' : 'بالعدد')),
          h('button.btn.ghost.sm', { onclick: () => editLine(index, drawLines) }, 'تعديل'),
          h('button.btn.danger.sm', {
            onclick: () => { ui.basket.splice(index, 1); drawBasket(); drawLines(); },
          }, 'شيل')));
      });
      if (!ui.basket.length) {
        listBox.append(h('div.empty', {}, 'السند صار فاضي - ارجع وضيف أصناف'));
      }
      count.textContent = countItems(ui.basket.length);
    }
    const count = h('b', {}, countItems(ui.basket.length));
    drawLines();

    return modal({
      title: 'الجرد الكلي — راجع قبل ما تثبّت',
      confirmText: 'بثبّت السند',
      cancelText: 'رجوع للسند',
      wide: true,
      body: h('div', {},
        h('div.confirm-bar', {},
          h('span.pill', { class: ui.direction === 'out' ? 'out' : 'in' },
            voucherTitle(ui.party, ui.direction)),
          h('span.muted', {}, '·'),
          count),
        listBox,
        h('label.field', { style: 'margin-top:14px' }, 'ملاحظة السند', noteInput),
        h('div.alert.warn', {}, 'بعد التثبيت بتنحفظ كل الأسطر مرّة وحدة، وبيطلع للسند رقم.')),
      onConfirm: async () => {
        if (!ui.basket.length) throw new Error('السند فاضي');
        ui.note = noteInput.value.trim();
        await commitVoucher();
      },
    });
  }

  /** تعديل كمية سطر قبل التثبيت */
  function editLine(index, after) {
    const line = ui.basket[index];
    const input = quantityInput(line.item, line.quantity);
    const note = h('input', { type: 'text', id: 'line-note', value: line.note || '',
      placeholder: 'ملاحظة على السطر (اختياري)' });
    return modal({
      title: `تعديل: ${line.item.name}`,
      confirmText: 'حفظ',
      body: h('div', {}, input.el, h('label.field', { style: 'margin-top:14px' }, 'ملاحظة', note)),
      onConfirm: () => {
        const value = input.get();
        if (!value) throw new Error('أدخل الكمية');
        line.quantity = value;
        line.note = note.value.trim();
        after();
      },
    });
  }

  /** التثبيت: السند وكل أسطره بنداء واحد - يا كله يا ولا شي */
  async function commitVoucher() {
    const result = await api.post('/api/vouchers', {
      kind: resolveKind(ui.party, ui.direction),
      entity_id: ui.party.id || undefined,
      note: ui.note || undefined,
      client_token: ui.token,
      lines: ui.basket.map((l) => ({
        item_id: l.item.id,
        quantity: l.quantity,
        note: l.note || undefined,
      })),
    });
    showWarnings(result.warnings);
    toast(result.duplicate
      ? `سند #${result.voucher.voucher_no} مثبّت أصلاً - ما انثبّت مرتين`
      : `تم تثبيت سند #${result.voucher.voucher_no} — ${countItems(result.lines.length)}`);
    resetPick();
    clearVoucher();
    loadRecent();
  }

  // ================= الخطوات =================
  function drawSteps() {
    clear(steps);

    // --- الخطوة ١: الجهة ---
    const partyGrid = h('div.party-grid');
    for (const e of ui.entities) {
      partyGrid.append(h('button.party', {
        class: ui.party?.id === e.id ? 'active' : '',
        onclick: async () => {
          if (ui.party?.id === e.id) return;
          if (!await guardSwitch()) return;
          resetPick(); ui.party = e; ui.direction = null; drawSteps(); drawPicker();
        },
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
          onclick: async () => {
            if (ui.party?.type === 'warehouse') return;
            if (!await guardSwitch()) return;
            resetPick(); ui.party = WAREHOUSE; ui.direction = 'in'; drawSteps(); drawPicker();
          },
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
        onclick: async () => {
          if (ui.direction === dir) return;
          if (!await guardSwitch()) return;
          resetPick(); ui.direction = dir; drawSteps(); drawPicker();
        },
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
        const inBasket = basketQtyOf(item);
        target.append(h('div.item-tile', {
          class: inBasket ? 'picked' : '',
          onclick: () => openQuantity(item, drawGrid),
        },
          inBasket ? h('span.tile-badge', {}, String(inBasket)) : null,
          h('span', {}, item.size ? `${trimNum(item.size)}${item.size_unit || ''}` : item.name),
          h('small', {}, item.size ? item.name : (item.unit === 'kg' ? 'بالوزن' : 'بالعدد')),
          item.needs_price ? h('small', { style: 'color:var(--warn)' }, 'بدون سعر') : null));
      }
    }

    const heading = ui.party.type === 'warehouse'
      ? 'توريد للمستودع — ضيف الأصناف للسند'
      : `${DIRECTION_LABELS[ui.party.type][ui.direction]} — ضيف الأصناف للسند`;
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

  // ================= إضافة صنف للسند =================
  function openQuantity(item, after = () => {}) {
    const input = quantityInput(item);
    const note = h('input', { type: 'text', id: 'qty-note', placeholder: 'ملاحظة على السطر (اختياري)' });
    const already = basketQtyOf(item);

    return modal({
      title: `${ui.party.name} — ${item.name}`,
      confirmText: 'ضيف للسند',
      body: h('div', {},
        // ملخّص واضح قبل الإضافة: مين، شو الاتجاه، وأي صنف
        h('div.confirm-bar', {},
          h('span.pill', { class: ui.direction === 'out' ? 'out' : 'in' },
            voucherTitle(ui.party, ui.direction)),
          h('span.muted', {}, '·'),
          h('b', {}, item.name),
          ui.basket.length ? h('span.muted', {}, `· بالسند ${countItems(ui.basket.length)}`) : null),
        already ? h('div.alert.warn', {}, `هذا الصنف موجود بالسند (${already === 1 ? 'سطر واحد' : already + ' أسطر'}) - إذا ضفته بيصير سطر زيادة.`) : null,
        input.el,
        h('label.field', { style: 'margin-top:14px' }, 'ملاحظة', note)),
      onConfirm: () => {
        const value = input.get();
        if (!value) throw new Error('أدخل الكمية');
        addLine(item, value, note.value.trim());
        toast(`انضاف للسند: ${item.name} (${value})`);
        after();
      },
    });
  }

  // ================= صنف جديد =================
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

  // ================= سند مثبّت: جرد، تعديل سطر، حذف =================
  async function openVoucher(summary) {
    const { voucher, lines } = await api.get(`/api/vouchers/${summary.id}`);
    const listBox = h('div.review-lines');

    function drawLines(rows) {
      clear(listBox);
      if (!rows.length) { listBox.append(h('div.empty', {}, 'ما ضل ولا سطر بالسند')); return; }
      rows.forEach((line, index) => {
        listBox.append(h('div.review-line', {},
          h('span.review-no', {}, String(index + 1)),
          h('span.review-item', {},
            h('b', {}, line.item_name),
            line.note ? h('small', {}, line.note) : null),
          h('span.review-qty', {}, qty(line.quantity, line.item_unit)),
          h('button.btn.ghost.sm', {
            onclick: () => editSavedLine(line, async () => {
              const fresh = await api.get(`/api/vouchers/${summary.id}`);
              drawLines(fresh.lines);
              loadRecent();
            }),
          }, 'تعديل'),
          h('button.btn.danger.sm', {
            onclick: async () => {
              await api.del(`/api/transactions/${line.id}`);
              toast('انشال السطر من السند');
              const fresh = await api.get(`/api/vouchers/${summary.id}`);
              drawLines(fresh.lines);
              loadRecent();
            },
          }, 'شيل')));
      });
    }
    drawLines(lines);

    return modal({
      title: `سند #${voucher.voucher_no}`,
      confirmText: 'تمام',
      cancelText: 'إغلاق',
      wide: true,
      body: h('div', {},
        h('div.confirm-bar', {},
          h('span.pill', {}, voucher.kind_label),
          h('b', {}, voucher.entity_name || 'المستودع'),
          h('span.muted', {}, '·'),
          h('span', {}, dateTime(voucher.occurred_at))),
        voucher.note ? h('div.muted', { style: 'margin-bottom:10px' }, voucher.note) : null,
        listBox),
    });
  }

  /** تعديل كمية سطر مثبّت (الحركة نفسها) */
  function editSavedLine(line, after) {
    const input = quantityInput({ unit: line.item_unit }, line.quantity_input || '');
    const note = h('input', { type: 'text', id: 'edit-note', value: line.note || '' });
    return modal({
      title: `تعديل: ${line.item_name}`,
      confirmText: 'حفظ التعديل',
      body: h('div.grid', {},
        h('div.muted', {}, `الكمية الحالية: ${line.quantity_input || line.quantity}`),
        input.el,
        h('label.field', { style: 'margin-top:14px' }, 'ملاحظة', note)),
      onConfirm: async () => {
        const value = input.get();
        if (!value) throw new Error('أدخل الكمية الجديدة');
        const result = await api.patch(`/api/transactions/${line.id}`, {
          quantity: value, note: note.value.trim(),
        });
        showWarnings(result.warnings);
        toast('تم التعديل');
        await after();
      },
    });
  }

  async function deleteVoucher(v) {
    const ok = await modal({
      title: `حذف سند #${v.voucher_no}`,
      confirmText: 'حذف السند كله',
      body: h('div', {},
        h('div.confirm-bar', {},
          h('span.pill', {}, v.kind_label),
          h('b', {}, v.entity_name || 'المستودع'),
          h('span.muted', {}, '·'),
          h('b', {}, countItems(v.line_count))),
        h('div.alert.warn', {}, 'بينحذف السند وكل أسطره مع بعض، وبينسجّل بسجل التدقيق. الأرصدة بترجع تلقائياً.')),
    });
    if (!ok) return;
    await api.del(`/api/vouchers/${v.id}`);
    toast(`انحذف سند #${v.voucher_no}`);
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

  drawBasket();   // بيصفّي أثر أي سند من زيارة سابقة للصفحة
  await Promise.all([loadEntities(), loadItems(), loadRecent()]);
}
