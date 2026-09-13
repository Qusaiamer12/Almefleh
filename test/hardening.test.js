'use strict';
/** اختبارات التشديد: أمان، سلامة بيانات، تزامن، ودقّة مالية */
const test = require('node:test');
const assert = require('node:assert');

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  test('اختبارات التشديد (متخطّاة - حدّد TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}

process.env.DATABASE_URL = TEST_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-hardening';
process.env.CRED_KEY = 'test-cred-key-hardening';
process.env.APP_TIMEZONE = 'Asia/Amman';
process.env.BACKUP_ENABLED = 'false';
process.env.SEED_ADMIN_PASSWORD = 'Admin@1234';
process.env.SEED_DEFAULT_PASSWORD = 'Pass@1234';

const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const app = require('../src/app');
const { seed } = require('../scripts/seed');
const { migrate } = require('../src/lib/migrations');

let server;
let base;
const cookies = {};

async function call(user, method, url, body, extraHeaders = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookies[user] ? { Cookie: cookies[user] } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) cookies[user] = setCookie.map((c) => c.split(';')[0]).join('; ');
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

const login = (user, username, password) => call(user, 'POST', '/api/auth/login', { username, password });

test.before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db, { log: () => {} });
  await seed({ demo: false });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await login('admin', 'qusai', 'Admin@1234');
  await login('recorder', 'abood', 'Pass@1234');
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

// ================================================== الأمان
test('حد محاولات الدخول: الحساب بينقفل بعد ٥ محاولات فاشلة', async () => {
  await db.query("DELETE FROM login_attempts WHERE lower(username) = 'saad'");
  await db.query("UPDATE users SET locked_until = NULL WHERE username = 'saad'");

  const results = [];
  for (let i = 0; i < 6; i += 1) {
    results.push(await call('attacker', 'POST', '/api/auth/login', { username: 'saad', password: 'غلط' }));
  }
  assert.strictEqual(results[0].status, 401);
  assert.strictEqual(results[5].status, 429, 'المحاولة السادسة لازم تنرفض بقفل');

  // حتى كلمة السر الصح ما بتنفع وقت القفل
  const correct = await call('saad', 'POST', '/api/auth/login', { username: 'saad', password: 'Pass@1234' });
  assert.strictEqual(correct.status, 429);

  // الأدمن بيفك القفل
  const { rows } = await db.query("SELECT id FROM users WHERE username = 'saad'");
  const unlock = await call('admin', 'POST', `/api/users/${rows[0].id}/unlock`);
  assert.strictEqual(unlock.status, 200);

  const after = await call('saad', 'POST', '/api/auth/login', { username: 'saad', password: 'Pass@1234' });
  assert.strictEqual(after.status, 200, 'بعد فك القفل لازم يدخل عادي');
});

test('الدخول الناجح بيصفّر عدّاد المحاولات', async () => {
  await db.query("DELETE FROM login_attempts WHERE lower(username) = 'ammar'");
  for (let i = 0; i < 3; i += 1) {
    await call('x', 'POST', '/api/auth/login', { username: 'ammar', password: 'غلط' });
  }
  await login('ammar', 'ammar', 'Pass@1234');
  // بعد النجاح، ٣ محاولات فاشلة تانية ما بتقفل (العدّاد رجع صفر)
  for (let i = 0; i < 3; i += 1) {
    const res = await call('x', 'POST', '/api/auth/login', { username: 'ammar', password: 'غلط' });
    assert.strictEqual(res.status, 401);
  }
});

test('تغيير كلمة السر بينهي كل الجلسات القديمة', async () => {
  await login('islam', 'islam', 'Pass@1234');
  const before = await call('islam', 'GET', '/api/auth/me');
  assert.strictEqual(before.status, 200);

  // نسخة تانية من نفس الجلسة (زي جهاز تاني)
  cookies.islamOtherDevice = cookies.islam;

  // ملاحظة: كلمة السر لازم ما تحتوي اسم المستخدم (السياسة بترفض "Islam@2026")
  const changed = await call('islam', 'POST', '/api/auth/change-credentials', {
    current_password: 'Pass@1234', new_password: 'Zaytoun@2026',
  });
  assert.strictEqual(changed.status, 200);

  const oldSession = await call('islamOtherDevice', 'GET', '/api/auth/me');
  assert.strictEqual(oldSession.status, 401, 'الجهاز التاني لازم ينطرد');

  const newSession = await call('islam', 'GET', '/api/auth/me');
  assert.strictEqual(newSession.status, 200, 'الجهاز اللي غيّر الباسورد بيضل داخل');
});

