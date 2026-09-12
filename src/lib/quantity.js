'use strict';
/**
 * تحليل الكمية المكتوبة بصيغة مختصرة.
 * بيقبل أرقام عربية وإنجليزية، وبيفهم لواحق الوزن:
 *   ك / كغ / كج / كيلو / kg / k   => كيلو غرام
 *   غ / غم / جم / غرام / g / gr   => غرام
 * أمثلة: "١٠ك" = 10 كغم | "٥٠٠غ" = 0.5 كغم | "١ك٥٠٠غ" = 1.5 كغم | "١٢" = 12
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC = '۰۱۲۳۴۵۶۷۸۹';

/** تحويل الأرقام العربية لأرقام لاتينية + توحيد الفاصلة العشرية */
function normalizeDigits(input) {
  let out = '';
  for (const ch of String(input)) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const ei = EASTERN_ARABIC.indexOf(ch);
    if (ei >= 0) { out += String(ei); continue; }
    if (ch === '٫' || ch === '،' || ch === ',') { out += '.'; continue; } // فاصلة عشرية
    if (ch === '٬' || ch === '_') { continue; }                          // فاصل آلاف
    out += ch;
  }
  return out;
}

const KG_SUFFIXES = ['كيلوغرام', 'كيلوجرام', 'كيلو', 'كغم', 'كجم', 'كغ', 'كج', 'ك', 'kgm', 'kg', 'k'];
const G_SUFFIXES  = ['غرامات', 'جرامات', 'غرام', 'جرام', 'غم', 'جم', 'غ', 'ج', 'gm', 'gr', 'g'];

/** بيرجّع {unit, length} لأطول لاحقة مطابقة ببداية النص */
function matchSuffix(text) {
  for (const s of KG_SUFFIXES) if (text.startsWith(s)) return { unit: 'kg', length: s.length };
  for (const s of G_SUFFIXES)  if (text.startsWith(s)) return { unit: 'g',  length: s.length };
  return null;
}

class QuantityError extends Error {
  constructor(message) { super(message); this.name = 'QuantityError'; this.status = 400; }
}

/**
 * @param {string|number} input  النص المكتوب
 * @param {'piece'|'kg'} itemUnit  وحدة الصنف الأساسية
 * @returns {{value:number, raw:string, hadUnit:boolean}} value بوحدة الصنف الأساسية
 */
function parseQuantity(input, itemUnit = 'piece') {
  const raw = String(input ?? '').trim();
  if (!raw) throw new QuantityError('الكمية مطلوبة');

  const text = normalizeDigits(raw).replace(/\s+/g, '').toLowerCase();
  if (!/[0-9]/.test(text)) throw new QuantityError(`كمية غير مفهومة: "${raw}"`);

  // تقسيم النص لمقاطع: رقم + لاحقة اختيارية (مثل "1ك500غ")
  const segments = [];
  let i = 0;
  while (i < text.length) {
    const numMatch = /^[0-9]+(?:\.[0-9]+)?/.exec(text.slice(i));
    if (!numMatch) throw new QuantityError(`كمية غير مفهومة: "${raw}"`);
    const number = parseFloat(numMatch[0]);
    i += numMatch[0].length;

    let unit = null;
    const suffix = matchSuffix(text.slice(i));
    if (suffix) { unit = suffix.unit; i += suffix.length; }

    segments.push({ number, unit });
    // فواصل مسموحة بين المقاطع
    while (i < text.length && ('+-و'.includes(text[i]))) i += 1;
  }

  const hadUnit = segments.some((s) => s.unit !== null);

  if (itemUnit === 'piece') {
    if (hadUnit) {
      throw new QuantityError('هذا الصنف بالعدد، ما بينفع تكتب وحدة وزن (ك / غ)');
    }
    if (segments.length > 1) throw new QuantityError(`كمية غير مفهومة: "${raw}"`);
    const value = segments[0].number;
    if (!(value > 0)) throw new QuantityError('الكمية لازم تكون أكبر من صفر');
    return { value: round(value, 3), raw, hadUnit: false };
  }

  // صنف بالوزن: القيمة النهائية بالكيلو
  let total = 0;
  for (const seg of segments) {
    const unit = seg.unit || 'kg'; // بدون لاحقة = كيلو (الوحدة الأساسية)
    total += unit === 'g' ? seg.number / 1000 : seg.number;
  }
  if (!(total > 0)) throw new QuantityError('الكمية لازم تكون أكبر من صفر');
  return { value: round(total, 3), raw, hadUnit };
}

/** تحليل مبلغ مالي (بيقبل أرقام عربية كمان) */
function parseAmount(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new QuantityError('المبلغ مطلوب');
  const text = normalizeDigits(raw).replace(/[\s]/g, '');
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) throw new QuantityError(`مبلغ غير مفهوم: "${raw}"`);
  const value = parseFloat(text);
  if (!(value > 0)) throw new QuantityError('المبلغ لازم يكون أكبر من صفر');
  return round(value, 2);
}

function round(n, digits) {
  const f = Math.pow(10, digits);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** عرض الكمية بصيغة مقروءة حسب وحدة الصنف */
function formatQuantity(value, itemUnit = 'piece') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (itemUnit === 'kg') {
    if (Math.abs(n) < 1 && n !== 0) return `${round(n * 1000, 0)} غم`;
    return `${trimZeros(n.toFixed(3))} كغم`;
  }
  return trimZeros(n.toFixed(3));
}

function trimZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

module.exports = { parseQuantity, parseAmount, formatQuantity, normalizeDigits, round, QuantityError };
