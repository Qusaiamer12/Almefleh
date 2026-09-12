'use strict';
/**
 * اختبارات التكامل - بتشتغل على قاعدة بيانات اختبار حقيقية.
 * شغّلها هيك:  TEST_DATABASE_URL=postgresql://... npm test
 * ⚠ بتمسح محتويات القاعدة اللي بتشير إلها TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert');

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  test('اختبارات التكامل (متخطّاة - حدّد TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}

process.env.DATABASE_URL = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.CRED_KEY = 'test-cred-key';
process.env.APP_TIMEZONE = 'Asia/Amman';
process.env.BACKUP_ENABLED = 'false';
process.env.SEED_ADMIN_PASSWORD = 'Admin@1234';
process.env.SEED_DEFAULT_PASSWORD = 'Pass@1234';

const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const app = require('../src/app');
const { seed } = require('../scripts/seed');

let server;
let base;
const cookies = {};

/** نداء API مع كوكي المستخدم */
async function call(user, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookies[user] ? { Cookie: cookies[user] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) cookies[user] = setCookie.map((c) => c.split(';')[0]).join('; ');
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const login = (user, username, password) => call(user, 'POST', '/api/auth/login', { username, password });

test.before(async () => {
  // قاعدة نظيفة
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  await seed({ demo: false });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await login('admin', 'qusai', 'Admin@1234');
  await login('recorder', 'abood', 'Pass@1234');
  await login('viewer', 'abublal', 'Pass@1234');
  await login('blal', 'blal', 'Pass@1234');
  await login('islam', 'islam', 'Pass@1234');
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

// ---------------------------------------------------------------- الصلاحيات
test('الدخول بكلمة سر غلط بينرفض', async () => {
  const res = await call('x', 'POST', '/api/auth/login', { username: 'qusai', password: 'غلط' });
  assert.strictEqual(res.status, 401);
});

test('المسجّل (عبود) ما بيشوف ستوك ولا أرصدة ولا سجل تدقيق', async () => {
  assert.strictEqual((await call('recorder', 'GET', '/api/stock')).status, 403);
  assert.strictEqual((await call('recorder', 'GET', '/api/statements')).status, 403);
  assert.strictEqual((await call('recorder', 'GET', '/api/audit')).status, 403);
  assert.strictEqual((await call('recorder', 'GET', '/api/users')).status, 403);
});

test('الاطّلاع (أبو بلال) بيقرأ بس وما بيسجّل', async () => {
  assert.strictEqual((await call('viewer', 'GET', '/api/stock')).status, 200);
  const res = await call('viewer', 'POST', '/api/transactions', { kind: 'supply', item_id: 1, quantity: '5' });
  assert.strictEqual(res.status, 403);
});

test('الزبون بيشوف كشفه هو بس', async () => {
  const mine = await call('blal', 'GET', '/api/statements/1');
  assert.strictEqual(mine.status, 200);
  const other = await call('blal', 'GET', '/api/statements/2');
  assert.strictEqual(other.status, 403);
});

test('سجل التدقيق لقصي بس', async () => {
  assert.strictEqual((await call('admin', 'GET', '/api/audit')).status, 200);
  assert.strictEqual((await call('viewer', 'GET', '/api/audit')).status, 403);
  assert.strictEqual((await call('blal', 'GET', '/api/audit')).status, 403);
});

// ---------------------------------------------------------------- الستوك والأرصدة
test('دورة كاملة: توريد ← مشغل ← سحب زبون ← دفعة', async () => {
  const bucket = await call('admin', 'POST', '/api/items', { name: 'سطل زيتون', unit: 'piece', price: 25 });
  const jar = await call('admin', 'POST', '/api/items', { name: 'جاط زيتون', unit: 'piece', price: 3.5 });
  assert.strictEqual(bucket.status, 201);

  const bucketId = bucket.data.item.id;
  const jarId = jar.data.item.id;
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const operator = ents.entities.find((e) => e.type === 'operator').id;
  const blalId = ents.entities.find((e) => e.name === 'بلال').id;

  await call('recorder', 'POST', '/api/transactions', { kind: 'supply', item_id: bucketId, quantity: '100' });
  await call('recorder', 'POST', '/api/transactions', { kind: 'operator_out', entity_id: operator, item_id: bucketId, quantity: '20' });
  await call('recorder', 'POST', '/api/transactions', { kind: 'operator_in', entity_id: operator, item_id: jarId, quantity: '180' });
  await call('recorder', 'POST', '/api/transactions', { kind: 'customer_out', entity_id: blalId, item_id: jarId, quantity: '50' });
  await call('recorder', 'POST', '/api/transactions', { kind: 'payment', entity_id: blalId, payment_amount: '100', method: 'cash' });

  const { data: stock } = await call('admin', 'GET', '/api/stock');
  const bucketRow = stock.items.find((i) => i.item_id === bucketId);
  const jarRow = stock.items.find((i) => i.item_id === jarId);
  assert.strictEqual(Number(bucketRow.quantity), 80);   // 100 - 20
  assert.strictEqual(Number(jarRow.quantity), 130);     // 180 - 50

  const { data: statements } = await call('admin', 'GET', '/api/statements');
  const blal = statements.customers.find((c) => c.entity_id === blalId);
  assert.strictEqual(Number(blal.balance), 75);         // 50×3.5 - 100
});

test('حساب المشغل كمّي فقط - بدون أي دين', async () => {
  const { data } = await call('admin', 'GET', '/api/statements');
  assert.ok(!data.customers.some((c) => c.type === 'operator'));
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const operatorId = ents.entities.find((e) => e.type === 'operator').id;
  const { data: st } = await call('admin', 'GET', `/api/statements/${operatorId}`);
  assert.strictEqual(Number(st.closing_balance), 0);
  assert.strictEqual(st.financial, false);
});

test('تعديل حركة قديمة بيعيد حساب الرصيد رجوعاً', async () => {
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const blalId = ents.entities.find((e) => e.name === 'بلال').id;
  const { data: list } = await call('admin', 'GET', `/api/transactions?entity_id=${blalId}&kind=customer_out`);
  const txn = list.transactions[0];

  await call('admin', 'PATCH', `/api/transactions/${txn.id}`, { quantity: '60' });
  const { data: after } = await call('admin', 'GET', '/api/statements');
  assert.strictEqual(Number(after.customers.find((c) => c.entity_id === blalId).balance), 110); // 60×3.5-100
});

test('حذف حركة بينزّل المبلغ من الدين فوراً', async () => {
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const blalId = ents.entities.find((e) => e.name === 'بلال').id;
  const { data: list } = await call('admin', 'GET', `/api/transactions?entity_id=${blalId}&kind=customer_out`);
  const txn = list.transactions[0];

  await call('admin', 'DELETE', `/api/transactions/${txn.id}`);
  const { data: after } = await call('admin', 'GET', '/api/statements');
  assert.strictEqual(Number(after.customers.find((c) => c.entity_id === blalId).balance), -100); // بقيت الدفعة بس
});

test('تنبيه واضح لما الكمية أكتر من المتوفر', async () => {
  const { data: item } = await call('admin', 'POST', '/api/items', { name: 'صنف نادر', unit: 'piece', price: 5 });
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const saad = ents.entities.find((e) => e.name === 'سعد').id;

  const res = await call('recorder', 'POST', '/api/transactions', {
    kind: 'customer_out', entity_id: saad, item_id: item.item.id, quantity: '3',
  });
  assert.strictEqual(res.status, 201);            // العملية ما بتتمنع
  assert.strictEqual(res.data.warnings.length, 1); // بس بيطلع تنبيه
  // المسجّل ما بيشوف رقم الستوك بالتنبيه
  assert.strictEqual(res.data.warnings[0].quantity, undefined);
});

// ---------------------------------------------------------------- الأسعار
test('صنف بدون سعر: الحركة بتضل معلّقة لحد ما يتحدّد السعر', async () => {
  const { data: created } = await call('recorder', 'POST', '/api/items', { name: 'جاط مكدوس', unit: 'piece' });
  const itemId = created.item.id;
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const ammar = ents.entities.find((e) => e.name === 'عمار').id;

  await call('recorder', 'POST', '/api/transactions', {
    kind: 'customer_out', entity_id: ammar, item_id: itemId, quantity: '25',
  });

  const pending = await call('admin', 'GET', '/api/transactions?pending_price=true');
  assert.strictEqual(pending.data.transactions.length, 1);
  assert.strictEqual(pending.data.transactions[0].amount, null);

  // قصي بيحدّد السعر
  await call('admin', 'POST', `/api/items/${itemId}/prices`, {
    price: 4, effective_from: new Date(Date.now() - 86400000).toISOString(),
  });

  const after = await call('admin', 'GET', `/api/transactions?entity_id=${ammar}`);
  const line = after.data.transactions.find((t) => t.item_id === itemId);
  assert.strictEqual(Number(line.amount), 100);      // 25 × 4
  assert.strictEqual(line.price_pending, false);
});

test('تاريخ سريان السعر: الحركات القديمة بتضل بسعرها القديم', async () => {
  const { data: created } = await call('admin', 'POST', '/api/items', {
    name: 'زيت زيتون', unit: 'kg', price: 6,
    effective_from: new Date('2026-01-01T00:00:00Z').toISOString(),
  });
  const itemId = created.item.id;
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const saad = ents.entities.find((e) => e.name === 'سعد').id;

  // حركة قديمة بسعر 6
  await call('admin', 'POST', '/api/transactions', {
    kind: 'customer_out', entity_id: saad, item_id: itemId, quantity: '١٠ك',
    occurred_at: new Date('2026-03-01T10:00:00Z').toISOString(),
  });
  // سعر جديد بيسري من حزيران
  await call('admin', 'POST', `/api/items/${itemId}/prices`, {
    price: 9, effective_from: new Date('2026-06-01T00:00:00Z').toISOString(),
  });
  // حركة جديدة بالسعر الجديد
  await call('admin', 'POST', '/api/transactions', {
    kind: 'customer_out', entity_id: saad, item_id: itemId, quantity: '٥٠٠غ',
    occurred_at: new Date('2026-07-01T10:00:00Z').toISOString(),
  });

  const { data } = await call('admin', 'GET', `/api/transactions?entity_id=${saad}&item_id=${itemId}`);
  const older = data.transactions.find((t) => t.occurred_at.startsWith('2026-03'));
  const newer = data.transactions.find((t) => t.occurred_at.startsWith('2026-07'));
  assert.strictEqual(Number(older.unit_price), 6);
  assert.strictEqual(Number(older.amount), 60);      // 10 كغم × 6
  assert.strictEqual(Number(newer.unit_price), 9);
  assert.strictEqual(Number(newer.amount), 4.5);     // 0.5 كغم × 9
});

test('تغيير سعر مكوّن بيقترح سعر جديد بيحافظ على هامش الربح', async () => {
  const { data: items } = await call('admin', 'GET', '/api/items');
  const bucket = items.items.find((i) => i.name === 'سطل زيتون');
  const jar = items.items.find((i) => i.name === 'جاط زيتون');

  // الوصفة: كل جاط بده 0.1 سطل
  await call('admin', 'PUT', `/api/items/${jar.id}/recipe`, {
    components: [{ component_item_id: bucket.id, quantity_per_unit: 0.1 }],
  });

  // سعر السطل من 25 لـ 30 => التكلفة من 2.5 لـ 3، والسعر 3.5 => 4.2
  const res = await call('admin', 'POST', `/api/items/${bucket.id}/prices`, {
    price: 30, effective_from: new Date().toISOString(),
  });
  assert.strictEqual(res.data.proposals.length, 1);
  const proposal = res.data.proposals[0];
  assert.strictEqual(Number(proposal.cost_price), 3);
  assert.strictEqual(Number(proposal.suggested_price), 4.2);

  // التنبيه بيوصل قصي بس
  const adminNotifs = await call('admin', 'GET', '/api/notifications');
  assert.ok(adminNotifs.data.notifications.some((n) => n.type === 'price_change'));
});

test('التنبيهات ما بتوصل أبو بلال ولا بلال', async () => {
  const viewer = await call('viewer', 'GET', '/api/notifications');
  const blal = await call('blal', 'GET', '/api/notifications');
  assert.strictEqual(viewer.data.notifications.length, 0);
  assert.strictEqual(blal.data.notifications.length, 0);
  const islam = await call('islam', 'GET', '/api/notifications');
  assert.ok(islam.data.notifications.length > 0);
});

// ---------------------------------------------------------------- الفاقد
test('تقرير الفاقد: المتوقّع حسب الوصفة مقابل الفعلي', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());
  const { data } = await call('admin', 'GET', `/api/reports/loss?from=${today}&to=${today}`);
  const jar = data.production.find((p) => p.item_name === 'جاط زيتون');

  // طلع 20 سطل، الوصفة 0.1 سطل للجاط => المتوقّع 200 جاط، رجع 180 => فاقد 20
  assert.strictEqual(Number(jar.actual_output), 180);
  assert.strictEqual(Number(jar.expected_output), 200);
  assert.strictEqual(Number(jar.loss_units), 20);
  assert.strictEqual(Number(jar.loss_percent), 10);

  const bucket = data.components.find((c) => c.item_name === 'سطل زيتون');
  assert.strictEqual(Number(bucket.issued), 20);
  assert.strictEqual(Number(bucket.required), 18);   // 180 × 0.1
  assert.strictEqual(Number(bucket.difference), 2);
});

// ---------------------------------------------------------------- الكشف الأسبوعي
test('الكشف الأسبوعي: افتتاحي + حركات + ختامي', async () => {
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const islamId = ents.entities.find((e) => e.name === 'إسلام').id;
  const { data: items } = await call('admin', 'GET', '/api/items');
  const jar = items.items.find((i) => i.name === 'جاط زيتون');

  await call('admin', 'POST', '/api/transactions', { kind: 'customer_out', entity_id: islamId, item_id: jar.id, quantity: '10' });
  await call('admin', 'POST', '/api/transactions', { kind: 'payment', entity_id: islamId, payment_amount: '15', method: 'check' });

  const { data } = await call('admin', 'GET', `/api/statements/${islamId}?week=0`);
  assert.strictEqual(Number(data.opening_balance), 0);
  assert.strictEqual(Number(data.totals.withdrawals), 35);   // 10 × 3.5
  assert.strictEqual(Number(data.totals.payments), 15);
  assert.strictEqual(Number(data.closing_balance), 20);
  // الرصيد الجاري بيتراكم سطر بسطر
  assert.strictEqual(Number(data.lines[data.lines.length - 1].running_balance), 20);
});

test('طريقة الدفع إلزامية مع كل دفعة', async () => {
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const saad = ents.entities.find((e) => e.name === 'سعد').id;
  const res = await call('admin', 'POST', '/api/transactions', {
    kind: 'payment', entity_id: saad, payment_amount: '50',
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.data.error, /طريقة الدفع/);
});

test('حركات الزباين ما بتنسجّل على المشغل والعكس', async () => {
  const { data: ents } = await call('admin', 'GET', '/api/users/entities');
  const operator = ents.entities.find((e) => e.type === 'operator').id;
  const blal = ents.entities.find((e) => e.name === 'بلال').id;
  const { data: items } = await call('admin', 'GET', '/api/items');
  const jar = items.items.find((i) => i.name === 'جاط زيتون');

  const bad1 = await call('admin', 'POST', '/api/transactions', {
    kind: 'customer_out', entity_id: operator, item_id: jar.id, quantity: '1',
  });
  assert.strictEqual(bad1.status, 400);

  const bad2 = await call('admin', 'POST', '/api/transactions', {
    kind: 'operator_out', entity_id: blal, item_id: jar.id, quantity: '1',
  });
  assert.strictEqual(bad2.status, 400);
});

// ---------------------------------------------------------------- سجل التدقيق
test('سجل التدقيق بيحفظ القيم قبل وبعد', async () => {
  const { data } = await call('admin', 'GET', '/api/audit?table=transactions&action=update');
  assert.ok(data.entries.length > 0);
  const entry = data.entries.find((e) => e.before_data && e.after_data);
  assert.ok(entry, 'لازم يكون في قيد فيه قبل وبعد');
  assert.notDeepStrictEqual(entry.before_data.quantity, entry.after_data.quantity);
});

test('الحذف بينسجّل بسجل التدقيق', async () => {
  const { data } = await call('admin', 'GET', '/api/audit?action=delete');
  assert.ok(data.entries.length > 0);
  assert.ok(data.entries[0].summary.includes('حذف'));
});

// ---------------------------------------------------------------- الحسابات
test('كل حساب بيغيّر كلمة سره، وقصي بيشوف بيانات الكل', async () => {
  const changed = await call('islam', 'POST', '/api/auth/change-credentials', {
    current_password: 'Pass@1234', new_password: 'NewPass@99',
  });
  assert.strictEqual(changed.status, 200);

  const relogin = await call('islam2', 'POST', '/api/auth/login', { username: 'islam', password: 'NewPass@99' });
  assert.strictEqual(relogin.status, 200);

  const { data } = await call('admin', 'GET', '/api/users');
  const islam = data.users.find((u) => u.username === 'islam');
  assert.strictEqual(islam.password, 'NewPass@99'); // قصي شايف كلمة السر الجديدة
});

test('ما بينفع يضل النظام بلا أدمن فعّال', async () => {
  const { data } = await call('admin', 'GET', '/api/users');
  const admin = data.users.find((u) => u.role === 'admin');
  const res = await call('admin', 'PATCH', `/api/users/${admin.id}`, { active: false });
  assert.strictEqual(res.status, 400);
});

test('طلب الزبون بيوصل الأدمن كتنبيه', async () => {
  const res = await call('blal', 'POST', '/api/requests', { body: 'بدي كشف حساب الشهر' });
  assert.strictEqual(res.status, 201);
  const { data } = await call('admin', 'GET', '/api/requests?open_only=true');
  assert.ok(data.requests.some((r) => r.body.includes('كشف حساب الشهر')));
  const notifs = await call('admin', 'GET', '/api/notifications');
  assert.ok(notifs.data.notifications.some((n) => n.type === 'customer_request'));
});