test('إيقاف الحساب من الأدمن بينهي جلسته فوراً', async () => {
  await login('viewer', 'abublal', 'Pass@1234');
  assert.strictEqual((await call('viewer', 'GET', '/api/stock')).status, 200);

  const { rows } = await db.query("SELECT id FROM users WHERE username = 'abublal'");
  await call('admin', 'PATCH', `/api/users/${rows[0].id}`, { active: false });

  assert.strictEqual((await call('viewer', 'GET', '/api/stock')).status, 401);
  await call('admin', 'PATCH', `/api/users/${rows[0].id}`, { active: true });
});

test('سياسة كلمة السر بتترفض الكلمات الضعيفة', async () => {
  const weak = ['12345678', 'password1', 'abcdefgh', 'short1'];
  for (const password of weak) {
    const res = await call('admin', 'POST', '/api/users', {
      username: 'testuser', display_name: 'تجربة', role: 'viewer', password,
    });
    assert.strictEqual(res.status, 400, `لازم ترفض: ${password}`);
  }
});

test('رؤوس الأمان موجودة بكل رد', async () => {
  const res = await call('admin', 'GET', '/api/stock');
  assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('x-request-id'), 'لازم يكون في معرّف طلب');
});

test('نقطة الصحة مستثناة من حد الطلبات', async () => {
  // مراقبة UptimeRobot لازم ما تستهلك من حصة الطلبات
  const health = await call('admin', 'GET', '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.headers.get('x-ratelimit-remaining'), null,
    'نقطة الصحة لازم تتخطّى الحد قبل ما يتسجّل أي عدّاد');

  const ready = await call('admin', 'GET', '/api/health/ready');
  assert.strictEqual(ready.headers.get('x-ratelimit-remaining'), null);

  // باقي النقاط محسوبة عادي
  const stock = await call('admin', 'GET', '/api/stock');
  assert.ok(stock.headers.get('x-ratelimit-remaining'), 'باقي الطلبات لازم تنعدّ');
});

test('كشف الزبون بيحترم الفترة المطلوبة', async () => {
  await login('blal', 'blal', 'Pass@1234');
  // /api/statements بيحوّل الزبون لكشفه - والفترة لازم تضل مع التحويل
  const current = await call('blal', 'GET', '/api/statements?week=0');
  const previous = await call('blal', 'GET', '/api/statements?week=-1');
  assert.strictEqual(current.status, 200);
  assert.strictEqual(previous.status, 200);
  assert.strictEqual(current.data.period.offset, 0);
  assert.strictEqual(previous.data.period.offset, -1,
    'التحويل كان بيضيّع معامل الفترة ويرجّع الأسبوع الحالي دايماً');
  assert.notStrictEqual(previous.data.period.from, current.data.period.from);

  // وكمان الفترة المخصّصة
  const custom = await call('blal', 'GET', '/api/statements?from=2026-01-01&to=2026-01-07');
  assert.strictEqual(custom.data.period.type, 'custom');
});

test('طلب تعديل من موقع خارجي بينرفض', async () => {
  const res = await call('admin', 'POST', '/api/items',
    { name: 'صنف من موقع غريب', unit: 'piece' },
    { Origin: 'https://evil-site.example' });
  assert.strictEqual(res.status, 403);
});

