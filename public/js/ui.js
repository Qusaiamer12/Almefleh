// أدوات بناء الواجهة
export const state = { user: null, currency: 'د.أ', logo: '/assets/logo' };

/** إنشاء عنصر: h('div.card', {onclick}, ...children) - بتدعم #id و .class */
const SPEC_RE = /^([a-zA-Z][a-zA-Z0-9-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/;
export function h(spec, props = {}, ...children) {
  const match = SPEC_RE.exec(String(spec));
  if (!match) throw new Error(`وصف عنصر غير صالح: ${spec}`);
  const [, tag, id, classPart] = match;
  const el = document.createElement(tag || 'div');
  if (id) el.id = id.slice(1);
  if (classPart) el.className = classPart.slice(1).split('.').join(' ');
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = `${el.className} ${value}`.trim();
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && key !== 'list' && key !== 'type' && key !== 'size') el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

// عزل ثنائي الاتجاه: بيخلّي الرقم وإشارته يظهروا صح جوّا نص عربي
const ltr = (text) => `\u2066${text}\u2069`;

/** مبلغ مالي */
export function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  // الدينار الأردني ألف فلس => ٣ منازل عشرية
  return `${ltr(n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }))} ${state.currency}`;
}

/** كمية حسب وحدة الصنف */
export function qty(value, unit) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (unit === 'kg') {
    if (n !== 0 && Math.abs(n) < 1) return `${ltr(Math.round(n * 1000))} غم`;
    return `${ltr(trim(n.toFixed(3)))} كغم`;
  }
  return ltr(trim(n.toFixed(3)));
}
const trim = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

const DOW = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const TZ = 'Asia/Amman';

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  return `${DOW[idx]} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function dateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(value));
}

/** اليوم بصيغة YYYY-MM-DD بتوقيت المستودع */
export const todayString = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

// ===== تحويل التواريخ بتوقيت المستودع =====
// كل تاريخ بيدخله المستخدم بينقرأ بتوقيت المستودع (عمّان)، مش بتوقيت جهازه.
// بدون هاد، آيباد مضبوط على توقيت تاني بيزيح الحركة ساعات - وقرب منتصف
// الليل بتنتقل ليوم تاني، يعني أسبوع تاني بالكشف.

const pad2 = (n) => String(n).padStart(2, '0');

function ammanParts(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
  };
}

function tzOffsetMs(date) {
  const p = ammanParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    - Math.floor(date.getTime() / 1000) * 1000;
}

/** وقت محلي بتوقيت المستودع => لحظة UTC */
function ammanToUtc(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = tzOffsetMs(new Date(guess));
  offset = tzOffsetMs(new Date(guess - offset)); // تصحيح لحواف التوقيت الصيفي
  return new Date(guess - offset);
}

/**
 * قيمة خانة تاريخ ("YYYY-MM-DD") أو تاريخ ووقت ("YYYY-MM-DDTHH:MM")
 * => ISO، مقروءة بتوقيت المستودع.
 */
export function inputToIso(value) {
  const [datePart, timePart] = String(value || '').split('T');
  const [year, month, day] = String(datePart).split('-').map(Number);
  if (!year || !month || !day) throw new Error('تاريخ غير صالح');
  const [hour, minute] = String(timePart || '00:00').split(':').map(Number);
  return ammanToUtc(year, month, day, hour || 0, minute || 0).toISOString();
}

/** ISO => "YYYY-MM-DDTHH:MM" لخانة datetime-local بتوقيت المستودع */
export function toDateTimeInput(iso) {
  const p = ammanParts(new Date(iso));
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "YYYY-MM-DD" لسبت بداية الأسبوع الحالي بتوقيت المستودع */
export function weekStartString(date = new Date()) {
  const p = ammanParts(date);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 6 = السبت
  const back = (dow - 6 + 7) % 7;
  const start = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
}

export function toast(message, isError = false) {
  const box = document.getElementById('toasts');
  const el = h('div.toast', { class: isError ? 'err' : '' }, message);
  box.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3600);
  setTimeout(() => el.remove(), 4000);
}

/** نافذة منبثقة - بترجّع Promise بنتيجة الحفظ */
export function modal({ title, body, confirmText = 'حفظ', cancelText = 'إلغاء', onConfirm, wide = false }) {
  return new Promise((resolve) => {
    const content = h('div.modal', { style: wide ? 'width:min(880px,100%)' : '' });
    const bg = h('div.modal-bg', {
      onclick: (e) => { if (e.target === bg) close(null); },
    }, content);

    const close = (value) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    const confirmBtn = h('button.btn', {
      onclick: async () => {
        if (!onConfirm) return close(true);
        confirmBtn.disabled = true;
        try { const result = await onConfirm(content); if (result !== false) close(result ?? true); }
        catch (err) { toast(err.message, true); }
        finally { confirmBtn.disabled = false; }
      },
    }, confirmText);

    content.append(
      h('h3', {}, title),
      body,
      h('div.actions', {},
        confirmBtn,
        h('button.btn.ghost', { onclick: () => close(null) }, cancelText)),
    );
    document.body.append(bg);
    setTimeout(() => content.querySelector('input,select,textarea')?.focus(), 40);
  });
}

export function confirmDialog(message, confirmText = 'تأكيد') {
  return modal({ title: 'تأكيد', body: h('p', {}, message), confirmText });
}

/** جدول جاهز: columns = [{key, label, render, cls}] */
export function table(columns, rows, { empty = 'ما في بيانات', footer = null, rowClass = null } = {}) {
  if (!rows.length) return h('div.empty', {}, empty);
  const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.cls || '' }, c.label))));
  const tbody = h('tbody', {}, rows.map((row) => h('tr', { class: rowClass ? rowClass(row) : '' },
    columns.map((c) => {
      const value = c.render ? c.render(row) : row[c.key];
      return h('td', { class: c.cls || '' }, value instanceof Node ? value : (value ?? '—'));
    }))));
  const parts = [thead, tbody];
  if (footer) parts.push(h('tfoot', {}, footer));
  return h('div.table-wrap', {}, h('table', {}, parts));
}

/** تصدير جدول كملف CSV (بيفتح بإكسل عربي صح) */
export function downloadCsv(filename, headerRow, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headerRow, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const KIND_PILL = {
  supply: 'in', customer_out: 'out', customer_return: 'in',
  payment: 'pay', operator_out: 'out', operator_in: 'in',
};
export const METHOD_LABELS = { cash: 'نقدي', bank: 'تحويل بنكي', check: 'شيك' };
