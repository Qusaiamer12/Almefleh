'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseQuantity, parseAmount, formatQuantity, normalizeDigits } = require('../src/lib/quantity');

test('تحويل الأرقام العربية للاتينية', () => {
  assert.strictEqual(normalizeDigits('١٢٣٤٥'), '12345');
  assert.strictEqual(normalizeDigits('١٠٫٥'), '10.5');
  assert.strictEqual(normalizeDigits('٢٬٥٠٠'), '2500');
});

test('كمية بالعدد', () => {
  assert.strictEqual(parseQuantity('12', 'piece').value, 12);
  assert.strictEqual(parseQuantity('١٢', 'piece').value, 12);
  assert.strictEqual(parseQuantity(' ٢٥ ', 'piece').value, 25);
});

test('كمية بالوزن: ك = كيلو، غ = غرام', () => {
  assert.strictEqual(parseQuantity('١٠ك', 'kg').value, 10);
  assert.strictEqual(parseQuantity('10kg', 'kg').value, 10);
  assert.strictEqual(parseQuantity('٥٠٠غ', 'kg').value, 0.5);
  assert.strictEqual(parseQuantity('500g', 'kg').value, 0.5);
  assert.strictEqual(parseQuantity('٢٫٥ك', 'kg').value, 2.5);
});

test('كمية مركّبة: ١ك٥٠٠غ = 1.5 كغم', () => {
  assert.strictEqual(parseQuantity('١ك٥٠٠غ', 'kg').value, 1.5);
  assert.strictEqual(parseQuantity('2ك250غ', 'kg').value, 2.25);
});

test('بدون لاحقة على صنف وزن = كيلو', () => {
  assert.strictEqual(parseQuantity('8', 'kg').value, 8);
});

test('النص الأصلي بينحفظ زي ما هو', () => {
  assert.strictEqual(parseQuantity('١٠ك', 'kg').raw, '١٠ك');
});

test('رفض وحدة وزن على صنف بالعدد', () => {
  assert.throws(() => parseQuantity('١٠ك', 'piece'), /بالعدد/);
});

test('رفض الكميات غير الصالحة', () => {
  assert.throws(() => parseQuantity('', 'piece'), /مطلوبة/);
  assert.throws(() => parseQuantity('abc', 'piece'), /غير مفهومة/);
  assert.throws(() => parseQuantity('0', 'piece'), /أكبر من صفر/);
});

test('تحليل المبالغ', () => {
  assert.strictEqual(parseAmount('١٠٠'), 100);
  assert.strictEqual(parseAmount('99.50'), 99.5);
  assert.throws(() => parseAmount('-5'), /غير مفهوم/);
});

test('عرض الكميات', () => {
  assert.strictEqual(formatQuantity(1.5, 'kg'), '1.5 كغم');
  assert.strictEqual(formatQuantity(0.25, 'kg'), '250 غم');
  assert.strictEqual(formatQuantity(12, 'piece'), '12');
});
