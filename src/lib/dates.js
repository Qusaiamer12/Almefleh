'use strict';
/**
 * تواريخ النظام بتوقيت المستودع (افتراضياً Asia/Amman).
 * الأسبوع بيبلّش يوم السبت.
 */

const TZ = process.env.APP_TIMEZONE || 'Asia/Amman';
const WEEK_START_DOW = 6; // 0=الأحد ... 6=السبت

const DOW_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** أجزاء التاريخ حسب توقيت المستودع */
function zonedParts(date = new Date()) {
  const parts = {};
  for (const p of partsFormatter.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour % 24,
    minute: +parts.minute,
    second: +parts.second,
    dow: WEEKDAY_INDEX[parts.weekday],
  };
}

/** فرق التوقيت بالمللي ثانية بين TZ و UTC عند لحظة معيّنة */
function tzOffsetMs(date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** تحويل وقت محلي (بتوقيت المستودع) للحظة UTC */
function zonedToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = tzOffsetMs(new Date(guess));
  let result = new Date(guess - offset);
  offset = tzOffsetMs(result); // تصحيح إضافي لحواف التوقيت الصيفي
  return new Date(guess - offset);
}

/** بداية اليوم (00:00:00 بتوقيت المستودع) */
function startOfDay(date = new Date()) {
  const p = zonedParts(date);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, 0);
}

function addDays(date, days) {
  const p = zonedParts(date);
  return zonedToUtc(p.year, p.month, p.day + days, 0, 0, 0);
}

/** بداية الأسبوع (السبت 00:00) اللي بيقع فيه التاريخ */
function startOfWeek(date = new Date()) {
  const p = zonedParts(date);
  const back = (p.dow - WEEK_START_DOW + 7) % 7;
  return zonedToUtc(p.year, p.month, p.day - back, 0, 0, 0);
}

/** مدى الأسبوع: [from, to) */
function weekRange(date = new Date()) {
  const from = startOfWeek(date);
  const to = addDays(from, 7);
  return { from, to };
}

/** مدى أسبوع مُزاح: offset=0 الأسبوع الحالي، -1 اللي قبله */
function weekRangeOffset(offset = 0, date = new Date()) {
  const base = startOfWeek(date);
  const from = addDays(base, offset * 7);
  return { from, to: addDays(from, 7) };
}

/**
 * مدى مخصّص من نص "YYYY-MM-DD" لنص "YYYY-MM-DD" (شامل اليوم الأخير).
 */
function customRange(fromStr, toStr) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  };
  const a = parse(fromStr);
  const b = parse(toStr);
  if (!a || !b) {
    const err = new Error('صيغة التاريخ لازم تكون YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  const from = zonedToUtc(a.y, a.m, a.d, 0, 0, 0);
  const to = zonedToUtc(b.y, b.m, b.d + 1, 0, 0, 0); // شامل اليوم الأخير
  if (to <= from) {
    const err = new Error('تاريخ النهاية لازم يكون بعد تاريخ البداية');
    err.status = 400;
    throw err;
  }
  return { from, to };
}

/** "YYYY-MM-DD" بتوقيت المستودع */
function toDateString(date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** عرض عربي: "السبت ٢٠٢٦-٠٩-١٢ ١٤:٣٠" بأرقام لاتينية */
function formatDateTime(date) {
  const p = zonedParts(date);
  return `${DOW_NAMES[p.dow]} ${toDateString(date)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

module.exports = {
  TZ, WEEK_START_DOW, DOW_NAMES,
  zonedParts, zonedToUtc, startOfDay, addDays,
  startOfWeek, weekRange, weekRangeOffset, customRange, toDateString, formatDateTime,
};
