#!/usr/bin/env node
'use strict';
/**
 * استيراد كتالوج الأصناف.
 *
 *   node scripts/import-catalog.js catalog.json --dry-run   فحص بدون تغيير
 *   node scripts/import-catalog.js catalog.json --yes       استيراد فعلي
 *
 * صيغة الملف: مصفوفة من
 *   { label, base, size, unit, aliases[], priceIn, priceOut }
 *
 * الاستيراد تراكمي وآمن للتكرار: الصنف الموجود بينتحدّث (عائلة/حجم/أسماء
 * بديلة/سعر شراء)، والسعر الجديد بينضاف لتاريخ الأسعار بس إذا فعلاً تغيّر -
 * فإعادة التشغيل ما بتخرّب تاريخ الأسعار ولا بتعيد تسعير حركات قديمة.
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

function normalize(entry, index) {
  const name = String(entry.label || entry.name || '').trim();
  if (!name) throw new Error(`السطر ${index + 1}: ما في اسم للصنف`);

  const aliases = [...new Set((entry.aliases || [])
    .map((a) => String(a).trim())
    .filter((a) => a && a.toLowerCase() !== name.toLowerCase()))]
    .slice(0, 40);

  // تقريب لدقّة الفلس - نفس دقّة العمود بقاعدة البيانات، فإعادة الاستيراد ما بتشوف فرق
  const fils = (v) => (v === null || v === undefined || v === ''
    ? null : Math.round(Number(v) * 1000) / 1000);
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const size = num(entry.size);
  const cost = fils(entry.priceIn);
  const sell = fils(entry.priceOut);

  for (const [label, value] of [['سعر الشراء', cost], ['سعر البيع', sell]]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`السطر ${index + 1} (${name}): ${label} غير صالح`);
    }
  }

  return {
    name,
    base: entry.base ? String(entry.base).trim() : null,
    size: size !== null && Number.isFinite(size) ? size : null,
    size_unit: entry.unit ? String(entry.unit).trim() : null,
    aliases,
    cost_price: cost,
    sell_price: sell,
  };
}

async function importCatalog(file, { dryRun = true, log = console.log } = {}) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.items;
  if (!Array.isArray(rows)) throw new Error('الملف لازم يكون مصفوفة أصناف');

  const entries = rows.map(normalize);

  // تعارض التسميات داخل الملف نفسه
  const seen = new Map();
  for (const e of entries) {
    const key = e.name.toLowerCase();
    if (seen.has(key)) throw new Error(`الاسم مكرّر بالملف: "${e.name}"`);
    seen.set(key, e);
  }

  // أسماء بديلة بتشير لأكتر من صنف - مش خطأ، بس لازم تبيّن
  const aliasOwners = new Map();
  for (const e of entries) {
    for (const a of e.aliases) {
      const key = a.toLowerCase();
      if (!aliasOwners.has(key)) aliasOwners.set(key, []);
      aliasOwners.get(key).push(e.name);
    }
  }
  const ambiguous = [...aliasOwners.entries()].filter(([, owners]) => owners.length > 1);

  const stats = { created: 0, updated: 0, prices: 0, unchanged: 0, without_price: 0 };
  const effectiveFrom = new Date();

  await db.withTransaction(async (client) => {
    for (const e of entries) {
      const { rows: existing } = await client.query(
        'SELECT id, base, size, size_unit, aliases, cost_price FROM items WHERE lower(btrim(name)) = lower(btrim($1))',
        [e.name],
      );

      let itemId;
      if (existing[0]) {
        itemId = existing[0].id;
        const before = existing[0];
        const changed = before.base !== e.base
          || Number(before.size) !== Number(e.size)
          || before.size_unit !== e.size_unit
          || Number(before.cost_price) !== Number(e.cost_price)
          || JSON.stringify(before.aliases || []) !== JSON.stringify(e.aliases);
        if (changed) {
          await client.query(
            `UPDATE items SET base = $1, size = $2, size_unit = $3, aliases = $4, cost_price = $5
             WHERE id = $6`,
            [e.base, e.size, e.size_unit, e.aliases, e.cost_price, itemId],
          );
          stats.updated += 1;
        } else {
          stats.unchanged += 1;
        }
      } else {
        const { rows: created } = await client.query(
          `INSERT INTO items (name, unit, base, size, size_unit, aliases, cost_price)
           VALUES ($1, 'piece', $2, $3, $4, $5, $6) RETURNING id`,
          [e.name, e.base, e.size, e.size_unit, e.aliases, e.cost_price],
        );
        itemId = created[0].id;
        stats.created += 1;
      }

      if (e.sell_price === null) {
        stats.without_price += 1;
        continue;
      }
      // السعر بينضاف بس إذا مختلف عن السعر الساري حالياً
      const { rows: current } = await client.query(
        `SELECT price FROM item_prices WHERE item_id = $1 AND effective_from <= now()
         ORDER BY effective_from DESC, id DESC LIMIT 1`,
        [itemId],
      );
      if (!current[0] || Number(current[0].price) !== e.sell_price) {
        await client.query(
          `INSERT INTO item_prices (item_id, price, effective_from, note)
           VALUES ($1, $2, $3, 'استيراد من الكتالوج')
           ON CONFLICT (item_id, effective_from) DO UPDATE SET price = EXCLUDED.price`,
          [itemId, e.sell_price, effectiveFrom],
        );
        stats.prices += 1;
      }
    }

    await client.query(
      `INSERT INTO audit_log (username, action, table_name, summary)
       VALUES ('system', 'create', 'items', $1)`,
      [`استيراد كتالوج: ${stats.created} صنف جديد، ${stats.updated} محدّث، ${stats.prices} سعر`],
    );

    if (dryRun) throw new DryRun();
  }).catch((err) => { if (!(err instanceof DryRun)) throw err; });

  return { stats, ambiguous, total: entries.length };
}

class DryRun extends Error {}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const confirmed = args.includes('--yes');

  if (!file) {
    console.error('الاستعمال: node scripts/import-catalog.js <catalog.json> [--dry-run | --yes]');
    process.exit(1);
  }
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) { console.error(`✖ الملف مش موجود: ${filePath}`); process.exit(1); }

  importCatalog(filePath, { dryRun: !confirmed })
    .then(({ stats, ambiguous, total }) => {
      console.log(`\nالكتالوج: ${total} صنف`);
      console.log(`  جديد:        ${stats.created}`);
      console.log(`  محدّث:        ${stats.updated}`);
      console.log(`  بلا تغيير:    ${stats.unchanged}`);
      console.log(`  أسعار جديدة: ${stats.prices}`);
      console.log(`  بلا سعر بيع: ${stats.without_price}  (بتضل "سعر معلّق" لحد ما تسعّرها)`);
      if (ambiguous.length) {
        console.log(`\n⚠ ${ambiguous.length} اسم بديل بيشير لأكتر من صنف - البحث بيعرض كل الخيارات:`);
        for (const [alias, owners] of ambiguous.slice(0, 6)) {
          console.log(`  "${alias}" → ${owners.slice(0, 4).join('، ')}${owners.length > 4 ? '…' : ''}`);
        }
      }
      console.log(confirmed ? '\n✔ تم الاستيراد' : '\n(فحص فقط - ما تغيّر شي. للاستيراد ضيف --yes)');
      return db.pool.end();
    })
    .catch((err) => { console.error('\n✖', err.message); process.exit(1); });
}

module.exports = { importCatalog };
