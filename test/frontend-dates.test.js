'use strict';
/**
 * اختبار دوال التوقيت بالواجهة.
 * بنضبط توقيت الجهاز على نيويورك عمداً: كل النتائج لازم تضل بتوقيت
 * المستودع (عمّان). هيك بنمسك أي رجوع لقراءة التواريخ بتوقيت الجهاز.
 */
process.env.TZ = 'America/New_York';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ui.js وحدة ESM بدون استيرادات - بنحمّلها كـ data URL
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
const uiPromise = import(`data:text/javascript,${encodeURIComponent(source)}`);

test('قراءة تاريخ ووقت من خانة الإدخال بتوقيت المستودع مش الجهاز', async () => {
  const ui = await uiPromise;
  // ١٤ أيلول ٠٠:٣٠ بعمّان = ١٣ أيلول ٢١:٣٠ UTC
  assert.strictEqual(ui.inputToIso('2026-09-14T00:30'), '2026-09-13T21:30:00.000Z');
  // لو انقرأت بتوقيت نيويورك (UTC-4) بتطلع 2026-09-14T04:30:00.000Z
});

test('قراءة تاريخ بس = منتصف ليل عمّان', async () => {
  const ui = await uiPromise;
  assert.strictEqual(ui.inputToIso('2026-09-12'), '2026-09-11T21:00:00.000Z');
});

test('ذهاب وإياب: فتح نافذة التعديل والحفظ بدون تغيير ما بيزيح الحركة', async () => {
  const ui = await uiPromise;
  const original = '2026-09-13T21:30:00.000Z';
  const shown = ui.toDateTimeInput(original);      // اللي بيشوفه المستخدم
  const saved = ui.inputToIso(shown);              // اللي بينحفظ لما يضغط حفظ
  assert.strictEqual(saved, original, 'الحركة لازم تضل بنفس لحظتها بالضبط');
});

test('الذهاب والإياب ثابت على مدار اليوم كله', async () => {
  const ui = await uiPromise;
  for (let hour = 0; hour < 24; hour += 1) {
    const iso = new Date(Date.UTC(2026, 8, 13, hour, 15, 0)).toISOString();
    assert.strictEqual(ui.inputToIso(ui.toDateTimeInput(iso)), iso, `انزاح عند الساعة ${hour}`);
  }
});

test('بداية الأسبوع = السبت بتوقيت المستودع', async () => {
  const ui = await uiPromise;
  // الأحد ١٣ أيلول ٠٠:٣٠ بعمّان (لسا السبت بنيويورك) => السبت ١٢ أيلول
  assert.strictEqual(ui.weekStartString(new Date('2026-09-12T21:30:00.000Z')), '2026-09-12');
  // السبت نفسه بيرجّع نفسه
  assert.strictEqual(ui.weekStartString(new Date('2026-09-12T09:00:00.000Z')), '2026-09-12');
  // الجمعة => السبت اللي قبله
  assert.strictEqual(ui.weekStartString(new Date('2026-09-18T09:00:00.000Z')), '2026-09-12');
});

test('عرض المبالغ: الإشارة السالبة بتضل ملتصقة بالرقم', async () => {
  const ui = await uiPromise;
  const shown = ui.money(-82.5);
  assert.ok(shown.includes('-82.50'), `المتوقع يحتوي -82.50 وطلع: ${shown}`);
});

test('عرض الكميات حسب وحدة الصنف', async () => {
  const ui = await uiPromise;
  assert.ok(ui.qty(1.5, 'kg').includes('1.5'));
  assert.ok(ui.qty(0.25, 'kg').includes('250'));   // أقل من كيلو => غرام
  assert.ok(ui.qty(12, 'piece').includes('12'));
});