test('الزبون ما بيشوف أرصدة المستودع بقائمة الأصناف', async () => {
  // صنف برصيد وسعر عشان يكون في شي يمكن يتسرّب
  const created = await call('admin', 'POST', '/api/items', {
    name: 'صنف سرّية ' + Date.now(), unit: 'piece', price: 9,
  });
  await call('admin', 'POST', '/api/transactions', {
    kind: 'supply', item_id: created.data.item.id, quantity: '40',
  });

  await login('blal', 'blal', 'Pass@1234');
  const { data } = await call('blal', 'GET', '/api/items');
  assert.ok(data.items.length > 0, 'لازم يكون في أصناف للاختبار');
  for (const item of data.items) {
    assert.strictEqual(item.quantity, undefined, `الزبون شاف كمية "${item.name}"`);
    assert.strictEqual(item.current_price, undefined, `الزبون شاف سعر "${item.name}"`);
  }
  // وعبود كمان ما بيشوف أرقام، بس بيعرف مين بدون سعر
  const recorder = await call('recorder', 'GET', '/api/items');
  assert.strictEqual(recorder.data.items[0].quantity, undefined);
  assert.ok('needs_price' in recorder.data.items[0], 'عبود لازم يعرف مين بدون سعر');
  // وقصي بيشوف كل شي
  const admin = await call('admin', 'GET', '/api/items');
  assert.notStrictEqual(admin.data.items[0].quantity, undefined);
});

test('معرّف غير صالح بالمسار بيرجّع خطأ واضح مش ٥٠٠', async () => {
  const cases = [
    ['GET', '/api/statements/abc'],
    ['GET', '/api/stock/xyz'],
    ['DELETE', '/api/transactions/-1'],
    ['PATCH', '/api/users/0'],
    ['POST', '/api/notifications/nope/read'],
  ];
  for (const [method, url] of cases) {
    const res = await call('admin', method, url, method === 'PATCH' ? { active: true } : undefined);
    assert.strictEqual(res.status, 400, `${method} ${url} رجّع ${res.status}`);
    assert.match(res.data.error, /غير صالح/);
  }
});

test('الدفعات للمدير بس - عبود ما إله فيها', async () => {
  const { rows: entity } = await db.query("SELECT id FROM entities WHERE name = 'بلال'");
  const { rows: item } = await db.query('SELECT id FROM items LIMIT 1');

  // تسجيل دفعة
  const create = await call('recorder', 'POST', '/api/transactions', {
    kind: 'payment', entity_id: entity[0].id, payment_amount: '50', method: 'cash',
  });
  assert.strictEqual(create.status, 403);
  assert.match(create.data.error, /المدير/);

  // وقصي بيقدر
  const byAdmin = await call('admin', 'POST', '/api/transactions', {
    kind: 'payment', entity_id: entity[0].id, payment_amount: '50', method: 'cash',
  });
  assert.strictEqual(byAdmin.status, 201);
  const paymentId = byAdmin.data.transaction.id;

  // ولا بيقدر يعدّل أو يحذف دفعة سجّلها قصي
  const edit = await call('recorder', 'PATCH', `/api/transactions/${paymentId}`, { note: 'تعديل' });
  assert.strictEqual(edit.status, 403);
  const remove = await call('recorder', 'DELETE', `/api/transactions/${paymentId}`);
  assert.strictEqual(remove.status, 403);

  // بس حركات البضاعة عادي
  const goods = await call('recorder', 'POST', '/api/transactions', {
    kind: 'supply', item_id: item[0].id, quantity: '5',
  });
  assert.strictEqual(goods.status, 201);
});

