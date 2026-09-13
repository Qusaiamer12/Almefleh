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
  return `${ltr(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} ${state.currency}`;
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
