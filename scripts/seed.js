'use strict';
/**
 * تهيئة النظام: الجهات + الحسابات الأساسية.
 *   node scripts/seed.js           => الجهات والحسابات بس
 *   node scripts/seed.js --demo    => + أصناف وحركات تجريبية
 */
const db = require('../src/db');
const config = require('../src/config');
const { hashPassword, encryptSecret } = require('../src/lib/crypto');

const ENTITIES = [
  { name: 'بلال', type: 'customer', has_financials: true },
  { name: 'إسلام', type: 'customer', has_financials: true },
  { name: 'عمار', type: 'customer', has_financials: true },
  { name: 'سعد', type: 'customer', has_financials: true },
  { name: 'المشغل', type: 'operator', has_financials: false },
];

// notifications_on = false لأبو بلال وبلال حسب المتطلّبات
const USERS = [
  { username: 'qusai',   display_name: 'قصي',      role: 'admin',    entity: null,   notifications_on: true,  password: () => config.seedAdminPassword },
  { username: 'abood',   display_name: 'عبود',     role: 'recorder', entity: null,   notifications_on: true },
  { username: 'abublal', display_name: 'أبو بلال', role: 'viewer',   entity: null,   notifications_on: false },
  { username: 'blal',    display_name: 'بلال',     role: 'customer', entity: 'بلال',  notifications_on: false },
  { username: 'islam',   display_name: 'إسلام',    role: 'customer', entity: 'إسلام', notifications_on: true },
  { username: 'ammar',   display_name: 'عمار',     role: 'customer', entity: 'عمار',  notifications_on: true },
  { username: 'saad',    display_name: 'سعد',      role: 'customer', entity: 'سعد',   notifications_on: true },
];

async function seed({ demo = false } = {}) {
  const entityIds = {};
  for (const e of ENTITIES) {
    const { rows } = await db.query(
      `INSERT INTO entities (name, type, has_financials) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type,
                                        has_financials = EXCLUDED.has_financials
       RETURNING id`,
      [e.name, e.type, e.has_financials],
    );
    entityIds[e.name] = rows[0].id;
  }

  const created = [];
  for (const u of USERS) {
    const password = u.password ? u.password() : config.seedDefaultPassword;
    const { rows } = await db.query(
      `INSERT INTO users (username, display_name, role, password_hash, password_enc,
                          entity_id, notifications_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username`,
      [u.username, u.display_name, u.role, hashPassword(password), encryptSecret(password),
       u.entity ? entityIds[u.entity] : null, u.notifications_on],
    );
    if (rows[0]) created.push({ ...u, password });
  }

  if (demo) await seedDemo(entityIds);
  return { entityIds, created };
}

async function seedDemo(entityIds) {
  const { rows: adminRows } = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  const adminId = adminRows[0]?.id;

  const items = [
    { name: 'سطل زيتون', unit: 'piece', price: 25 },
    { name: 'جاط زيتون', unit: 'piece', price: 3.5 },
    { name: 'زيت زيتون', unit: 'kg', price: 6 },
  ];
  const itemIds = {};
  for (const it of items) {
    const { rows } = await db.query(
      `INSERT INTO items (name, unit, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET unit = EXCLUDED.unit RETURNING id`,
      [it.name, it.unit, adminId],
    );
    itemIds[it.name] = rows[0].id;
    await db.query(
      `INSERT INTO item_prices (item_id, price, effective_from, created_by, note)
       VALUES ($1,$2, now() - interval '60 days', $3, 'سعر أوّلي')
       ON CONFLICT (item_id, effective_from) DO NOTHING`,
      [rows[0].id, it.price, adminId],
    );
  }

  // وصفة: كل جاط زيتون بده 0.1 سطل (يعني السطل بيطلع ١٠ جاطات)
  await db.query(
    `INSERT INTO item_components (parent_item_id, component_item_id, quantity_per_unit)
     VALUES ($1,$2,$3) ON CONFLICT (parent_item_id, component_item_id) DO UPDATE
     SET quantity_per_unit = EXCLUDED.quantity_per_unit`,
    [itemIds['جاط زيتون'], itemIds['سطل زيتون'], 0.1],
  );

  const operatorId = entityIds['المشغل'];
  const demoTxns = [
    ['supply',       null,               'سطل زيتون', 100, "now() - interval '20 days'"],
    ['operator_out', operatorId,         'سطل زيتون', 20,  "now() - interval '15 days'"],
    ['operator_in',  operatorId,         'جاط زيتون', 180, "now() - interval '14 days'"],
    ['customer_out', entityIds['بلال'],   'جاط زيتون', 50,  "now() - interval '10 days'"],
    ['customer_out', entityIds['إسلام'],  'جاط زيتون', 30,  "now() - interval '8 days'"],
    ['customer_out', entityIds['عمار'],   'جاط زيتون', 20,  "now() - interval '3 days'"],
  ];
  for (const [kind, entityId, itemName, qty, when] of demoTxns) {
    await db.query(
      `INSERT INTO transactions (kind, entity_id, item_id, quantity, quantity_input, occurred_at, created_by)
       VALUES ($1,$2,$3,$4,$5, ${when}, $6)`,
      [kind, entityId, itemIds[itemName], qty, String(qty), adminId],
    );
  }
  await db.query(
    `INSERT INTO transactions (kind, entity_id, payment_amount, method, occurred_at, created_by)
     VALUES ('payment', $1, 100, 'cash', now() - interval '5 days', $2)`,
    [entityIds['بلال'], adminId],
  );
}

if (require.main === module) {
  const demo = process.argv.includes('--demo');
  seed({ demo })
    .then(({ created }) => {
      console.log('✔ تمت التهيئة');
      if (created.length) {
        console.log('\nالحسابات المنشأة:');
        for (const u of created) {
          console.log(`  ${u.display_name.padEnd(10)} | يوزر: ${u.username.padEnd(9)} | باسورد: ${u.password}`);
        }
        console.log('\n⚠ غيّر كلمات السر بعد أول دخول.');
      } else {
        console.log('(الحسابات موجودة مسبقاً - ما تغيّر شي)');
      }
      return db.pool.end();
    })
    .catch((err) => { console.error('✖ فشل:', err.message); process.exit(1); });
}

module.exports = { seed };