// ================================================== التحقق من المدخلات
test('الحقول غير المعروفة بتنرفض (مش بتنتجاهل)', async () => {
  const res = await call('admin', 'POST', '/api/items', {
    name: 'صنف', unit: 'piece', is_admin: true, prise: 100,
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.data.error, /غير معروفة/);
});

test('القيم خارج المدى بتنرفض برسالة واضحة', async () => {
  const { data: item } = await call('admin', 'POST', '/api/items', { name: 'صنف مدى', unit: 'piece' });
  const cases = [
    [{ price: -5 }, /السعر/],
    [{ price: 'كتير' }, /رقم/],
    [{ price: 10, effective_from: '2019-01-01' }, /المدى المنطقي/],
  ];
  for (const [body, pattern] of cases) {
    const res = await call('admin', 'POST', `/api/items/${item.item.id}/prices`, body);
    assert.strictEqual(res.status, 400);
    assert.match(res.data.error, pattern);
  }
});

test('تاريخ حركة بالمستقبل بينرفض', async () => {
  const { rows } = await db.query("SELECT id FROM items LIMIT 1");
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  const res = await call('admin', 'POST', '/api/transactions', {
    kind: 'supply', item_id: rows[0].id, quantity: '5', occurred_at: future,
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.data.error, /المستقبل/);
});

test('ملاحظة أطول من الحد بتنرفض', async () => {
  const { rows } = await db.query('SELECT id FROM items LIMIT 1');
  const res = await call('admin', 'POST', '/api/transactions', {
    kind: 'supply', item_id: rows[0].id, quantity: '1', note: 'ا'.repeat(600),
  });
  assert.strictEqual(res.status, 400);
});

// ================================================== سلامة البيانات بالقاعدة
test('سجل التدقيق ما بينعدّل ولا بينحذف - حتى من القاعدة مباشرة', async () => {
  await db.query(
    "INSERT INTO audit_log (username, action, table_name, summary) VALUES ('x','update','items','اختبار')",
  );
  await assert.rejects(
    () => db.query("UPDATE audit_log SET summary = 'تزوير' WHERE id = (SELECT max(id) FROM audit_log)"),
    /للإضافة فقط/,
  );
  await assert.rejects(
    () => db.query('DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log)'),
    /للإضافة فقط/,
  );
  await assert.rejects(() => db.query('TRUNCATE audit_log'), /للإضافة فقط/);
});

test('القاعدة بترفض حركة زبون على المشغل حتى لو تجاوزت الـ API', async () => {
  const { rows: operator } = await db.query("SELECT id FROM entities WHERE type = 'operator'");
  const { rows: item } = await db.query('SELECT id FROM items LIMIT 1');
  await assert.rejects(
    () => db.query(
      `INSERT INTO transactions (kind, entity_id, item_id, quantity) VALUES ('customer_out',$1,$2,1)`,
      [operator[0].id, item[0].id],
    ),
    /ما بتنسجّل على جهة داخلية/,
  );
});

test('القاعدة بتمنع الدوران بالمقادير', async () => {
  const a = await call('admin', 'POST', '/api/items', { name: 'دوران أ', unit: 'piece' });
  const b = await call('admin', 'POST', '/api/items', { name: 'دوران ب', unit: 'piece' });
  const idA = a.data.item.id;
  const idB = b.data.item.id;

  const first = await call('admin', 'PUT', `/api/items/${idA}/recipe`, {
    components: [{ component_item_id: idB, quantity_per_unit: 1 }],
  });
  assert.strictEqual(first.status, 200);

  // ب يستعمل أ => دوران
  const second = await call('admin', 'PUT', `/api/items/${idB}/recipe`, {
    components: [{ component_item_id: idA, quantity_per_unit: 1 }],
  });
  assert.strictEqual(second.status, 400);
  assert.match(second.data.error, /دوران/);
});

test('مكوّن مكرّر بالوصفة بينرفض', async () => {
  const { rows } = await db.query("SELECT id FROM items WHERE name = 'دوران أ'");
  const { rows: other } = await db.query("SELECT id FROM items WHERE name = 'دوران ب'");
  const res = await call('admin', 'PUT', `/api/items/${rows[0].id}/recipe`, {
    components: [
      { component_item_id: other[0].id, quantity_per_unit: 1 },
      { component_item_id: other[0].id, quantity_per_unit: 2 },
    ],
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.data.error, /مكرّر/);
});

// ================================================== الكتالوج والبحث
test('البحث بيتسامح مع الإملاء والمسافات والأسماء البديلة', async () => {
  // صنف بأسماء بديلة زي ما بالكتالوج الحقيقي
  await db.query(
    `INSERT INTO items (name, unit, base, size, size_unit, aliases)
     VALUES ('شطة 5ك', 'piece', 'شطة', 5, 'ك',
             ARRAY['شطة 5 كيلو', 'شطه 5ك', 'شطة5ك'])`,
  );
  await db.query(
    `INSERT INTO items (name, unit, base, size, size_unit) VALUES ('شطة 10ك', 'piece', 'شطة', 10, 'ك')`,
  );

  const cases = [
    ['شطه', 2, 'إملاء غلط (ه بدل ة) لازم يلاقي العائلة كاملة'],
    ['شطة5ك', 1, 'بلا مسافات'],
    ['شطه 5 كيلو', 1, 'اسم بديل بإملاء غلط'],
    ['شطة', 2, 'اسم العائلة'],
  ];
  for (const [term, expected, why] of cases) {
    const { data } = await call('admin', 'GET', `/api/items?search=${encodeURIComponent(term)}`);
    assert.strictEqual(data.items.length, expected, `"${term}" — ${why}`);
  }

  // بحث ما بيلاقي شي بيرجع فاضي مش كل الأصناف
  const none = await call('admin', 'GET', '/api/items?search=' + encodeURIComponent('صنف مش موجود ابدا'));
  assert.strictEqual(none.data.items.length, 0);
});

test('دقّة الفلس: السعر بـ٣ منازل ما بيتقرّب', async () => {
  const item = await call('admin', 'POST', '/api/items', {
    name: 'صنف فلس', unit: 'piece', price: 0.025,
  });
  const { rows } = await db.query(
    'SELECT price FROM item_prices WHERE item_id = $1', [item.data.item.id],
  );
  assert.strictEqual(Number(rows[0].price), 0.025, 'الدينار ألف فلس - ٠.٠٢٥ ما بتصير ٠.٠٣');

  // والمبلغ بالحركة كمان
  const { rows: entity } = await db.query("SELECT id FROM entities WHERE name = 'سعد'");
  const txn = await call('admin', 'POST', '/api/transactions', {
    kind: 'customer_out', entity_id: entity[0].id, item_id: item.data.item.id, quantity: '4',
  });
  assert.strictEqual(Number(txn.data.transaction.amount), 0.1); // 4 × 0.025

  // تنظيف: الاختبارات بتشارك نفس الزباين، فحركة باقية بتخرّب حسابات غيرها
  await call('admin', 'DELETE', `/api/transactions/${txn.data.transaction.id}`);
});

// ================================================== التزامن
test('طلبين متزامنين بنفس اسم الصنف: واحد بس بينجح', async () => {
  const name = 'صنف متزامن ' + Date.now();
  const results = await Promise.all([
    call('admin', 'POST', '/api/items', { name, unit: 'piece' }),
    call('admin', 'POST', '/api/items', { name, unit: 'piece' }),
    call('admin', 'POST', '/api/items', { name: ` ${name} `, unit: 'piece' }),
  ]);
  const created = results.filter((r) => r.status === 201);
  assert.strictEqual(created.length, 1, 'لازم ينضاف صنف واحد بس');
  assert.ok(results.every((r) => r.status === 201 || r.status === 409));
});

test('حذفين متزامنين لنفس الحركة: واحد بس بينفّذ', async () => {
  const { rows: item } = await db.query('SELECT id FROM items LIMIT 1');
  const created = await call('admin', 'POST', '/api/transactions', {
    kind: 'supply', item_id: item[0].id, quantity: '10',
  });
  const id = created.data.transaction.id;

  const results = await Promise.all([
    call('admin', 'DELETE', `/api/transactions/${id}`),
    call('admin', 'DELETE', `/api/transactions/${id}`),
  ]);
  const ok = results.filter((r) => r.status === 200);
  assert.strictEqual(ok.length, 1, 'حذف واحد بس بينجح');

  const { rows } = await db.query('SELECT deleted_at, deleted_by FROM transactions WHERE id = $1', [id]);
  assert.ok(rows[0].deleted_at);
});

test('قبولين متزامنين لنفس اقتراح السعر: السعر بينطبّق مرّة وحدة', async () => {
  const raw = await call('admin', 'POST', '/api/items', { name: 'خام تزامن', unit: 'piece', price: 10 });
  const product = await call('admin', 'POST', '/api/items', { name: 'منتج تزامن', unit: 'piece', price: 20 });
  await call('admin', 'PUT', `/api/items/${product.data.item.id}/recipe`, {
    components: [{ component_item_id: raw.data.item.id, quantity_per_unit: 1 }],
  });
  await call('admin', 'POST', `/api/items/${raw.data.item.id}/prices`, {
    price: 12, effective_from: new Date().toISOString(),
  });

  const { rows } = await db.query(
    "SELECT id FROM price_proposals WHERE parent_item_id = $1 AND status = 'pending'",
    [product.data.item.id],
  );
  assert.ok(rows[0], 'لازم يكون في اقتراح');

  const results = await Promise.all([
    call('admin', 'POST', `/api/proposals/${rows[0].id}/accept`, {}),
    call('admin', 'POST', `/api/proposals/${rows[0].id}/accept`, {}),
  ]);
  assert.strictEqual(results.filter((r) => r.status === 200).length, 1);
  assert.strictEqual(results.filter((r) => r.status === 409).length, 1);
});

// ================================================== منع الازدواج
test('دوسة مزدوجة على "تسجيل": الحركة بتنسجّل مرّة وحدة بس', async () => {
  const { rows: item } = await db.query('SELECT id FROM items LIMIT 1');
  const { rows: entity } = await db.query("SELECT id FROM entities WHERE name = 'عمار'");
  const token = 'tok' + Date.now() + 'abcdef';

  const body = {
    kind: 'customer_out', entity_id: entity[0].id, item_id: item[0].id,
    quantity: '7', client_token: token,
  };

  const first = await call('admin', 'POST', '/api/transactions', body);
  const second = await call('admin', 'POST', '/api/transactions', body);

  assert.strictEqual(first.status, 201);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.data.duplicate, true);
  assert.strictEqual(second.data.transaction.id, first.data.transaction.id, 'نفس الحركة مش وحدة جديدة');

  const { rows } = await db.query(
    'SELECT count(*)::int AS c FROM transactions WHERE client_token = $1 AND deleted_at IS NULL', [token],
  );
  assert.strictEqual(rows[0].c, 1);
});

test('طلبين متزامنين بنفس الرمز: حركة وحدة بس', async () => {
  const { rows: item } = await db.query('SELECT id FROM items LIMIT 1');
  const { rows: entity } = await db.query("SELECT id FROM entities WHERE name = 'عمار'");
  const token = 'race' + Date.now() + 'xyz';
  const body = {
    kind: 'customer_out', entity_id: entity[0].id, item_id: item[0].id,
    quantity: '3', client_token: token,
  };

  const results = await Promise.all([
    call('admin', 'POST', '/api/transactions', body),
    call('admin', 'POST', '/api/transactions', body),
    call('admin', 'POST', '/api/transactions', body),
  ]);
  assert.ok(results.every((r) => r.status === 200 || r.status === 201));

  const { rows } = await db.query(
    'SELECT count(*)::int AS c FROM transactions WHERE client_token = $1 AND deleted_at IS NULL', [token],
  );
  assert.strictEqual(rows[0].c, 1, 'لازم تنسجّل حركة وحدة بس مهما وصل طلبات متزامنة');
});

test('حركة انحذفت: بينفع تنسجّل من جديد بنفس الرمز', async () => {
  const { rows: item } = await db.query('SELECT id FROM items LIMIT 1');
  const token = 'redo' + Date.now() + 'abc';
  const body = { kind: 'supply', item_id: item[0].id, quantity: '5', client_token: token };

  const first = await call('admin', 'POST', '/api/transactions', body);
  await call('admin', 'DELETE', `/api/transactions/${first.data.transaction.id}`);

  const again = await call('admin', 'POST', '/api/transactions', body);
  assert.strictEqual(again.status, 201, 'بعد الحذف لازم ينفع يعيد التسجيل');
  assert.notStrictEqual(again.data.transaction.id, first.data.transaction.id);
});

// ================================================== الدقّة المالية
test('دقّة المبالغ: ١٠٠ حركة بسعر ٠.٠٧ = ٧.٠٠ بالضبط', async () => {
  const item = await call('admin', 'POST', '/api/items', {
    name: 'صنف دقّة', unit: 'piece', price: 0.07,
  });
  const { rows: entity } = await db.query("SELECT id FROM entities WHERE name = 'سعد'");

  for (let i = 0; i < 100; i += 1) {
    await call('admin', 'POST', '/api/transactions', {
      kind: 'customer_out', entity_id: entity[0].id, item_id: item.data.item.id, quantity: '1',
    });
  }

  const { data } = await call('admin', 'GET', `/api/statements/${entity[0].id}?week=0`);
  // 0.07 × 100 بحساب JS العشري بيطلع 7.000000000000001
  assert.strictEqual(Number(data.totals.withdrawals), 7);
  assert.strictEqual(Number(data.closing_balance), 7);
});

test('الرصيد الجاري بالكشف بيطابق الرصيد الختامي', async () => {
  const { rows: entity } = await db.query("SELECT id FROM entities WHERE name = 'سعد'");
  const { data } = await call('admin', 'GET', `/api/statements/${entity[0].id}?week=0`);
  const lastLine = data.lines[data.lines.length - 1];
  assert.strictEqual(Number(lastLine.running_balance), Number(data.closing_balance));
});

// ================================================== الترحيل والنسخ الاحتياطي
test('نظام الترحيل بيكشف أي تعديل على ترحيل مطبّق', async () => {
  await db.query(
    "UPDATE schema_migrations SET checksum = 'عبث' WHERE version = '001'",
  );
  await assert.rejects(() => migrate(db, { log: () => {} }), /تعدّل بعد ما انطبّق/);
  // نرجّع البصمة الصح
  const { loadMigrations } = require('../src/lib/migrations');
  const first = loadMigrations()[0];
  await db.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2',
    [first.checksum, first.version]);
});

test('دورة كاملة: نسخة احتياطية ← مسح ← استرجاع ← نفس الأرقام', async () => {
  const { runBackup } = require('../src/jobs/backup');
  const { restore } = require('../scripts/restore');

  const before = await call('admin', 'GET', '/api/statements');
  const beforeStock = await call('admin', 'GET', '/api/stock');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almefleh-backup-'));
  process.env.BACKUP_DIR = dir;
  const backup = await runBackup();
  assert.strictEqual(backup.verified, true);
  assert.ok(backup.checksum);

  // مسح كامل
  await db.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
  await db.query(`TRUNCATE transactions, item_prices, item_components, notifications,
                  price_proposals, customer_requests, audit_log, login_attempts,
                  users, items, entities RESTART IDENTITY CASCADE`);
  await db.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
  const { rows: empty } = await db.query('SELECT count(*)::int AS c FROM transactions');
  assert.strictEqual(empty[0].c, 0);

  await restore(backup.local_path, { dryRun: false, log: () => {} });

  const after = await call('admin', 'GET', '/api/statements');
  const afterStock = await call('admin', 'GET', '/api/stock');
  assert.deepStrictEqual(after.data.totals, before.data.totals, 'الأرصدة لازم ترجع زي ما كانت');
  assert.deepStrictEqual(afterStock.data.summary, beforeStock.data.summary, 'الستوك لازم يرجع زي ما كان');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('نسخة احتياطية تالفة بتنرفض وقت الاسترجاع', async () => {
  const { restore } = require('../scripts/restore');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almefleh-bad-'));
  const file = path.join(dir, 'bad.json');

  fs.writeFileSync(file, JSON.stringify({
    meta: { checksum: 'بصمة-غلط', row_counts: { users: 1 } },
    data: { users: [{ id: 1 }] },
  }));
  await assert.rejects(() => restore(file, { dryRun: true, log: () => {} }), /البصمة ما بتطابق/);

  fs.writeFileSync(file, '{ هذا مش JSON');
  await assert.rejects(() => restore(file, { dryRun: true, log: () => {} }), /مش JSON صالح/);

  fs.rmSync(dir, { recursive: true, force: true });
});
