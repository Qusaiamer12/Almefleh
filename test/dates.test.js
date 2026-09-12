'use strict';
process.env.APP_TIMEZONE = 'Asia/Amman';
const test = require('node:test');
const assert = require('node:assert');
const dates = require('../src/lib/dates');
const { resolvePeriod } = require('../src/lib/period');

/** السبت بتوقيت عمّان */
const SATURDAY = new Date('2026-09-12T09:00:00Z');
const WEDNESDAY = new Date('2026-09-16T20:00:00Z');

test('الأسبوع بيبلّش يوم السبت', () => {
  const week = dates.weekRange(SATURDAY);
  assert.strictEqual(dates.toDateString(week.from), '2026-09-12');
  assert.strictEqual(dates.zonedParts(week.from).dow, 6); // السبت
  assert.strictEqual(dates.zonedParts(week.from).hour, 0);
});

test('يوم بنص الأسبوع بيرجع لسبت نفس الأسبوع', () => {
  const week = dates.weekRange(WEDNESDAY);
  assert.strictEqual(dates.toDateString(week.from), '2026-09-12');
  assert.strictEqual(dates.toDateString(new Date(week.to.getTime() - 1)), '2026-09-18');
});

test('الأسبوع السابق', () => {
  const week = dates.weekRangeOffset(-1, WEDNESDAY);
  assert.strictEqual(dates.toDateString(week.from), '2026-09-05');
});

test('حدود الأسبوع بتوقيت عمّان مش UTC', () => {
  const week = dates.weekRange(SATURDAY);
  // السبت 00:00 بعمّان = الجمعة 21:00 UTC (فرق +3)
  assert.strictEqual(week.from.toISOString(), '2026-09-11T21:00:00.000Z');
});

test('فترة مخصّصة شاملة اليوم الأخير', () => {
  const range = dates.customRange('2026-09-01', '2026-09-05');
  assert.strictEqual(dates.toDateString(range.from), '2026-09-01');
  assert.strictEqual(dates.toDateString(new Date(range.to.getTime() - 1)), '2026-09-05');
});

test('رفض التواريخ المقلوبة أو الخاطئة', () => {
  assert.throws(() => dates.customRange('2026-09-10', '2026-09-01'), /بعد تاريخ البداية/);
  assert.throws(() => dates.customRange('غلط', '2026-09-01'), /YYYY-MM-DD/);
});

test('resolvePeriod بيدعم الأسبوع والفترة المخصّصة', () => {
  const week = resolvePeriod({ week: 0 });
  assert.strictEqual(week.type, 'week');
  assert.strictEqual(dates.zonedParts(week.from).dow, 6);

  const custom = resolvePeriod({ from: '2026-09-01', to: '2026-09-05' });
  assert.strictEqual(custom.type, 'custom');
});
